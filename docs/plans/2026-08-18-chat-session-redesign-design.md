# Chat 会话页重构设计 — 2026-08-18

## 一、背景与目标

当前 ChatScreen 经过多轮增量修复，存在系统性缺陷：工具调用双重渲染、事件处理面条式 if 链、waiting 被多事件互相覆盖、滚动双机制打架导致页面抖动、工具卡无终结态兜底导致"永远显示在底部"。

本次**推翻重来**，重构目标：

1. 消除抖动（页面不稳定）
2. 消除工具卡重复/残留显示（bash 调用一直显示在底部）
3. 事件处理可测试、可维护（收敛为纯函数 reducer）
4. 状态有穷、必终结（waiting / 工具卡）
5. 会话隔离（事件按 sessionID 过滤，切会话清残留）

### 已确认决策

| # | 决策 | 结论 |
|---|------|------|
| 1 | 底部运行工具条 | **完全移除**，工具只内联显示 |
| 2 | 25s backfill 轮询 | **不保留**，改为手动刷新按钮 + 重连时自动重同步 |
| 3 | 改造范围 | **允许**新增 ingest reducer、重写 AppProvider、拆分 MessageList |
| 4 | 双 MarkdownRenderer | **统一**，保留 `react-native-marked` 实现 |

---

## 二、功能全景

### 2.1 数据生命周期
- 会话列表：`session.list`
- 打开会话：`session.messages` asc 加载 50 条 + cursor 分页
- 历史加载：上滑到顶 cursor prepend
- **手动刷新**：下拉刷新 / 头部按钮 → 重拉最近 50 条幂等合并
- **重连重同步**：BridgeClient `connected`（重连）后自动对当前会话执行一次重同步
- 创建 / 切会话 / 发送 / 中止 / 切 agent / 切模型 / revert / 复制

### 2.2 流式事件（全部经 SSE 透传）
`prompt.admitted/prompted`、`text.started/delta/ended`、`reasoning.delta/ended`、
`tool.input.started/delta/ended`、`tool.called/progress/success/failed`、
`step.started/ended/failed`、`permission.v2.asked/replied`、`message.part.delta`、
`message.updated`、`message.part.updated`、`session.status/idle/error`、
`*.failed/*.error` fallback、`session.diff`、`todo.updated`、`question.v2.asked`、`project.changed`

### 2.3 UI
- 头部（返回 / 标题 / 模型 / 信息 / 手动刷新）
- 消息列表（user 气泡 / assistant Markdown / 系统消息）
- Part 渲染（text / tool / reasoning / patch / error / compaction，注册表）
- 工具卡（BasicTool + ShellOutput + DiffDisplay + 注册表）
- Dock 三件套（PermissionDock / QuestionDock / AttachmentBar）
- 输入区（⌘ / TextInput / 发送 / 停止）
- 弹层（SessionInfo / SlashSheet / ModelPicker）

---

## 三、核心原则

1. **单一事实源**：`chatStore.messages[]` 是消息唯一渲染来源，工具只内联渲染。
2. **事件收敛**：所有 SSE 事件进纯函数 reducer（会话过滤 → 状态转换），AppProvider 只做转发。
3. **有穷状态**：waiting 由状态机驱动；工具卡有必然终结的兜底。
4. **滚动数据驱动**：只有数据真正追加到末尾才滚动；历史 prepend 用偏移补偿；交互高度变化不滚动。
5. **会话隔离**：事件按 `sessionID === activeSessionId` 过滤；切会话统一 reset。

---

## 四、数据模型

```ts
interface ChatMessage {
  id: string                    // 本地稳定 key（React key）
  messageID?: string            // 服务端权威 id
  role: 'user' | 'assistant' | 'system'
  content: string               // 流式期间为累积文本；结束/校正后为权威全文
  status: 'streaming' | 'complete'
  parts: Part[]                 // 按稳定 id 去重（工具=callID）
  deltaBuffer?: Record<number, string>  // 文本流乱序缓冲（内聚到消息）
  lastAppliedDeltaId?: number
  timestamp: number
  created?: number
  agent?: string
}

interface Part {
  id: string                    // 工具 part = callID；其余 = 服务端 part id
  type: 'text'|'tool'|'reasoning'|'patch'|'error'|'compaction'
  data: Record<string, unknown>
}
```

要点：
- **工具 part id 统一取 `callID`**（SSE 与持久化都带 callID），消除 `call_…` vs `prt_…` 双卡问题。
- 文本流缓冲内聚到 message，删除全局 `streamStates`。
- 服务端 `step-start / step-finish / file` part 默认不渲染（丢弃），`patch` 渲染为 DiffDisplay。

---

## 五、事件摄取层（ingest reducer）

### 5.1 结构

```
AppProvider
  └─ client.on('notification', (method, payload) => chatStore.ingestEvent(method, payload))
       ├─ ① 会话过滤：payload.sessionID && activeSessionId && 不相等 → return
       ├─ ② 路由到纯函数 reducer：
       │     reducePrompt / reduceText / reduceReasoning
       │     reduceTool / reduceStep / reducePermission
       │     reduceSessionStatus / reduceMisc
       └─ ③ 每个 reducer 返回增量 { messages?, waiting?, runError?, ... }，set 应用
```

### 5.2 文本流（reduceText）
- `text.started` → 预建 assistant 消息（key=messageID），标记 `streaming`
- `text.delta` → 按到达顺序 append（真实 eventId 为 `evt_` 字符串，数值 buffer 是死代码，仅保留作防御）；写入 `content`
- `text.ended` / `message.updated`（权威全文）→ 覆盖 content，标 `complete`
- 校正规则：权威全文不短于当前累积时覆盖（防打断进行中流式）

### 5.3 工具流（reduceTool）
- `tool.input.started` / `tool.called` **先到者**创建 part（key=callID，含 tool/input）
- `tool.progress` → 更新 data（仅当有内联锚点才有意义，但已无 footer，可仅更新 part）
- `tool.success` → `structured/content/result/outputPaths` 统一映射为 result 文本 + status=success
- `tool.failed` → error + status=failed

### 5.4 审批/问答（reducePermission / question）
- `permission.v2.asked` → toolStore.enqueue（按 sourceCallID 去重）
- `permission.v2.replied` → dequeue；**若 reply=reject** → 把对应 sourceCallID 工具 part 标 `failed('rejected')`
- `question.v2.asked` → questionStore.addQuestion（保留现状）

---

## 六、waiting / 会话运行状态机

```
idle → running：send 成功受理 / prompt.admitted / step.started / text.started
running → idle：step.ended / step.failed / text.ended(无挂起 step) / session.idle / session.error
```

实现：
- `pendingSteps: number` 计数：`step.started` +1，`step.ended/failed` -1，归零 → idle
- 兜底：`lastActivityAt` 时间戳，超过 N 分钟无任何会话事件 → 强制 idle
- 输入框禁用 / ThinkingShimmer 只由 `waiting` 驱动，**不再有多个事件各自 setWaiting**

---

## 七、工具卡生命周期与终结态

```
queued(审批中) → running(已放行/已 called) → success | failed | cancelled
```

所有路径收敛到终态，**保证不再"永远 ⏳"**：

| 触发 | 处理 |
|------|------|
| `tool.success` | success |
| `tool.failed` | failed |
| `permission.v2.replied`(reject) | failed('rejected') |
| `message.abort` / 中断 | 当前运行工具标 cancelled |
| `step.failed` | 同 step 内未终结工具标 failed |
| TTL 清扫（超时非终态） | cancelled |
| 切会话 | clearSession |

---

## 八、渲染模型（消除双重渲染）

```
MessageList (FlatList)
 ├─ ListHeader: 加载更早 / 上滑加载提示
 ├─ MessageItem (React.memo)
 │   ├─ UserBubble
 │   └─ AssistantBlock
 │       ├─ TextPart (MarkdownRenderer, memo)
 │       ├─ ToolPart (BasicTool, key=callID, memo)   ← 唯一工具渲染点
 │       └─ ReasoningPart (可折叠, memo)
 └─ ListFooter: ThinkingShimmer(waiting 时)   ← 无 ToolProgressCard
```

- `MessageItem` 用 React.memo，只对 `message` 引用变化重渲染（store 更新仅重建被改消息的引用）。
- 删除 `ToolProgressCard` 组件及其在 footer 的挂载。
- 统一 Markdown：保留 `components/chat/MarkdownRenderer.tsx`（react-native-marked），删除 `components/MarkdownRenderer.tsx` 纯文本版，引用统一到新路径。

---

## 九、滚动模型（消除抖动）

**移除 `maintainVisibleContentPosition`**，改为数据驱动 + 显式偏移补偿：

1. **末尾追加跟随**：`useEffect` 监听 `messages` 末尾变化（新增消息 / 最后一条 content 变化），若 `pinnedToBottomRef.current` → `scrollToEnd(animated:false)`。**不再由每次 contentSize 变化触发。**
2. **历史 prepend 补偿**：`onContentSizeChange` 记录 `prevHeight`，`diff = newHeight - prevHeight`；若发生 prepend（header 高度增加）→ `scrollTo(offset + diff)`，保持视口。
3. **交互高度变化不滚动**：工具卡展开/收起、Dock 显隐等用户交互引起的尺寸变化用 flag 标记，不触发跟随。
4. `pinnedToBottomRef` 在 `onScroll` 实时计算，`scrollEventThrottle=16`。
5. `pendingScrollToEnd`：新会话首次内容渲染完成时强制滚到底（保留）。

---

## 十、会话生命周期与手动刷新

```
openSession(id): resetAllStores() → load(asc 50) → 手动 refresh() → follow=true
switchSession(id): 同上（chat/tool/question/diff/todo/attachment 全部 reset/clearSession）
closeSession(): popChat 回列表，缓存保留可回退
```

- **手动刷新**：FlatList 下拉 `RefreshControl` + 头部按钮 ↻ → `syncSessionMessages()`（重拉最近 50 条 asc，`applyServerMessages` 幂等合并）。会话列表刷新保留在 SessionsScreen。
- **重连重同步**：AppProvider 监听 BridgeClient `connected` 事件，对当前 `activeSessionId` 执行一次 `syncSessionMessages()`（替代原 25s 轮询的安全网）。
- 事件过滤在 ingest 层统一完成，不再各 handler 手写 `isForActiveSession`。

---

## 十一、错误处理

- `runError` 单一来源：`step.failed` / `session.error` / `*.failed` / `*.error` fallback 收敛为 `setRunError`，同时状态机归 idle。
- 错误条可关闭；新一轮 `prompt.admitted` 自动清除。

---

## 十二、组件拆分

新增 `components/chat/`：
- `MessageList.tsx` — FlatList + 全部滚动/分页逻辑（自包含）
- `MessageItem.tsx` — memoized 单条消息渲染
- `SyncSession.ts`（或并入 chatStore）— `syncSessionMessages()` 供手动刷新/重连复用

重写：
- `AppProvider.tsx` — 事件转发瘦身（~30 行），其余逻辑进 ingest
- `chatStore.ts` — 数据模型 + ingest reducer + 状态机

删除：
- `components/ToolProgressCard.tsx`
- `components/MarkdownRenderer.tsx`（纯文本版）
- `stores/toolProgressStore.ts`（activeCalls 不再需要；若审批卡还需 callID 映射则保留最小集合）

保留（仅移除引用/清理死代码）：ThinkingShimmer、PartBlock、BasicTool、ShellOutput、DiffDisplay、PermissionDock、QuestionDock、AttachmentBar、SlashSheet、SessionInfoModal、ModelPicker。

---

## 十三、测试策略

1. **ingest reducer 单测**：喂真实事件序列（从 `logs/build/bridge-4199.log` 提取样本），断言 messages/parts/waiting/终结态收敛。
2. **滚动逻辑单测**：pinned 判断、prepend 偏移补偿纯函数。
3. **组件单测**：MessageItem 渲染、工具终结态 UI（success/failed/rejected/cancelled）。
4. **E2E**：复用现有 mock push（`__push__:session.next.tool.*`）+ `e2e-sse.mjs`。

---

## 十四、涉及文件清单

### 新增
- `apps/mobile/src/stores/ingest.ts`（reducer 拆分，或并入 chatStore）
- `apps/mobile/src/components/chat/MessageList.tsx`
- `apps/mobile/src/components/chat/MessageItem.tsx`
- `apps/mobile/__tests__/ingest.test.ts`
- `apps/mobile/__tests__/MessageList.test.tsx`（滚动逻辑）

### 重写
- `apps/mobile/src/screens/ChatScreen.tsx`
- `apps/mobile/src/components/AppProvider.tsx`
- `apps/mobile/src/stores/chatStore.ts`

### 删除
- `apps/mobile/src/components/ToolProgressCard.tsx`
- `apps/mobile/src/components/MarkdownRenderer.tsx`
- `apps/mobile/src/stores/toolProgressStore.ts`

### 修改
- `apps/mobile/src/stores/toolStore.ts`（reject 时联动工具 part 终结态）
- 所有引用旧 `components/MarkdownRenderer` 的文件改到 `components/chat/MarkdownRenderer`

### 本方案取代
- `docs/plans/chat-ui-redesign.md`（旧方案，已被现有实现吸收，标注为 superseded）
