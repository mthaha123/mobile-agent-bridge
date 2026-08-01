# Bash 工具输出流式机制分析

> 分析 OpenCode 中 bash 工具的输出通道：`message.part.updated` 流式事件 vs `session.next.tool.*` 一次性事件。

## 1. 背景与问题

在移动端 App ↔ Bridge ↔ OpenCode 全链路验证中发现：bash 工具在 App 中**只在工具完成时一次性显示完整输出**，而 OpenCode TUI 中 bash 工具（如启动服务器）的日志输出是**渐进式的**（随进程运行逐行出现）。

本分析旨在回答：**TUI 的流式 bash 输出走的是哪条通道，Bridge/App 能否复用。**

## 2. 源码证据（决定性）

### 2.1 bash 工具逐块流式更新输出（`packages/opencode/src/tool/shell.ts:484-531`）

```ts
Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
  ...
  last = preview(last + chunk)     // 累积输出
  ...
  return ctx.metadata({
    metadata: { output: last, description },   // ← 每个 stdout chunk 都更新！
  })
})
```

bash 工具用 `Stream.decodeText(handle.all)` **逐块读取 stdout**，**每个 chunk** 都调用 `ctx.metadata` 更新 tool part 的 `metadata.output` —— 这是流式输出的源头。

### 2.2 ctx.metadata → updateToolCall → message.part.updated

链路：

```
ctx.metadata（tools.ts:51）
  → processor.updateToolCall（processor.ts:152）
    → session.updatePart（session.ts:624）
      → sync.run(MessageV2.Event.PartUpdated)（session.ts:626）→ 发布 message.part.updated
```

`updatePart`（session.ts:624-632）发布 `MessageV2.Event.PartUpdated`（message-v2.ts:530），type=`message.part.updated`，携带**完整 part**（含 tool 的 `metadata.output` 实时更新）。

### 2.3 message.part.updated 通过 /global/event 推送

`SyncEvent.run`（sync/index.ts:341-364）会把同步事件 re-publish 到 bus 并 **`GlobalBus.emit("event", ...)`**。`/global/event` 的 `GlobalEventSchema`（global.ts:18）包含 `SyncEvent.effectPayloads()`，`message.part.updated` 是 SyncEvent → **会被推送到 /global/event SSE**。

### 2.4 Web/TUI 都订阅 message.part.updated

- Web App：`packages/app/src/context/global-sync/event-reducer.ts:226` `case "message.part.updated"`
- TUI：`packages/opencode/src/cli/cmd/tui/context/sync.tsx:306` `case "message.part.updated"`

## 3. 关键对比：两条事件通道

| 事件 | 定义 | 核心发布 | 携带 bash 输出 | 谁在用 |
|------|------|---------|---------------|--------|
| **`message.part.updated`**（v1 SyncEvent） | message-v2.ts:530 | ✅ session.ts:626（每个 stdout chunk） | ✅ `part.metadata.output` 实时 | Web App、TUI |
| **`session.next.tool.progress`**（v2） | session-event.ts:265 | ❌ 无发布点 | ❌ | TUI sync-v2 预留，实际不触发 |

**结论修正**：opencode 的 bash 流式输出**真实通道是 `message.part.updated` 事件**（v1 SyncEvent），而非 `session.next.tool.progress`（v2）。之前实测 serve 模式"无增量"是因为 **bridge 只转发了 `session.next.*`（v2）事件，忽略了 `message.part.updated`（v1）**。

## 4. Bridge/App 的启示

**bridge 订阅 `/global/event` 理论上能收到 `message.part.updated`**（GlobalEventSchema 包含 SyncEvent）。之前的 probe 只过滤了 `tool/shell/step` 关键字，`message.part.updated` 没被记录。

要在 App 流式显示 bash 输出，bridge 需要：
1. 在 `startSSE` 中识别 `message.part.updated` 事件（其 `part` 是 tool part 且 `part.state.metadata.output` 在变化）
2. 转发为 notify（如 `message.part.updated`），App 端 `AppProvider` 订阅并更新对应 tool part 的 `result`

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

### 5.3 当前限制与改进方向

App 执行中只有 ⏳（因 bridge 未转发 `message.part.updated`），输出在 `tool.success` 一次性出现。**实现流式的关键**是 bridge 转发 `message.part.updated` 事件（见 §4），而非依赖 `tool.progress`。

## 6. 验证方法（复现）

```bash
# 1. 订阅 /global/event，触发慢 bash，观察 message.part.updated
#    用 probe 订阅 http://localhost:4100/global/event，触发 'ping -n 30 127.0.0.1'
#    观察 message.part.updated 事件（携带 tool part 的 metadata.output 逐块增长）

# 2. 观察 CLI run 事件流
opencode run --format json -m opencode-go/deepseek-v4-flash \
  --dir D:\code\mobile-agent-bridge "run 'ping -n 3 127.0.0.1' and say DONE"

# 3. 对比 bridge 的 startSSE：确认它是否解析了 payload.syncEvent.type
#    bridge 应识别 type === 'message.part.updated' 并转发
```
