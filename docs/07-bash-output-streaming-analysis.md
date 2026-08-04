# Bash 工具输出流式机制分析

> 分析 OpenCode 中 bash 工具的输出通道：`message.part.updated` 流式事件 vs `session.next.tool.*` 一次性事件。
>
> **最终结论（2026-08-03 实测 1.18.11）**：当前客户端**不支持** bash 实时输出。TUI 的渐进显示基于 `message.part.updated`，但 1.18.11 的 SSE 实测**不发布该事件**；bridge 订阅的 SDK `/api/event` 通道与之无关；App 也无对应 handler。详见 §3.5。

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

**源码层面**：opencode 的 bash 流式输出**设计通道是 `message.part.updated` 事件**（v1 SyncEvent），而非 `session.next.tool.progress`（v2）。

## 3.5 实测验证（1.18.11 决定性结果）

> 2026-08-03 对**实际运行的 opencode 1.18.11**（`serve --port 4200 --print-logs`）做了 SSE 实测，推翻 §2/§3 基于旧源码（v1.15.10）的推断。

**探针**（`servers/bridge/probe-*.mjs/cjs`）：
- bridge（19985 → 4200）触发慢 bash `for /l %i in (1,1,8) do @echo probe-line-%i & ping -n 2 127.0.0.1 >nul`（跑约 8s）
- 直连 `/global/event`、`/api/event` 双通道抓包

**结果**：

| 通道 | 结果 |
|------|------|
| bridge 收 v2 原生事件 | 只有 `session.next.step/tool.called/text.delta/tool.success` 等，**`message.part.updated` count = 0** |
| `/global/event` 直连（4200） | 13 种 v1 sync 事件正常（`session.created.1`、`session.next.tool.called.1` 等），**`message.part.updated` count = 0**；bash 跑 ~8s 无增量输出事件 |
| `/api/event`（SDK 通道） | 200 可连接，格式 `{id,type,data}`，与 part.updated 无关 |
| `/event`（bus 端点） | 超时不可用 |

**结论（实测）**：**1.18.11 运行时的 SSE 上根本不发布 `message.part.updated`**。TUI 的渐进显示走内部 channel（session updatePart → 本地 DB + 直接渲染），不在 mcp/server SSE 输送。

**上游最新 dev 源码现状**（2026-08-03 抓取 `anomalyco/opencode` dev 分支，逐文件核对）：

**✅ 最新 dev 分支源码完整支持 bash 流式输出推送。** 全链路逐环确认：

| 环节 | 位置 | 行为 |
|------|------|------|
| 1. 逐块输出 | `packages/opencode/src/tool/shell.ts` `run()` | `Stream.runForEach(Stream.decodeText(handle.all), ...)` 每 chunk `last = preview(last + chunk)` → `return ctx.metadata({ metadata: { output: last } })` |
| 2. metadata 转调用 | `packages/opencode/src/session/tools.ts` `context.metadata` | → `input.processor.updateToolCall(options.toolCallId, ...)`，写入 `state.metadata` |
| 3. 更新 part | `packages/opencode/src/session/processor.ts` `updateToolCall` | → `session.updatePart(update(match.part))` |
| 4. 发布事件 | `packages/opencode/src/session/session.ts` `updatePart` | `events.publish(SessionV1.Event.PartUpdated, { sessionID, part, time })`，`events = EventV2Bridge.Service` |
| 5. 事件定义 | `packages/schema/src/v1/session.ts` | `PartUpdated: define({ type: "message.part.updated", durable: { aggregate: "sessionID", version: 1 } })` —— **durable 事件，version 1** |
| 6. 提交+广播 | `packages/core/src/event.ts` `publishEvent`/`commitDurableEvent` | durable 事件先写 DB（seq 递增），再 `notify(event, true)` → 触发 `listeners` |
| 7. 进 GlobalBus | `packages/opencode/src/event-v2-bridge.ts` `unsubscribe` | `events.listen` 每个事件 `GlobalBus.emit("event", { ... payload: { id, type, properties } })`；durable 事件**额外**发 `payload: { type: "sync", syncEvent: { id, type: "message.part.updated.1", seq, aggregateID, data } }` |
| 8. /global/event 推送 | `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts` `eventResponse` | `GlobalBus.on("event", handler)` **无过滤**全量推送，含 `server.connected`/`server.heartbeat` |

**结论**：dev 分支的 `/global/event` SSE 上会同时出现两种形式：raw `type:"message.part.updated"` 与 sync `type:"sync"`（`syncEvent.type="message.part.updated.1"`）。**只要 bash 输出逐块到达，就有逐块事件推送。**

⚠️ **但 1.18.11（2026-08-01 发行）实测不发**：0 个 `message.part.updated`。1.18.11 与 dev 分支行为不一致（1.18.11 也非 v1.15.10 旧机制，因为能收到 `session.next.*` 的 v1 sync 事件）。dev 源码的支持能力**尚未在任何发行版验证**。

## 4. Bridge/App 的启示（实测修正）

**仅靠升级 bridge 订阅 `/global/event` 不足以解决**：1.18.11 实测该通道根本不发 `message.part.updated`。要让 App 流式显示 bash 输出，需要：
1. **升级 opencode** 到发布 `message.part.updated` 的版本（dev 分支源码已具备，未验证发行版），或改用能产出逐块输出事件的通道
2. bridge 在 `startSSE` 中识别 `message.part.updated`（`part.state.metadata.output` 逐块增长）并转发为 notify
3. App 端 `AppProvider` 订阅 `message.part.updated`，更新对应 tool part 的实时输出（现无该 handler）

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

## 6. 验证方法（实测复现）

```bash
# 前置：opencode serve --port 4200 --print-logs；bridge BRIDGE_PORT=19985 OPENCODE_URL=http://localhost:4200

# 1. 直连 /global/event（v1 sync 全事件，含 server.connected/heartbeat）
node servers/bridge/probe-global-v6.mjs

# 2. bridge 触发慢 bash，观察转发的 v2 事件（无 message.part.updated）
node servers/bridge/probe-bash-stream.cjs

# 3. 通道可达性：/global/event→200、/api/event→200、/event→超时
node servers/bridge/probe-raw-event.mjs

# 实测结论：1.18.11 SSE 上 message.part.updated count = 0
```

> 曾用 `opencode run --format json` 复现 CLI 事件流，但 SSE 实测（§3.5）已足以定性。
