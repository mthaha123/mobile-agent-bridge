# UI 功能缺口修复计划

> **For Claude:** Implement these tasks to close the gap between Bridge server capabilities and mobile app UI.

**Goal:** Fix 6 high-priority UI gaps: abort button, question reject, always-allow approval, token auto-refresh, auth.logout RPC, message.part.delta handler.

**Architecture:** Each gap is a self-contained change in one component/store pair, plus tests.

**Tech Stack:** React Native, Zustand, react-test-renderer

---

### Task 1: ChatScreen — Abort button during streaming

**Files:**
- Modify: `apps/mobile/src/screens/ChatScreen.tsx`
- Test: `apps/mobile/__tests__/ChatScreen.test.tsx`

**Step 1: Read source** — ChatScreen.tsx:55-80 has `handleSend`, which sets `waiting=true`. When `waiting=true`, input is disabled (confirmed by test at line 300). Need to add a Cancel/Stop button below the input when waiting.

**Step 2: Add handleAbort function** in component body:

```typescript
const handleAbort = async () => {
  const client = useAuthStore.getState().client
  if (!client || !activeSessionId) return
  await useChatStore.getState().abortMessage(activeSessionId, client.call.bind(client))
}
```

**Step 3: Add abort button in render** — when `waiting`, show a "Stop" button near the input:

In the input area (find the `onSubmitEditing` area at line ~340), add:

```tsx
{waiting && (
  <TouchableOpacity style={styles.stopButton} onPress={handleAbort}>
    <Text style={styles.stopButtonText}>■ Stop</Text>
  </TouchableOpacity>
)}
```

Add styles:
```typescript
stopButton: { ... },
stopButtonText: { ... }
```

**Step 4: Add test** — verify that when `waiting=true`, a "Stop" button appears and triggers `abortMessage`.

---

### Task 2: QuestionSheet — Reject button

**Files:**
- Modify: `apps/mobile/src/screens/QuestionSheet.tsx`
- Modify: `apps/mobile/src/components/AppProvider.tsx`
- Test: `apps/mobile/__tests__/components.test.tsx`

**Step 1: Read router.ts:240-248** — `question.reject` takes `{ id, sessionId }`.

**Step 2: Update setQuestionReplyCall to accept reject callback** — Change the module-level variable to hold both accept and reject callbacks. Or simpler: add a separate `setQuestionRejectCall`.

Approach: Keep it simple — add a separate reject callback function:

```typescript
let _questionRejectCall: ((id: string) => Promise<void>) | null = null
export function setQuestionRejectCall(cb: ((id: string) => Promise<void>) | null) { _questionRejectCall = cb }
```

In QuesitonSheet, add:

```typescript
const handleReject = async () => {
  if (!_questionRejectCall || !current) return
  await _questionRejectCall(current.id)
  removeQuestion(current.id)
}
```

In the card actions area (below Submit button), add:
```tsx
<TouchableOpacity style={styles.rejectBtn} onPress={handleReject}>
  <Text style={styles.rejectBtnText}>Reject</Text>
</TouchableOpacity>
```

In AppProvider.tsx setupClient:
```typescript
setQuestionRejectCall(async (id: string) => {
  const found = useQuestionStore.getState().pending.find((q) => q.id === id)
  if (!found) return
  await client.call('question.reject', { id, sessionId: found.sessionId })
})
```

Add teardown: `setQuestionRejectCall(null)` in `teardownClient`.

---

### Task 3: ToolApprovalSheet — Always-allow approval option

**Files:**
- Modify: `apps/mobile/src/components/AppProvider.tsx`
- Modify: `apps/mobile/src/screens/ToolApprovalSheet.tsx`
- Test: `apps/mobile/__tests__/ToolApprovalSheet.test.tsx`

**Step 1: Read router.ts:221-227** — `permission.reply` frontend.reply: `"once" | "always" | "reject"`. Server supports it.

**Step 2: Update createReplyCall** — Change to accept `reply: 'once' | 'always' | 'reject'`:

```typescript
function createReplyCall(client: BridgeClient): (id: string, reply: 'once' | 'always' | 'reject') => Promise<void> {
  return async (id: string, reply: 'once' | 'always' | 'reject') => {
    const { pendingApprovals } = useToolStore.getState()
    const item = pendingApprovals.find((a) => a.id === id)
    if (!item) return
    await client.call('permission.reply', {
      sessionId: item.sessionId, id, reply,
    })
  }
}
```

**Step 3: Update store approve/reject** — Change types to match:

```typescript
approve: async (id, replyCall) => {
  await replyCall(id, 'once')
  get().dequeue(id)
},
alwaysAllow: async (id, replyCall) => {
  await replyCall(id, 'always')
  get().dequeue(id)
},
reject: async (id, replyCall) => {
  await replyCall(id, 'reject')
  get().dequeue(id)
},
```

**Step 4: Update ToolApprovalSheet** — Add third button:

```tsx
<TouchableOpacity style={[styles.actionButton, styles.alwaysButton]} onPress={() => handleAlwaysAllow(pending.id)}>
  <Text style={styles.actionButtonText}>Always Allow</Text>
</TouchableOpacity>
```

Add `handleAlwaysAllow`:
```typescript
const handleAlwaysAllow = async (id: string) => {
  if (_replyCall) {
    await alwaysAllow(id, _replyCall)
  }
}
```

---

### Task 4: Token auto-refresh mechanism

**Files:**
- Modify: `apps/mobile/src/components/AppProvider.tsx`
- Test: `apps/mobile/__tests__/AppProvider.test.tsx`

**Step 1: Add refresh interval** — In `setupClient`, after setting up callbacks, start a periodic token refresh:

```typescript
const refreshInterval = setInterval(async () => {
  try {
    await useAuthStore.getState().refreshToken()
  } catch {}
}, 25 * 60 * 1000) // 25 minutes (token TTL is 1h)
```

Store the interval ID on `clientRef` or a module-level variable.

**Step 2: Clear interval in teardownClient**:

```typescript
if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
```

**Step 3: Verify** — `authStore.refreshToken()` already exists at authStore.ts:105-117.

---

### Task 5: auth.logout RPC call on logout

**Files:**
- Modify: `apps/mobile/src/stores/authStore.ts`
- Test: `apps/mobile/__tests__/authStore.test.ts`

**Step 1: Modify logout** — Before destroying client, send `auth.logout`:

```typescript
logout: async () => {
  const { client } = get()
  if (client) {
    try { await client.call('auth.logout', {}) } catch {}
    client.destroy()
  }
  set({
    client: null, token: null, authenticated: false,
    bridgeUrl: '', loading: false, error: null,
  })
},
```

---

### Task 6: Register message.part.delta handler

**Files:**
- Modify: `apps/mobile/src/components/AppProvider.tsx`
- Test: `apps/mobile/__tests__/AppProvider.test.tsx`

**Step 1: Add handler** — In the notification handler chain, add after text.delta handler (~line 68):

```typescript
if (method === 'message.part.delta') {
  const delta = payload?.data?.delta || payload?.delta || ''
  const msgId = payload?.assistantMessageID || payload?.data?.assistantMessageID || ''
  const eventId = payload?.eventId
  if (delta && msgId && typeof eventId === 'number') {
    useChatStore.getState().appendAssistantDelta(msgId, delta, eventId)
  } else if (delta) {
    useChatStore.getState().updateLastAssistant(delta)
  }
}
```

---

## Test assertions

After each change, run: `cd apps/mobile && npx jest --silent --forceExit --testTimeout=20000`
