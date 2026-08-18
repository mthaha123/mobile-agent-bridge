# Chat 会话页重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 推翻重来 ChatScreen 会话功能：单一事实源渲染、收敛事件为纯函数 reducer、状态有穷终结、消除页面抖动与工具卡重复/残留显示。

**Architecture:** 所有 SSE 事件经 `chatStore.ingestEvent` 纯函数 reducer 收敛（会话过滤 → 状态转换）；工具只做内联消息渲染（删除 footer ToolProgressCard）；滚动改为数据驱动 + 偏移补偿（移除 maintainVisibleContentPosition 与 onContentSizeChange 强制 scrollToEnd 的冲突）；25s backfill 轮询改为手动刷新（下拉/头部按钮）+ 重连重同步。

**Tech Stack:** React Native（FlatList）、zustand、react-test-renderer + jest、@opencode-ai/sdk v2（SSE 透传）

---

## 环境与命令

- 移动端测试：`cd apps/mobile && npx jest <file> [-- -t "name"]`
- 类型检查：`cd apps/mobile && npx tsc --noEmit`（若 apps/mobile 有 tsconfig；否则 `npx tsc --noEmit -p apps/mobile/tsconfig.json`）
- 每个任务结尾 `git add` 相关文件 + `git commit`（沿用仓库中文/英文混合风格）

## 新 chatStore API（后续任务共同依赖）

```ts
interface ChatMessage {
  id: string
  messageID?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  status: 'streaming' | 'complete'
  parts: Part[]
  deltaBuffer?: Record<number, string>
  lastAppliedDeltaId?: number
  timestamp: number
  created?: number
  agent?: string
}

interface ToolPartData {
  tool: string
  input: Record<string, unknown>
  status: 'called' | 'progress' | 'success' | 'failed' | 'rejected' | 'cancelled'
  result?: string
  error?: string
  outputPaths?: string[]
}

interface ChatState {
  activeSessionId: string | null
  messages: ChatMessage[]
  inputText: string
  waiting: boolean
  runError: string | null
  pendingSteps: number
  lastActivityAt: number

  setActiveSession: (id: string | null) => void      // 切换时 reset 全部会话态
  setInputText: (t: string) => void
  setWaiting: (w: boolean) => void
  setRunError: (e: string | null) => void
  clearRunError: () => void
  addMessage: (m: Omit<ChatMessage,'id'|'timestamp'>) => void
  prependMessages: (msgs: ChatMessage[]) => void
  applyLoadedMessages: (msgs: Array<{role:string;messageID:string;content:string;timestamp?:number;parts?:Part[]}>) => void   // 幂等合并（打开/刷新/重连）
  ingestEvent: (method: string, payload: any) => void  // 全部显式事件走这里
  resetForSession: () => void
  markToolsCancelled: () => void                       // abort 时终结当前未终结工具
  syncSessionMessages: (sessionId: string, clientCall: (m:string,p?:unknown)=>Promise<unknown>) => Promise<void>  // 手动刷新
  abortMessage: (sessionId: string, clientCall: (m:string,p?:unknown)=>Promise<unknown>) => Promise<void>
  sendMessage: (sessionId: string, text: string, clientCall: (m:string,p?:unknown)=>Promise<unknown>) => Promise<void>
}
```

工具 part id 统一 = `callID`（SSE 与持久化消息都带 callID）。文本缓冲内聚到 message，删除全局 `streamStates`。

---

### Task 1: 统一 MarkdownRenderer

**Files:**
- Delete: `apps/mobile/src/components/MarkdownRenderer.tsx`
- Test: `apps/mobile/__tests__/MarkdownRenderer.test.tsx`

**Step 1: 确认旧版无外部引用**
Run: `rg -l "components/MarkdownRenderer|renderMarkdown" apps/mobile/src`
Expected: 只有被删文件自身；`FileViewerScreen` / `ChatScreen` / `PartBlock` 已引用 `components/chat/MarkdownRenderer`。

**Step 2: 若有残留引用，改为 `../components/chat/MarkdownRenderer`**
（若 grep 干净则跳过）

**Step 3: 删除文件**
```bash
git rm apps/mobile/src/components/MarkdownRenderer.tsx
```

**Step 4: 跑测试确认 Markdown 渲染仍可用**
Run: `cd apps/mobile && npx jest MarkdownRenderer`
Expected: PASS（引用 `components/chat/MarkdownRenderer` 的既有测试通过）

**Step 5: Commit**
```bash
git add -A apps/mobile
git commit -m "refactor(chat): unify MarkdownRenderer, drop plain-text variant"
```

---

### Task 2: chatStore 新数据模型 + 基础渲染 action（TDD）

**Files:**
- Rewrite: `apps/mobile/src/stores/chatStore.ts`
- Test: `apps/mobile/__tests__/chatStore.test.ts`

先只改 "actions 层"（addMessage / prepend / applyLoadedMessages / addToolPart 按 callID 去重 / updateToolPart），ingest 在 Task 3-6 加。

**Step 1: 写失败测试（key=callID 去重 + 幂等合并）**

```ts
// 追加到 chatStore.test.ts
describe('new model: parts keyed by callID', () => {
  it('dedupes tool parts with same callID regardless of different ids', () => {
    const s = useChatStore.getState()
    s.addToolPart({ id: 'call_1', type: 'tool', data: { status: 'called' } }, 'm1')
    s.addToolPart({ id: 'call_1', type: 'tool', data: { status: 'success' } }, 'm1')
    const msgs = useChatStore.getState().messages
    const target = msgs.find(m => m.messageID === 'm1')
    // 只有一条 tool part（去重依据 callID）
    expect(target!.parts!.filter(p => p.type === 'tool')).toHaveLength(1)
  })
})

describe('applyLoadedMessages idempotent merge', () => {
  it('merges by messageID and fills missing parts', () => {
    useChatStore.getState().applyLoadedMessages([
      { role: 'assistant', messageID: 'msg-1', content: 'partial', parts: undefined },
      { role: 'user', messageID: 'msg-2', content: 'hi' },
      { role: 'assistant', messageID: 'msg-1', content: 'partial', parts: [{ id: 'call_1', type: 'tool', data: {} }] },
    ])
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)                 // msg-1 合并不重复
    const m1 = msgs.find(m => m.messageID === 'msg-1')!
    expect(m1.parts).toHaveLength(1)             // parts 补齐
  })
})
```

**Step 2: 跑测试确认失败**
Run: `cd apps/mobile && npx jest chatStore -t "keyed by callID"`
Expected: FAIL（新方法不存在）

**Step 3: 实现 chatStore actions 层（骨架 + 新模型 + 以上方法）**

```ts
// chatStore.ts —— 全量重写为下述结构（edit 时保留 addToolPart/updateToolPart/applyLoadedMessages 语义）
export const useChatStore = create<ChatState>((set, get) => ({
  activeSessionId: null,
  messages: [],
  inputText: '',
  waiting: false,
  runError: null,
  pendingSteps: 0,
  lastActivityAt: 0,
  setActiveSession: (id) => set((s) =>
    s.activeSessionId === id ? { activeSessionId: id }
      : { activeSessionId: id, messages: [], waiting: false, runError: null, pendingSteps: 0, lastActivityAt: 0 }),
  setInputText: (t) => set({ inputText: t }),
  setWaiting: (w) => set({ waiting: w }),
  setRunError: (e) => set({ runError: e && e.trim ? e : null }),
  clearRunError: () => set({ runError: null }),
  resetForSession: () => set({ messages: [], waiting: false, runError: null, pendingSteps: 0, lastActivityAt: 0 }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, { ...msg, id: nextId(), timestamp: Date.now() }] })),
  prependMessages: (msgs) => set((s) => {
    const known = new Set(s.messages.map(m => m.messageID || m.id))
    const fresh = msgs.filter(m => !known.has(m.messageID || m.id))
    return fresh.length ? { messages: [...fresh, ...s.messages] } : s
  }),
  addToolPart: (part, assistantMessageId) => set((s) => { /* 找到 assistantMessageId 消息，parts 按 part.id(即 callID) 去重合并 */ }),
  updateToolPart: (callID, updates) => set((s) => { /* 所有消息中 p.type==='tool' && p.id===callID 的 part 合并 updates */ }),
  applyLoadedMessages: (msgs) => set((s) => { /* 按 messageID 合并：新消息按 timestamp 插入，已存在且 parts 缺失则补齐 */ }),
  /* 其余 ingest/send/abort/sync 在 Task 3-7 实现，先占位 throw */
}))
```

关键语义：
- `addToolPart`：`(part, assistantMessageId)` → 定位 `messageID===assistantMessageId` 或最后一条 assistant 消息；`parts` 中已存在 `p.id===part.id` 则**合并**而非跳过（写入新 status/data，顺序稳定）。
- `applyLoadedMessages`：按 messageID 合并；`content` 变化才覆盖；`parts` 缺失才补齐（等价旧 `applyServerMessages` + `addMessage` 去重合并）。
- `prependMessages` 保持"更早消息在前"。

**Step 4: 跑测试确认通过**
Run: `cd apps/mobile && npx jest chatStore`
Expected: PASS（旧测试在 Task 11 前按需对齐；本任务先保证新增测试绿）

**Step 5: Commit**
```bash
git add apps/mobile/src/stores/chatStore.ts apps/mobile/__tests__/chatStore.test.ts
git commit -m "refactor(chat): new ChatMessage model with callID-keyed tool parts and idempotent merge"
```

---

### Task 3: ingest — 文本流（text.started / delta / ended，message.updated）

**Files:**
- Modify: `apps/mobile/src/stores/chatStore.ts`（+ ingest 内部纯函数）
- Test: `apps/mobile/__tests__/ingest.test.ts`（新建）

**Step 1: 写失败测试**

```ts
// ingest.test.ts
import { useChatStore, reduceText } from '../src/stores/chatStore'

beforeEach(() => useChatStore.setState({ activeSessionId: 's1', messages: [], ... }))

it('builds assistant message on text.started then streams deltas', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.text.started', { sessionID: 's1', assistantMessageID: 'mA' })
  s.ingestEvent('session.next.text.delta', { sessionID: 's1', assistantMessageID: 'mA', delta: 'Hello ' })
  s.ingestEvent('session.next.text.delta', { sessionID: 's1', assistantMessageID: 'mA', delta: 'world' })
  const m = useChatStore.getState().messages.find(x => x.messageID === 'mA')!
  expect(m.content).toBe('Hello world')
  expect(m.status).toBe('streaming')
})

it('finalizes with authoritative text on text.ended', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.text.started', { sessionID: 's1', assistantMessageID: 'mA' })
  s.ingestEvent('session.next.text.delta', { sessionID: 's1', assistantMessageID: 'mA', delta: 'streamed' })
  s.ingestEvent('session.next.text.ended', { sessionID: 's1', assistantMessageID: 'mA', text: 'authoritative full' })
  const m = useChatStore.getState().messages.find(x => x.messageID === 'mA')!
  expect(m.content).toBe('authoritative full')
  expect(m.status).toBe('complete')
})

it('ignores events from non-active session', () => {
  useChatStore.setState({ activeSessionId: 's1' })
  useChatStore.getState().ingestEvent('session.next.text.delta', { sessionID: 'sOther', assistantMessageID: 'mB', delta: 'x' })
  expect(useChatStore.getState().messages).toHaveLength(0)
})
```

**Step 2: 跑测试确认失败**
Run: `cd apps/mobile && npx jest ingest`
Expected: FAIL

**Step 3: 实现文本流 reducer**

```ts
const isDeltaEvent = (d: unknown): d is { text: string } =>
  !!d && typeof d === 'object' && typeof (d as any).text === 'string'

export function reduceText(messages: ChatMessage[], method: string, p: any, now: number): ChatMessage[] {
  const msgId = p?.assistantMessageID || p?.messageID || ''
  if (!msgId) return messages
  switch (method) {
    case 'session.next.text.started':
      return ensureAssistant(messages, msgId, now)
    case 'session.next.text.delta':
    case 'message.part.delta':
      return appendDelta(messages, msgId, p?.delta, p?.eventId, now)
    case 'session.next.text.ended':
      return finalize(messages, msgId, p?.text, now)
    case 'message.updated':
    case 'message.part.updated': {
      const text = extractText(p?.info || p?.part || p)
      return text && text.length >= currentLen(messages, msgId)
        ? applyFull(messages, msgId, text, now)
        : messages
    }
    default:
      return messages
  }
}
```

- `ensureAssistant`：已存在同名消息则不动；否则 append `{ id: nextId(), messageID: msgId, role:'assistant', content:'', status:'streaming', parts: [] }`。
- `appendDelta`：`eventId` 为字符串/缺失 → 直接 `content += delta`；为数字则用 `deltaBuffer/lastAppliedDeltaId` 乱序缓冲（保留防御，真实事件为字符串直达）。
- `finalize`：`content = text`，`status='complete'`，清理 deltaBuffer。

**Step 4: 跑测试确认通过**
Run: `cd apps/mobile && npx jest ingest`
Expected: PASS

**Step 5: Commit**
```bash
git commit -am "feat(chat): ingest reducer for text stream (started/delta/ended)"
```

---

### Task 4: ingest — 工具流（tool.input.started/called → progress → success/failed）

**Files:**
- Modify: `apps/mobile/src/stores/chatStore.ts`
- Test: `apps/mobile/__tests__/ingest.test.ts`

**Step 1: 写失败测试**

```ts
it('creates tool part (key=callID) on tool.called and updates on success', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.tool.called', {
    sessionID: 's1', assistantMessageID: 'mA', callID: 'call_1', tool: 'bash', input: { command: 'ls' },
  })
  let m = useChatStore.getState().messages.find(x => x.messageID === 'mA')!
  expect(m.parts![0]).toMatchObject({ id: 'call_1', type: 'tool', data: { tool: 'bash', status: 'called' } })

  s.ingestEvent('session.next.tool.success', {
    sessionID: 's1', assistantMessageID: 'mA', callID: 'call_1', structured: { type: 'bash', result: 'ok' },
  })
  m = useChatStore.getState().messages.find(x => x.messageID === 'mA')!
  expect(m.parts![0].data.status).toBe('success')
  expect(m.parts![0].data.result).toContain('ok')
})

it('input.started then called produces a single part', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.tool.input.started', { sessionID:'s1', assistantMessageID:'mA', callID:'c1', name:'bash' })
  s.ingestEvent('session.next.tool.called', { sessionID:'s1', assistantMessageID:'mA', callID:'c1', tool:'bash', input:{} })
  const m = useChatStore.getState().messages.find(x => x.messageID === 'mA')!
  expect(m.parts!.filter(p => p.type==='tool')).toHaveLength(1)
})
```

**Step 2: 跑失败** → **Step 3: 实现**

```ts
export function reduceTool(messages: ChatMessage[], method: string, p: any, now: number): ChatMessage[] {
  const callID = p?.callID || p?.id || ''
  const msgId = p?.assistantMessageID || ''
  if (!callID) return messages
  switch (method) {
    case 'session.next.tool.input.started':
    case 'session.next.tool.called':
      return upsertToolPart(messages, msgId, callID, {
        tool: p?.tool || p?.name || '',
        input: p?.input ?? {},
        status: 'called',
      }, now)
    case 'session.next.tool.progress':
      return updateToolPartData(messages, callID, { status: 'progress' })
    case 'session.next.tool.success':
      return updateToolPartData(messages, callID, extractSuccess(p))
    case 'session.next.tool.failed':
      return updateToolPartData(messages, callID, { status:'failed', error: String(p?.error ?? '') })
    default:
      return messages
  }
}

function extractSuccess(p: any) {
  const result = Array.isArray(p?.content)
    ? p.content.filter((c:any) => c && typeof c.text === 'string').map((c:any) => c.text).join('')
    : typeof p?.result === 'string' ? p.result
    : p?.structured ? JSON.stringify(p.structured)
    : ''
  return { status: 'success' as const, result, outputPaths: p?.outputPaths }
}
```

- `upsertToolPart`：目标消息不存在则先 `ensureAssistant`；`parts` 已有同 id(`callID`) part 则 merge，否则 push。
- `updateToolPartData`：遍历所有消息，`p.type==='tool' && p.id===callID` 合并 data；只重建受影响消息引用（保住 memo 收益）。

**Step 4: 跑测试通过 → Step 5: Commit**
`git commit -am "feat(chat): ingest reducer for tool stream (called/progress/success/failed)"`

---

### Task 5: ingest — waiting 状态机（prompt / step / session.status / session.idle / error）

**Files:**
- Modify: `apps/mobile/src/stores/chatStore.ts`
- Test: `apps/mobile/__tests__/ingest.test.ts`

**Step 1: 写失败测试**

```ts
it('tracks waiting via pendingSteps counter, resilient to text.ended during a step', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.step.started', { sessionID:'s1', assistantMessageID:'mA' })
  s.ingestEvent('session.next.text.started', { sessionID:'s1', assistantMessageID:'mA' })
  s.ingestEvent('session.next.text.ended',   { sessionID:'s1', assistantMessageID:'mA', text:'done' })
  expect(useChatStore.getState().waiting).toBe(true)   // 有挂起 step
  s.ingestEvent('session.next.step.ended',   { sessionID:'s1', assistantMessageID:'mA' })
  expect(useChatStore.getState().waiting).toBe(false)
})

it('forces idle via lastActivityAt staleness', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.step.started', { sessionID:'s1' })
  useChatStore.setState({ lastActivityAt: Date.now() - 6 * 60 * 1000 })
  s.ingestEvent('session.status', { sessionID:'s1', status: { type: 'idle' } })
  expect(useChatStore.getState().waiting).toBe(false)
})
```

**Step 2: 跑失败 → Step 3: 实现**

```ts
// ingestEvent 内部：
const postOffice = (res: Partial<ChatState>) => {
  const stale = Date.now() - (res.lastActivityAt ?? get().lastActivityAt) > ACTIVITY_TTL
  return { ...res, waiting: stale ? false : computeWaiting(get(), res) }
}
function computeWaiting(s: ChatState, res: Partial<ChatState>): boolean {
  const steps = res.pendingSteps ?? s.pendingSteps
  if (res.runError !== undefined && res.runError) return false
  return steps > 0
}
```

规则：
- `step.started` → `pendingSteps+1`，`waiting=true`
- `step.ended/failed` → `pendingSteps-1`（下限 0），归零 → `waiting=false`
- `session.next.text.started` → 若无 pendingSteps 则设 waiting=true（兼容无 step 事件的形式）
- `session.status idle / session.idle / session.error / *.failed / *.error / session.next.step.failed` → 归零 pendingSteps，`waiting=false`，并写 runError（仅 error 类）
- `ACTIVITY_TTL = 5 * 60 * 1000`；每次任何事件推进 `lastActivityAt`，超时强制 idle
- `prompt.admitted/prompted` → `waiting=true`，清 runError，upsert user message

**Step 4/5: 测试通过 + Commit**
`git commit -am "feat(chat): waiting state machine (pendingSteps counter + activity TTL)"`

---

### Task 6: 工具终结态（reject/abort/step.failed/TTL 联动）

**Files:**
- Modify: `apps/mobile/src/stores/chatStore.ts`（+ `markToolsCancelled`、`markStepToolsFailed`）
- Modify: `apps/mobile/src/stores/toolStore.ts`（`reject` 时回写 chatStore）
- Test: `apps/mobile/__tests__/ingest.test.ts`

**Step 1: 写失败测试**

```ts
it('cancels running tools on abort', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.tool.called', { sessionID:'s1', assistantMessageID:'mA', callID:'c1', tool:'bash', input:{} })
  s.markToolsCancelled()
  const m = useChatStore.getState().messages.find(x => x.messageID === 'mA')!
  expect(m.parts![0].data.status).toBe('cancelled')
})

it('marks tool part failed when its permission is rejected', () => {
  const s = useChatStore.getState()
  s.ingestEvent('session.next.tool.called', { sessionID:'s1', assistantMessageID:'mA', callID:'c1', tool:'bash', input:{} })
  s.ingestEvent('permission.v2.replied', { sessionID:'s1', id:'per1', sourceCallID:'c1', reply:'reject' })
  const m = useChatStore.getState().messages.find(x => x.messageID === 'mA')!
  expect(m.parts![0].data.status).toBe('rejected')
})
```

**Step 2: 跑失败 → Step 3: 实现**
- `ingestEvent` 增加 `permission.v2.replied`：若 `reply==='reject'` 且 `sourceCallID` → 工具 part 标 `rejected`（error='rejected'）。
- `markToolsCancelled()`：遍历消息，把 `status in {called,progress}` 的工具 part 标 `cancelled`。
- `step.failed`：把该 `assistantMessageID` 仍未终结的工具 part 标 `failed`。
- `toolStore.reject`（及 PermissionDock 的 reject 路径）保持调用 `chatStore` 联动：在 `useToolStore.reject` 里 `useChatStore.getState().ingestEvent('permission.v2.replied', ...)`。**注意闭环传导**：Bridge 的 `permission.v2.replied` 也会作为通知到达（AppProvider 转发），避免双写——统一在 `ingestEvent` 处理，`toolStore.reject` 只负责 `permission.reply` RPC + dequeue；终结态只在通知到达时写。

**Step 4/5: 测试通过 + Commit**
`git commit -am "feat(chat): terminal states for tools (reject/abort/step-failed)"`

---

### Task 7: 重写 AppProvider + 删除 ToolProgressCard / toolProgressStore

**Files:**
- Rewrite: `apps/mobile/src/components/AppProvider.tsx`
- Delete: `apps/mobile/src/components/ToolProgressCard.tsx`
- Delete: `apps/mobile/src/stores/toolProgressStore.ts`
- Delete: `apps/mobile/__tests__/toolProgressStore.test.ts`
- Modify: `apps/mobile/__tests__/test-utils.tsx`（移除 toolProgressStore reset）

**Step 1: 重写 AppProvider 为转发层**

```tsx
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 保持 authStore.subscribe → setupClient/teardownClient 骨架
  function setupClient(client: BridgeClient) {
    refreshTimerRef.current = setInterval(() => useAuthStore.getState().refreshToken(), 25*60*1000)
    setToolReplyCall(createReplyCall(client))
    setQuestionReplyCall/RejectCall 同现状

    client.on('notification', (method: string, payload: any) => {
      // 全部交给 chatStore 唯一入口；会话过滤在 ingest 层统一做
      useChatStore.getState().ingestEvent(method, payload)
    })

    // 重连 → 重同步当前会话（替代旧 25s backfill）
    const offReconnect = client.on('connected', () => {
      const { activeSessionId } = useChatStore.getState()
      if (activeSessionId && client.connected) {
        useChatStore.getState().syncSessionMessages(activeSessionId, client.call.bind(client))
      }
    })
    client.on('auth_expired', () => useAuthStore.getState().logout())
  }
  ...
}
```

- 注意 `isForActiveSession` 逻辑从各 handler 删除，全部下沉到 `ingestEvent`。
- `diff/todo/question/project.changed` 的 store 写入保留在 AppProvider（或挪到 ingest 也可，勿漏 `session.diff/todo.updated/question.v2.asked/project.changed` —— 这些可在 AppProvider 保留，按需）。

**Step 2: 删除 ToolProgressCard 与 toolProgressStore**
```bash
git rm apps/mobile/src/components/ToolProgressCard.tsx apps/mobile/src/stores/toolProgressStore.ts apps/mobile/__tests__/toolProgressStore.test.ts
```
- 移除 test-utils.tsx 中 `useToolProgressStore` import 与 reset 行。

**Step 3: 更新 AppProvider 测试**
- `apps/mobile/__tests__/AppProvider.test.tsx`：所有 `tool.called/progress/success/failed`、文本/step 断言改为断言 `chatStore.messages` 结果（不再断言 toolProgressStore / `updateLastAssistant` spy）。可并行保留 `notification` handler 捕获方式。

**Step 4: 跑测试**
Run: `cd apps/mobile && npx jest AppProvider ChatScreen`
Expected: PASS

**Step 5: Commit**
```bash
git commit -am "refactor(chat): slim AppProvider to event forwarding; remove ToolProgressCard & toolProgressStore"
```

---

### Task 8: MessageList 组件 + 数据驱动滚动（TDD 纯逻辑）

**Files:**
- Create: `apps/mobile/src/components/chat/MessageList.tsx`
- Create: `apps/mobile/src/stores/scrollLogic.ts`
- Test: `apps/mobile/__tests__/scrollLogic.test.ts`

**Step 1: 写失败测试（纯函数）**

```ts
// scrollLogic.test.ts
import { computeFollow, computePrependAdjustment } from '../src/stores/scrollLogic'

it('computes follow=on when pinned and last message id/content changes', () => {
  expect(computeFollow(true, 'm1', 'Hello', 'm2', 'World')).toBe(true)
  expect(computeFollow(true, 'm1', 'Hello', 'm1', 'Hello!')).toBe(true)
  expect(computeFollow(false, 'm1', 'Hello', 'm2', 'World')).toBe(false)  // 用户上滑不跟
  expect(computeFollow(true, 'm1', 'Hello', 'm1', 'Hello')).toBe(false)   // 无变化不跟
})

it('adjusts offset upward when content prepended (header grew)', () => {
  // prev height 大 diff：diff 来自 header/顶部增长 → offset += diff
  expect(computePrependAdjustment({ prevContentHeight: 1000, newContentHeight: 1200, y: 500 }, true)).toBe(700)
})
```

**Step 2: 跑失败 → Step 3: 实现 scrollLogic.ts**

```ts
export function computeFollow(pinned: boolean, prevId: string, prevContent: string, nextId: string, nextContent: string): boolean {
  if (!pinned) return false
  return prevId !== nextId || prevContent !== nextContent
}
export function computePrependAdjustment(prev: {prevContentHeight:number;newContentHeight:number;y:number}, prepended: boolean): number {
  const diff = prev.newContentHeight - prev.prevContentHeight
  return prepended ? prev.y + diff : prev.y
}
```

**Step 4: 实现 MessageList.tsx**

```tsx
interface MessageListProps {
  messages: ChatMessage[]
  renderMessage: (item: ChatMessage) => React.ReactElement
  ListHeader?: React.ReactElement
  ListFooter?: React.ReactElement
  hasMoreHistory: boolean
  historyLoading: boolean
  onLoadMoreHistory: () => void
  onRefresh: () => void            // 手动刷新（下拉）
  refreshing: boolean
  pendingScrollToEnd: boolean       // 新会话首帧强制到底
  onPendingScrollDone: () => void
}
```

滚动逻辑要点：
- `onScroll`（throttle 16）实时更新 `pinnedToBottomRef = contentHeight - (y+layoutHeight) < 60`。
- `useEffect([messages])`：取 `last = messages[messages.length-1]`；若 `computeFollow(pinned, prevLast?.id, prevLast?.content, last?.id, last?.content)` → `scrollToEnd({animated:false})`。prevLast 用 ref 存上次值。
- `onContentSizeChange`：`prevHeight` ref 差 diff；若该帧发生 prepend → `scrollTo(diff)` 保持视口；同步更新 `prevHeight`。
- track prepend：MessageList 内部维护 `prependHeightRef`，`messages` 首元素 id 变化即判定 prepend。
- `pendingScrollToEnd` 消耗后触发一次 `scrollToEnd` + 回调 `onPendingScrollDone`。
- 下拉刷新：`RefreshControl`（onRefresh）。

**Step 5: 跑测试**
Run: `cd apps/mobile && npx jest scrollLogic MessageList`
Expected: PASS

**Step 6: Commit**
```bash
git commit -am "feat(chat): MessageList with data-driven scroll & prepend offset compensation"
```

---

### Task 9: MessageItem（memoized 单条渲染）

**Files:**
- Create: `apps/mobile/src/components/chat/MessageItem.tsx`
- Test: `apps/mobile/__tests__/MessageItem.test.tsx`

```tsx
export const MessageItem: React.FC<{ item: ChatMessage; onRevert: (messageID:string, partID?:string)=>void }> = memo(({ item, onRevert }) => {
  const isUser = item.role === 'user'
  const isSystem = item.role === 'system'
  return (
    <View style={isUser ? styles.userBubble : styles.nonUserBlock}>
      {item.agent ? <Text style={styles.messageMeta}>{item.agent}</Text> : null}
      {item.content ? (
        <MessageWrapperForFallback content={item.content} message={item as any} onRevert={onRevert}>
          <MarkdownRenderer content={item.content} />
        </MessageWrapperForFallback>
      ) : null}
      {item.parts?.map(p => <PartBlock key={p.id} part={p} message={item as any} onRevert={onRevert} />)}
    </View>
  )
})
```

- `TextPart` / `ToolPart` / `ReasoningPart` 渲染逻辑从 `ChatScreen.renderMessage` 原样迁移进 `PartBlock`（已存在），MessageItem 只做组装。
- memo 依赖：`item` 引用 + `onRevert`（用 `useCallback` 包裹）。

**测试**：渲染 user/assistant/system 三种身份、parts 渲染、memo 不重渲染（`memo` 行为用 tree re-render 计数断言可选）。

---

### Task 10: ChatScreen 重写组装

**Files:**
- Rewrite: `apps/mobile/src/screens/ChatScreen.tsx`

**Step 1: 重写结构**

```tsx
export const ChatScreen = () => {
  // 现有 header/输入区/弹层/Dock 保留
  // 变更：
  // 1. renderMessage → 用 <MessageItem>，包裹 useCallback(onRevert)
  // 2. ListFooter: 仅 {waiting && <ThinkingShimmer />}
  // 3. ListHeader: 加载更早提示（保留）
  // 4. 移除 onContentSizeChange/maintainVisibleContentPosition，改用 MessageList 内部滚动
  // 5. 新增下拉刷新 + 头部 ↻ → syncSessionMessages
  // 6. 移除 applyLoadedMessages/backfillLatestMessages 轮询；打开会话时一次 applyLoadedMessages + syncSessionMessages
}
```

**具体改动清单：**
1. 删除 `renderFooter` 中 `<ToolProgressCard />`。
2. 删除 `onScroll / onContentSizeChange / maintainVisibleContentPosition` 三个 props，FlatList 替换为 `<MessageList … />`，并传 `pendingScrollToEnd={pendingScrollToEndRef.current}`。
3. 事件驱动的消息合并：删除 25s `setInterval`；`useEffect([activeSessionId])` 内保留初始 `getSessionMessages` + 一次 `syncSessionMessages`。
4. 新增：

```ts
const [refreshing, setRefreshing] = useState(false)
const handleRefresh = async () => {
  if (!activeSessionId) return
  setRefreshing(true)
  await useChatStore.getState().syncSessionMessages(activeSessionId, clientCall)
  setRefreshing(false)
}
```

5. 头部 `↻` 按钮 `onPress={handleRefresh}`（原 handleRefreshSessions 移回 SessionsScreen 或改为刷当前会话）。
6. `handleSend`/`handleAbort` 改为调用 `sendMessage` / `abortMessage`（chatStore 新 API）。
7. 模型/代理切换、SlashSheet、SessionInfoModal、附件逻辑原样保留。

**Step 2: 跑测试**
`cd apps/mobile && npx jest ChatScreen`
Expected: PASS（Task 11 前可能需同步旧断言）

**Step 3: Commit**
```bash
git commit -am "refactor(chat): rewrite ChatScreen on MessageList + manual refresh"
```

---

### Task 11: 测试库对齐与全量校验

**Files:**
- Modify: `apps/mobile/__tests__/test-utils.tsx`
- Rewrite 影响：`apps/mobile/__tests__/AppProvider.test.tsx`
- 清理：`apps/mobile/__tests__/chatStore.test.ts`（streamStates 移除、旧 API 断言改新 API）
- 校准：`apps/mobile/__tests__/ChatScreen.test.tsx`、`apps/mobile/__tests__/interaction.test.tsx`、`apps/mobile/__tests__/appFlow.test.ts`、`apps/mobile/__tests__/chatComponents.test.tsx`

**Step 1: 逐文件修复**
- 所有 `streamStates`、`toolProgressStore`、`ToolProgressCard`、`updateLastAssistant`、`appendAssistantDelta`、`ensureAssistantMessage` 等旧引用改为 `ingestEvent` 断言。
- `resetAllStores` 移除 `streamStates` 与 toolProgressStore 行。

**Step 2: 全量跑测试**
Run: `cd apps/mobile && npx jest`
Expected: 全部 PASS

**Step 3: 类型检查**
Run: `cd apps/mobile && npx tsc --noEmit`（若缺失则 `npx tsc --noEmit -p apps/mobile`）
Expected: 0 error

**Step 4: Commit**
```bash
git commit -am "test(chat): align suites with ingest model and manual refresh"
```

---

### Task 12: Bridge 接口对齐回归

**Files:**
- Run: `cd servers/bridge && npm test`（router 契约测试不应受影响，但验证无回归）

**Step 1: 跑 Bridge 单测**
Run: `cd servers/bridge && npm test`
Expected: PASS

**Step 2: 手工冒烟（可选，需运行中服务）**
`node servers/bridge/scripts/e2e-sse.mjs` 需 `OPENCODE_URL`，若环境具备可跑；否则以 mock push 测试覆盖。

**Step 3: 收尾 Commit（如有）**
```bash
git commit --allow-empty -m "chore(chat): verify bridge contracts unaffected"
```

---

## 依赖与顺序

```
Task 1 (Markdown unified)
   └─ Task 2 (chatStore model)       ← 基础
       ├─ Task 3 (text ingest)
       ├─ Task 4 (tool ingest)
       ├─ Task 5 (waiting machine)
       └─ Task 6 (terminal states)
            └─ Task 7 (AppProvider slim + delete progress store)
                ├─ Task 8 (MessageList + scroll)
                │    └─ Task 9 (MessageItem)
                │         └─ Task 10 (ChatScreen assembly)
                └─ Task 11 (test suite alignment)
Task 12 (bridge regression)
```

## 完成定义（DoD）

- `cd apps/mobile && npx jest` 全绿；`tsc --noEmit` 0 错误；`cd servers/bridge && npm test` 全绿。
- 无 ToolProgressCard / toolProgressStore / streamStates / 旧 `components/MarkdownRenderer` 残留引用。
- ingest reducer 覆盖 text/tool/step/permission/session 事件，且会话隔离 + 终结态有测试。
- ChatScreen 无 maintainVisibleContentPosition、无 onContentSizeChange 强制滚动、无 25s 轮询。