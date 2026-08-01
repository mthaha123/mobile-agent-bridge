# Bash 工具输出流式机制分析

> 分析 OpenCode 1.18.9 中 bash 工具的输出通道：TUI 的流式输出 vs Bridge/SDK SSE 事件流的一次性输出。

## 1. 背景与问题

在移动端 App ↔ Bridge ↔ OpenCode 全链路验证中发现：bash 工具在 App 中**只在工具完成时一次性显示完整输出**，而 OpenCode TUI 中 bash 工具（如启动服务器）的日志输出是**渐进式的**（随进程运行逐行出现）。

本分析旨在回答：**TUI 的流式 bash 输出走的是哪条通道，Bridge/App 能否复用。**

## 2. 实测结论（决定性证据）

### 2.1 Serve 模式 SSE 事件流：无增量

通过 Bridge 对 `ping -n 30`（约 30 秒长命令）实测完整事件流：

```
+3.5s  session.next.tool.input.delta × ~30   ← 命令参数逐字符流式（command 文本，非输出）
+3.9s  session.next.tool.input.ended
+3.9s  session.next.tool.called              ← ping 开始执行
...    （9.5 秒执行期间：无任何 tool.progress / 输出增量事件）
+13.4s session.next.tool.success             ← 输出一次性完整送达（content 数组）
```

- `session.next.tool.progress` 事件**实测 0 次触发**（定义存在但 bash 工具不使用）
- bash 输出只在 `tool.success` 时一次性给全（`state.output` / `content`）

### 2.2 CLI run 模式（--format json）：同样一次性

```
step_start
tool_use   ← 单个事件，state.time.start→end 仅 50ms，output 为完整字符串
step_finish
```

工具 part 的 `state.output` 是命令完成后组装好的**完整字符串**，无中间事件。

### 2.3 PTY API（/api/pty）：Windows 上不可用

- SDK `pty.create` 发出正确请求（`POST /api/pty?location[directory]=...`）
- **server 端挂起**（8s 超时无响应），日志无成功创建记录
- opencode 1.18.9 二进制用 `portable-pty` crate + Windows ConPTY，但在 Bun 编译产物中初始化阻塞

## 3. 源码证据

### 3.1 事件定义存在但无发出点

`session.next.tool.progress` 在 opencode 二进制中有完整定义和投影处理（更新 tool part 的 `state.structured/content`），但**全二进制搜索 `Tool.Progress` 只有 1 处（session projector 消费方），无任何 publish/emit 发出点**。

### 3.2 TUI 渲染逻辑（非流式）

TUI 工具 part 渲染器：

```js
get output() {
  return U.part.state.status === "completed" ? U.part.state.output : void 0
}
```

工具**未完成时不显示输出**，完成后一次性显示 `state.output`。

### 3.3 PTY 通道（流式的真实来源）

TUI 有独立的**终端面板（Terminal Panel / PTY）**：

- `client.pty.create` / `api.pty.create` 创建伪终端
- `/api/pty/{ptyID}/connect` 以 SSE **逐字节实时**推送终端输出
- 监听 `pty.exited` 事件
- Windows 实现依赖 ConPTY（`portable-pty` crate，需要 Win10 1809+）

## 4. 结论

| 通道 | 输出时序 | 谁在用 |
|------|---------|--------|
| **PTY**（`/api/pty/{id}/connect`） | 逐行/逐字节流式 | TUI 终端面板 |
| **SSE tool 事件**（`session.next.tool.*`） | 一次性（tool.success） | Bridge/App、CLI run |

- **TUI 的"流式 bash 输出"来自 PTY 通道**：bash 命令在伪终端中运行，stdout 是 TTY → 行缓冲 → 服务器日志逐行实时刷新。这**独立于** `session.next.tool.*` SSE 事件流。
- **Bridge 订阅的 SSE 事件流中没有 bash 输出增量事件**——opencode 1.18.9 的 bash 工具不推送 `tool.progress`，输出仅在 `tool.success` 一次性送达。
- **Windows 上 PTY 通道对 Bridge 不可用**：Bun 二进制的 `/api/pty` 服务端挂起，Bridge 无法通过该通道获取流式输出。

## 5. App 工具执行中的 UI 表现

### 5.1 执行中（tool.called 之后、tool.success 之前）

App 在工具执行中**同时有两处**显示：

**① 消息列表中的 ToolPart 卡片**（`BasicTool.tsx`）
- `AppProvider` 收到 `tool.called` → `addToolPart({ status: 'called' })` 立即加入当前 assistant 消息
- 渲染为工具卡片：`⌘ Shell <命令>` + **⏳** 加载图标（`BasicTool.tsx:44-45`：`status === 'called' || 'progress'` → ⏳）
- **无输出内容**：ShellOutput 仅在 `result` 非空时渲染，执行中 result 为空
- 可点击展开（▶），但展开后同样无输出

**② 消息列表底部的 ToolProgressCard**（`ToolProgressCard.tsx`）
- 只过滤 `status === 'called' || 'progress'` 的进行中调用（`:8-10`）
- 渲染为**水平滚动**的进行中卡片，出现在消息列表 footer（`ChatScreen.tsx` renderFooter）
- 工具完成（success/failed）→ 状态变更 → 从该卡片列表移除

**③ ThinkingShimmer**：`step.started` → `setWaiting(true)` → footer 显示 "Thinking..." 动画

### 5.2 执行中 vs 完成后的对比

| 阶段 | 消息列表卡片 | ToolProgressCard | 输出 |
|------|------------|-----------------|------|
| 执行中 | `⌘ Shell cmd ⏳` | 显示 `⌘ cmd ⏳` | 无（result 空） |
| 成功 | `⌘ Shell cmd ✅` | 移除 | 完整输出（可展开） |
| 失败 | `⌘ Shell cmd ❌` | 移除 | 错误信息 |

### 5.3 关键限制

由于 opencode 1.18.9 不触发 `tool.progress` 增量事件，App 在执行中**无法实时显示 bash 输出**——执行中只有 ⏳ 图标 + 命令文本，输出在 `tool.success` 时一次性出现。这是 SSE 通道的固有限制（非 App 缺陷），与 TUI 通过 PTY 逐行显示形成对比。

## 6. 对 Bridge/App 的启示

当前 App 行为（工具完成后显示完整输出）是 **SSE 通道下的正确实现**，与 TUI 渲染 tool part 的逻辑一致（都是 completed 后显示 `state.output`）。

若需在 App 实现 bash 流式输出，可选路径：

1. **等待/验证其他平台**：在 Linux/macOS 上 `/api/pty` 可能可用，Bridge 可订阅 PTY 通道并转发增量。
2. **升级 opencode**：更高版本可能修复 Windows PTY 或为 bash 工具启用 `tool.progress`。
3. **维持现状**：SSE 一次性输出已覆盖工具执行结果，流式属于增强项。

## 7. 验证方法（复现）

```bash
# 1. 观察 serve 模式 SSE 事件流（Bridge 通道）
#    用 probe 订阅 /api/session/{id}/event，触发 'ping -n 30 127.0.0.1'
#    观察 tool.called → (空白) → tool.success

# 2. 观察 CLI run 事件流
opencode run --format json -m opencode-go/deepseek-v4-flash \
  --dir D:\code\mobile-agent-bridge "run 'ping -n 3 127.0.0.1' and say DONE"

# 3. 测试 PTY API（Windows 预期挂起）
curl -X POST "http://localhost:4100/api/pty?location[directory]=..." \
  -H "Content-Type: application/json" -d '{"command":"echo hi"}'
```
