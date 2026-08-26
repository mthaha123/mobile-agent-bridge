/**
 * chatStore tests
 *
 * Tests chat message actions: abort, shell command, write command.
 * These methods accept a clientCall function to stay decoupled from BridgeClient.
 */

import { useChatStore } from '../src/stores/chatStore'
import { useAuthStore } from '../src/stores/authStore'

function resetChatStore() {
  useChatStore.getState().resetForSession() // 撤销挂起的 idleVerify 定时器
  useChatStore.setState({
    activeSessionId: null,
    messages: [],
    inputText: '',
    waiting: false,
    sessionRunStatus: {},
  })
}

beforeEach(() => {
  resetChatStore()
})

afterEach(() => {
  resetChatStore()
})

const sessionId = 'sess-1'

// ---------------------------------------------------------------------------
// abortMessage
// ---------------------------------------------------------------------------

describe('abortMessage', () => {
  it('calls message.abort and sets waiting to false on success', async () => {
    useChatStore.setState({ waiting: true })
    const clientCall = jest.fn().mockResolvedValue(undefined)

    await useChatStore.getState().abortMessage(sessionId, clientCall)

    expect(clientCall).toHaveBeenCalledWith('message.abort', { sessionId })
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('sets waiting to false even when clientCall rejects', async () => {
    useChatStore.setState({ waiting: true })
    const clientCall = jest.fn().mockRejectedValue(new Error('abort failed'))

    await expect(useChatStore.getState().abortMessage(sessionId, clientCall)).rejects.toThrow('abort failed')

    // waiting should still be reset despite error
    expect(useChatStore.getState().waiting).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// setActiveSession
// ---------------------------------------------------------------------------

describe('setActiveSession', () => {
  it('sets active session id', () => {
    useChatStore.getState().setActiveSession('s1')
    expect(useChatStore.getState().activeSessionId).toBe('s1')
  })

  it('clears messages when switching to a different session', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      waiting: true,
    })

    useChatStore.getState().setActiveSession('s2')

    expect(useChatStore.getState().activeSessionId).toBe('s2')
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('does not clear messages when setting same session id', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    })

    useChatStore.getState().setActiveSession('s1')

    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it('sets to null', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    useChatStore.getState().setActiveSession(null)
    expect(useChatStore.getState().activeSessionId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// addMessage
// ---------------------------------------------------------------------------

describe('addMessage', () => {
  it('appends a user message', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'hello' })
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toBe('hello')
    expect(msgs[0].id).toMatch(/^msg_/)
    expect(msgs[0].timestamp).toBeGreaterThan(0)
  })

  it('appends multiple messages in order', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'first' })
    useChatStore.getState().addMessage({ role: 'assistant', content: 'second' })
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('first')
    expect(msgs[1].content).toBe('second')
  })

  it('appends system message', () => {
    useChatStore.getState().addMessage({ role: 'system', content: 'error occurred' })
    expect(useChatStore.getState().messages[0].role).toBe('system')
  })

  it('merges parts when same messageID already exists without parts', () => {
    useChatStore.getState().addMessage({ role: 'assistant', content: '', messageID: 'msg_tool1' })
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: '',
      messageID: 'msg_tool1',
      parts: [{ id: 'p1', type: 'tool', data: { tool: 'bash', input: { command: 'ls' } } }] as any,
    })
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].parts).toHaveLength(1)
    expect(msgs[0].parts?.[0].type).toBe('tool')
  })

  it('keeps existing parts untouched when re-adding same messageID with parts', () => {
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: 'hi',
      messageID: 'msg_tool2',
      parts: [{ id: 'p1', type: 'tool', data: { tool: 'read', input: { filePath: '/a' } } }] as any,
    })
    useChatStore.getState().addMessage({
      role: 'assistant',
      content: 'hi',
      messageID: 'msg_tool2',
      parts: [{ id: 'pX', type: 'tool', data: { tool: 'grep', input: {} } }] as any,
    })
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].parts).toHaveLength(1)
    expect(msgs[0].parts?.[0].data.tool).toBe('read')
  })
})

// ---------------------------------------------------------------------------
// prependMessages
// ---------------------------------------------------------------------------

describe('prependMessages', () => {
  it('prepends older messages before existing ones', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'recent' })
    useChatStore.getState().prependMessages([
      { id: 'old1', messageID: 'msg_old1', role: 'user', content: 'oldest', timestamp: 1 } as any,
      { id: 'old2', messageID: 'msg_old2', role: 'assistant', content: 'older', timestamp: 2 } as any,
    ])
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(3)
    expect(msgs[0].content).toBe('oldest')
    expect(msgs[1].content).toBe('older')
    expect(msgs[2].content).toBe('recent')
  })

  it('dedupes by messageID when prepending', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'recent', messageID: 'msg_exist' } as any)
    useChatStore.getState().prependMessages([
      { id: 'old1', messageID: 'msg_exist', role: 'user', content: 'recent', timestamp: 1 } as any,
      { id: 'old2', messageID: 'msg_new', role: 'assistant', content: 'older', timestamp: 2 } as any,
    ])
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('older')
    expect(msgs[1].content).toBe('recent')
  })

  it('keeps list unchanged when no fresh messages', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'a', messageID: 'msg_a' } as any)
    useChatStore.getState().prependMessages([
      { id: 'x', messageID: 'msg_a', role: 'user', content: 'a', timestamp: 1 } as any,
    ])
    expect(useChatStore.getState().messages).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// setInputText
// ---------------------------------------------------------------------------

describe('setInputText', () => {
  it('updates input text', () => {
    useChatStore.getState().setInputText('hello world')
    expect(useChatStore.getState().inputText).toBe('hello world')
  })

  it('clears input text', () => {
    useChatStore.setState({ inputText: 'old' })
    useChatStore.getState().setInputText('')
    expect(useChatStore.getState().inputText).toBe('')
  })
})

// ---------------------------------------------------------------------------
// setWaiting
// ---------------------------------------------------------------------------

describe('setWaiting', () => {
  it('sets waiting to true', () => {
    useChatStore.getState().setWaiting(true)
    expect(useChatStore.getState().waiting).toBe(true)
  })

  it('sets waiting to false', () => {
    useChatStore.setState({ waiting: true })
    useChatStore.getState().setWaiting(false)
    expect(useChatStore.getState().waiting).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// clearMessages
// ---------------------------------------------------------------------------

describe('clearMessages', () => {
  it('clears messages and waiting state', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      waiting: true,
    })

    useChatStore.getState().clearMessages()

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().waiting).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// updateLastAssistant
// ---------------------------------------------------------------------------

describe('updateLastAssistant', () => {
  it('appends text to last assistant message', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'user', content: 'q', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'part1', timestamp: 2 },
      ],
    })

    useChatStore.getState().updateLastAssistant('part2')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].content).toBe('part1part2')
  })

  it('creates new assistant message when none exists', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'q', timestamp: 1 }],
    })

    useChatStore.getState().updateLastAssistant('new response')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].content).toBe('new response')
  })

  it('creates new assistant message on empty messages', () => {
    useChatStore.getState().updateLastAssistant('only response')

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].role).toBe('assistant')
    expect(useChatStore.getState().messages[0].content).toBe('only response')
  })
})

// ---------------------------------------------------------------------------
// appendAssistantDelta
// ---------------------------------------------------------------------------

describe('appendAssistantDelta', () => {
  it('appends sequential deltas starting from -1', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'Hello', 0)
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello')

    useChatStore.getState().appendAssistantDelta('msg-1', ' world', 1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello world')
  })

  it('buffers out-of-order deltas and flushes when sequence completes', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'A', 0)
    expect(useChatStore.getState().messages[0].content).toBe('A')

    useChatStore.getState().appendAssistantDelta('msg-1', 'C', 2)

    let msgs = useChatStore.getState().messages
    expect(msgs[0].content).toBe('A')

    useChatStore.getState().appendAssistantDelta('msg-1', 'B', 1)

    msgs = useChatStore.getState().messages
    expect(msgs[0].content).toBe('ABC')
  })

  it('discards duplicate eventId', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'A', 0)
    useChatStore.getState().appendAssistantDelta('msg-1', 'A-dup', 0)

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('A')
  })

  it('discards eventId less than lastApplied', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'A', 0)
    useChatStore.getState().appendAssistantDelta('msg-1', 'B', 1)
    useChatStore.getState().appendAssistantDelta('msg-1', 'old', 0)

    expect(useChatStore.getState().messages[0].content).toBe('AB')
  })

  it('creates assistant message when none exists', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'first', 0)
    const msgs = useChatStore.getState().messages
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].content).toBe('first')
  })

  it('appends string eventId deltas in arrival order (SDK v3 evt_)', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'Hello ', 'evt_a')
    useChatStore.getState().appendAssistantDelta('msg-1', 'world', 'evt_b')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].content).toBe('Hello world')
    expect(msgs[0].messageID).toBe('msg-1')
  })

  it('appends delta to the correct assistant message by messageID, not just last', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'user', content: 'q1', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'answer1', timestamp: 2, messageID: 'ans-1' },
        { id: 'm3', role: 'user', content: 'q2', timestamp: 3 },
        { id: 'm4', role: 'assistant', content: 'partial', timestamp: 4, messageID: 'ans-2' },
      ],
    })

    useChatStore.getState().appendAssistantDelta('ans-1', ' more', 'evt_c')

    const msgs = useChatStore.getState().messages
    expect(msgs[1].content).toBe('answer1 more')
    expect(msgs[3].content).toBe('partial')
  })

  it('creates a fresh assistant message when delta references unknown messageID', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'user', content: 'q', timestamp: 1 },
      ],
    })

    useChatStore.getState().appendAssistantDelta('new-ans', 'fresh', 'evt_x')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].messageID).toBe('new-ans')
    expect(msgs[1].content).toBe('fresh')
  })

  it('advanceStreamId ignores string eventId (no numeric ordering possible)', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'A', 0)
    useChatStore.getState().appendAssistantDelta('msg-1', 'C', 2)

    useChatStore.getState().advanceStreamId('msg-1', 'evt_x')

    // 字符串无法推进数值序列 → 不 flush，buffer 保留
    expect(useChatStore.getState().messages[0].content).toBe('A')
  })
})

// ---------------------------------------------------------------------------
// advanceStreamId
// ---------------------------------------------------------------------------

describe('advanceStreamId', () => {
  it('flushes buffered deltas up to the advanced id', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'B', 1)

    useChatStore.getState().advanceStreamId('msg-1', 1)

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('B')
  })

  it('does nothing for duplicate or older eventId', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'A', 0)
    useChatStore.getState().advanceStreamId('msg-1', 0)

    expect(useChatStore.getState().messages[0].content).toBe('A')
  })

  it('flushes multiple buffered deltas in sequence', () => {
    useChatStore.getState().appendAssistantDelta('msg-1', 'A', 0)
    useChatStore.getState().appendAssistantDelta('msg-1', 'C', 2)
    useChatStore.getState().appendAssistantDelta('msg-1', 'B', 1)

    useChatStore.getState().advanceStreamId('msg-1', 2)

    expect(useChatStore.getState().messages[0].content).toBe('ABC')
  })
})

// ---------------------------------------------------------------------------
// finalizeAssistantContent
// ---------------------------------------------------------------------------

describe('finalizeAssistantContent', () => {
  it('overrides last assistant message content', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'user', content: 'q', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'partial', timestamp: 2 },
      ],
    })

    useChatStore.getState().finalizeAssistantContent('msg-1', 'final text')

    const msgs = useChatStore.getState().messages
    expect(msgs[1].content).toBe('final text')
  })

  it('creates assistant message when none exists', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'q', timestamp: 1 }],
    })

    useChatStore.getState().finalizeAssistantContent('msg-1', 'new assistant')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].content).toBe('new assistant')
  })

  it('finalizes by messageID, not just the last assistant message', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'user', content: 'q1', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'ans1', timestamp: 2, messageID: 'ans-1' },
        { id: 'm3', role: 'user', content: 'q2', timestamp: 3 },
        { id: 'm4', role: 'assistant', content: 'ans2 partial', timestamp: 4, messageID: 'ans-2' },
      ],
    })

    useChatStore.getState().finalizeAssistantContent('ans-1', 'ans1 FINAL')

    const msgs = useChatStore.getState().messages
    expect(msgs[1].content).toBe('ans1 FINAL')
    expect(msgs[3].content).toBe('ans2 partial')
  })

  it('clears delta buffer and marks message complete on finalize', () => {
    useChatStore.setState({
      messages: [{
        id: 'm1', role: 'assistant', content: 'partial', timestamp: 1, messageID: 'msg-1',
        status: 'streaming', deltaBuffer: { 4: 'buffered' }, lastAppliedDeltaId: 3,
      } as any],
    })

    useChatStore.getState().finalizeAssistantContent('msg-1', 'done')

    const msg = useChatStore.getState().messages[0]
    expect(msg.content).toBe('done')
    expect(msg.status).toBe('complete')
    expect(msg.deltaBuffer).toBeUndefined()
    expect(msg.lastAppliedDeltaId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// upsertUserMessage / ensureAssistantMessage / applyServerMessage
// ---------------------------------------------------------------------------

describe('upsertUserMessage', () => {
  it('inserts a new user message with the server messageID', () => {
    useChatStore.getState().upsertUserMessage('um-1', 'hello from server')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toBe('hello from server')
    expect(msgs[0].messageID).toBe('um-1')
  })

  it('updates content for an existing messageID in place', () => {
    useChatStore.getState().upsertUserMessage('um-1', 'first')
    useChatStore.getState().upsertUserMessage('um-1', 'second')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('second')
  })

  it('backfills messageID on a locally-optimistic user message to avoid duplicates', () => {
    useChatStore.getState().addMessage({ role: 'user', content: 'local send' })
    useChatStore.getState().upsertUserMessage('um-9', 'local send')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].messageID).toBe('um-9')
    expect(msgs[0].content).toBe('local send')
  })

  it('ignores empty messageID', () => {
    useChatStore.getState().upsertUserMessage('', 'x')
    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})

describe('ensureAssistantMessage', () => {
  it('creates an assistant placeholder with the server messageID', () => {
    useChatStore.getState().ensureAssistantMessage('ams-1')
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].content).toBe('')
    expect(msgs[0].messageID).toBe('ams-1')
  })

  it('does not duplicate an existing messageID', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'assistant', content: '', timestamp: 1, messageID: 'ams-1' }] as any,
    })
    useChatStore.getState().ensureAssistantMessage('ams-1')
    expect(useChatStore.getState().messages).toHaveLength(1)
  })
})

describe('applyServerMessage', () => {
  it('inserts a message that does not exist yet', () => {
    useChatStore.getState().applyServerMessage('assistant', 'sv-1', 'server content')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].content).toBe('server content')
    expect(msgs[0].messageID).toBe('sv-1')
  })

  it('inserts a new message at the correct chronological position when it is older than existing messages (recovered after SSE gap)', () => {
    // 场景：SSE 中断时 prompt.admitted 丢失，assistant 占位已由 live 事件创建
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'assistant', content: 'answer text', timestamp: 2000, messageID: 'ams-1' } as any,
      ],
    })

    // 兜底 backfill 恢复出更早的用户消息，必须插到 assistant 之前而非列表末尾
    useChatStore.getState().applyServerMessage('user', 'um-1', 'missed question', 1000)

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toBe('missed question')
    expect(msgs[0].messageID).toBe('um-1')
    expect(msgs[1].messageID).toBe('ams-1')
  })

  it('appends when the new message is newer than all existing messages', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'assistant', content: 'old answer', timestamp: 1000, messageID: 'ams-1' } as any,
      ],
    })

    useChatStore.getState().applyServerMessage('user', 'um-2', 'newer question', 3000)

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0].messageID).toBe('ams-1')
    expect(msgs[1].messageID).toBe('um-2')
  })

  it('replaces content for an existing messageID', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'assistant', content: 'old', timestamp: 1, messageID: 'sv-1' }] as any,
    })
    useChatStore.getState().applyServerMessage('assistant', 'sv-1', 'new authoritative')

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('new authoritative')
  })

  it('does not duplicate the same messageID', () => {
    useChatStore.getState().applyServerMessage('user', 'sv-2', 'a')
    useChatStore.getState().applyServerMessage('user', 'sv-2', 'a')
    expect(useChatStore.getState().messages).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// addToolPart / updateToolPart
// ---------------------------------------------------------------------------

describe('addToolPart', () => {
  it('appends tool part to last assistant message', () => {
    useChatStore.setState({
      messages: [
        { id: 'm1', role: 'user', content: 'q', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: '', timestamp: 2 },
      ],
    })

    useChatStore.getState().addToolPart({
      id: 'call_1',
      type: 'tool',
      data: { tool: 'read', input: { path: 'a.txt' }, status: 'called' },
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].parts).toEqual([
      { id: 'call_1', type: 'tool', data: { tool: 'read', input: { path: 'a.txt' }, status: 'called' } },
    ])
  })

  it('creates assistant message when last message is user', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'q', timestamp: 1 }],
    })

    useChatStore.getState().addToolPart({
      id: 'call_1',
      type: 'tool',
      data: { tool: 'bash', input: { command: 'ls' }, status: 'called' },
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].parts).toHaveLength(1)
    expect(msgs[1].parts![0].id).toBe('call_1')
  })

  it('does not duplicate a part with the same id', () => {
    useChatStore.setState({
      messages: [
        { id: 'm2', role: 'assistant', content: '', timestamp: 2, parts: [
          { id: 'call_1', type: 'tool', data: { tool: 'bash', input: {}, status: 'called' } },
        ] },
      ],
    })

    useChatStore.getState().addToolPart({
      id: 'call_1',
      type: 'tool',
      data: { tool: 'bash', input: {}, status: 'called' },
    })

    const msgs = useChatStore.getState().messages
    expect(msgs[0].parts).toHaveLength(1)
  })
})

describe('updateToolPart', () => {
  it('updates part data by callID', () => {
    useChatStore.setState({
      messages: [
        { id: 'm2', role: 'assistant', content: '', timestamp: 2, parts: [
          { id: 'call_1', type: 'tool', data: { tool: 'bash', input: {}, status: 'called' } },
        ] },
      ],
    })

    useChatStore.getState().updateToolPart('call_1', { status: 'success', result: 'ok' })

    const msgs = useChatStore.getState().messages
    expect(msgs[0].parts![0].data).toMatchObject({ status: 'success', result: 'ok' })
  })

  it('leaves messages unchanged when no part matches', () => {
    useChatStore.setState({
      messages: [
        { id: 'm2', role: 'assistant', content: '', timestamp: 2, parts: [
          { id: 'call_1', type: 'tool', data: { tool: 'bash', input: {}, status: 'called' } },
        ] },
      ],
    })

    useChatStore.getState().updateToolPart('call_unknown', { status: 'success' })

    const msgs = useChatStore.getState().messages
    expect(msgs[0].parts![0].data.status).toBe('called')
  })
})

describe('applyServerMessages (with parts)', () => {
  it('inserts a new message with parts and keeps them', () => {
    useChatStore.getState().applyServerMessages([
      {
        role: 'assistant',
        messageID: 'sv-t1',
        content: 'running',
        timestamp: 1000,
        parts: [{ id: 'p1', type: 'tool', data: { tool: 'bash', input: { command: 'ls' }, status: 'success' } } as any],
      },
    ])
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].parts).toHaveLength(1)
    expect(msgs[0].parts![0].data.tool).toBe('bash')
  })

  it('merges parts into an existing message that previously had none (backfill-then-load race)', () => {
    // 模拟方式 B 先插入：无 parts
    useChatStore.getState().applyServerMessages([
      { role: 'assistant', messageID: 'sv-t2', content: 'thinking...', timestamp: 2000 },
    ])
    // 模拟方式 A 后到：带 parts，应合并而非丢弃
    useChatStore.getState().applyServerMessages([
      {
        role: 'assistant',
        messageID: 'sv-t2',
        content: 'thinking...',
        timestamp: 2000,
        parts: [{ id: 'p2', type: 'tool', data: { tool: 'read', input: { filePath: '/a.txt' }, status: 'success' } } as any],
      },
    ])
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].parts).toHaveLength(1)
    expect(msgs[0].parts![0].data.tool).toBe('read')
  })
})

// ---------------------------------------------------------------------------
// sessionRunStatus（全局会话运行状态订阅）
// ---------------------------------------------------------------------------

describe('sessionRunStatus', () => {
  it('fetchSessionRunStatus: 快照含该会话 → busy', async () => {
    const clientCall = jest.fn().mockResolvedValue({
      data: { 'sess-1': { type: 'running' }, 'sess-2': { type: 'running' } },
    })
    await useChatStore.getState().fetchSessionRunStatus('sess-1', clientCall)
    expect(clientCall).toHaveBeenCalledWith('session.status', {})
    expect(useChatStore.getState().sessionRunStatus['sess-1']).toBe('busy')
  })

  it('fetchSessionRunStatus: 快照缺席该会话 → idle', async () => {
    const clientCall = jest.fn().mockResolvedValue({
      data: { 'sess-2': { type: 'running' } },
    })
    await useChatStore.getState().fetchSessionRunStatus('sess-1', clientCall)
    expect(useChatStore.getState().sessionRunStatus['sess-1']).toBe('idle')
  })

  it('fetchSessionRunStatus: 兼容平铺快照形态', async () => {
    const clientCall = jest.fn().mockResolvedValue({
      'sess-1': { type: 'running' },
    })
    await useChatStore.getState().fetchSessionRunStatus('sess-1', clientCall)
    expect(useChatStore.getState().sessionRunStatus['sess-1']).toBe('busy')
  })

  it('fetchSessionRunStatus: 查询失败静默，保持现状', async () => {
    useChatStore.setState({ sessionRunStatus: { 'sess-1': 'busy' } })
    const clientCall = jest.fn().mockRejectedValue(new Error('boom'))
    await useChatStore.getState().fetchSessionRunStatus('sess-1', clientCall)
    expect(useChatStore.getState().sessionRunStatus['sess-1']).toBe('busy')
  })

  it('syncSessionRunStatus: 快照标记运行中、校正残留 busy', async () => {
    useChatStore.setState({ sessionRunStatus: { 'sess-old': 'busy', 'sess-run': 'idle' } })
    const clientCall = jest.fn().mockResolvedValue({
      data: { 'sess-run': { type: 'running' } },
    })
    await useChatStore.getState().syncSessionRunStatus(clientCall)
    const st = useChatStore.getState().sessionRunStatus
    expect(st['sess-run']).toBe('busy')
    expect(st['sess-old']).toBe('idle') // 快照缺席 → 服务端视为 inactive
  })

  it('syncSessionRunStatus: 查询失败静默', async () => {
    useChatStore.setState({ sessionRunStatus: { 'sess-1': 'busy' } })
    const clientCall = jest.fn().mockRejectedValue(new Error('boom'))
    await useChatStore.getState().syncSessionRunStatus(clientCall)
    expect(useChatStore.getState().sessionRunStatus['sess-1']).toBe('busy')
  })
})

// ---------------------------------------------------------------------------
// 工具终态缺失自愈（2026-08 红方块 bug）
//
// 上游缺陷：opencode serve 偶发不发出单条 tool.success/failed（bash 挂起/
// 回合中断），且从不广播 session.status/session.idle。回合其余内容正常
// 收尾后，卡住的工具卡片没有任何触发器去核查 → 永久显示运行中。
// ---------------------------------------------------------------------------

describe('工具终态缺失自愈', () => {
  /** 跑完一整个回合，但唯独缺 tool.success */
  function runRoundWithoutToolEnd(callID = 'c1') {
    const ing = useChatStore.getState().ingestEvent
    const sid = 'sess-1'
    ing('session.next.prompt.admitted', { sessionID: sid, messageID: 'um1', prompt: 'hi' })
    ing('session.next.step.started', { sessionID: sid })
    ing('session.next.tool.called', { sessionID: sid, callID, tool: 'bash', input: {}, assistantMessageID: 'am1' })
    ing('session.next.text.started', { sessionID: sid, assistantMessageID: 'am1' })
    ing('session.next.text.delta', { sessionID: sid, assistantMessageID: 'am1', delta: 'hello' })
    ing('session.next.text.ended', { sessionID: sid, assistantMessageID: 'am1', text: 'hello' })
    ing('session.next.step.ended', { sessionID: sid })
  }

  function getToolPart(callID = 'c1') {
    for (const m of useChatStore.getState().messages) {
      const p = m.parts?.find((x) => x.id === callID)
      if (p) return p
    }
    return undefined
  }

  beforeEach(() => {
    jest.useFakeTimers()
    resetChatStore()
    useChatStore.setState({ activeSessionId: 'sess-1', pendingSteps: 0, waiting: false, lastActivityAt: Date.now() })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('回合收尾后仍有 open 工具时自动核查：快照 idle → 结算为 failed', async () => {
    runRoundWithoutToolEnd()

    // 回合已收尾但工具卡片仍停留在 called（复现红方块）。
    // 新语义：收尾不再立即解锁 waiting——保持 true，由下方快照核查统一裁决
    expect(useChatStore.getState().waiting).toBe(true)
    expect(useChatStore.getState().pendingSteps).toBe(0)
    expect(getToolPart()!.data.status).toBe('called')

    // 权威快照确认会话空闲（server 不广播 idle，只能 RPC 核查）
    const client = { call: jest.fn().mockResolvedValue({}) } as any
    useAuthStore.setState({ client: client as never })

    await jest.advanceTimersByTimeAsync(2600)

    expect(client.call).toHaveBeenCalledWith('session.status', {})
    expect(getToolPart()!.data.status).toBe('failed')
  })

  it('核查时同步拉取权威消息：服务端已 completed 则恢复真实结果而非误标失败', async () => {
    runRoundWithoutToolEnd()

    const client = {
      call: jest.fn(async (method: string) => {
        if (method === 'session.messages') {
          return [{
            info: { id: 'am1', role: 'assistant' },
            parts: [{
              type: 'tool',
              callID: 'c1',
              tool: 'bash',
              state: { status: 'completed', metadata: { output: 'done-out' } },
            }],
          }]
        }
        return {} // session.status → 缺席即 idle
      }),
    } as any
    useAuthStore.setState({ client: client as never })

    await jest.advanceTimersByTimeAsync(2600)

    expect(client.call).toHaveBeenCalledWith('session.messages', expect.objectContaining({ sessionId: 'sess-1' }))
    const part = getToolPart()!
    expect(part.data.status).toBe('success')
    expect(part.data.result).toBe('done-out')
  })
})

// ---------------------------------------------------------------------------
// 思考流分通道（2026-08：修复"长文消失/无思考标签"）
// ---------------------------------------------------------------------------

describe('思考流分通道', () => {
  const SID = 'sess-think'
  function findReasoningPart() {
    for (const m of useChatStore.getState().messages) {
      const p = m.parts?.find((x) => x.type === 'reasoning')
      if (p) return p
    }
    return undefined
  }

  beforeEach(() => {
    resetChatStore()
    useChatStore.setState({ activeSessionId: SID })
  })

  it('reasoning.delta 写入独立思考 part，不污染正文 content', () => {
    const ing = useChatStore.getState().ingestEvent
    ing('session.next.reasoning.started', { sessionID: SID, assistantMessageID: 'am-r' })
    ing('session.next.reasoning.delta', { sessionID: SID, assistantMessageID: 'am-r', delta: '先分析' })
    ing('session.next.reasoning.delta', { sessionID: SID, assistantMessageID: 'am-r', delta: '再验证' })

    const part = findReasoningPart()
    expect(part).toBeDefined()
    expect(part!.data.content).toBe('先分析再验证')

    // 正文通道未被污染
    const msg = useChatStore.getState().messages.find((m) => m.messageID === 'am-r')
    expect(msg!.content).toBe('')
  })

  it('混流回合：R+T 同 messageID，text.ended 覆盖正文后思考块保留', () => {
    const ing = useChatStore.getState().ingestEvent
    ing('session.next.step.started', { sessionID: SID })
    ing('session.next.reasoning.started', { sessionID: SID, assistantMessageID: 'am1' })
    ing('session.next.reasoning.delta', { sessionID: SID, assistantMessageID: 'am1', delta: '长篇思考' })
    ing('session.next.text.started', { sessionID: SID, assistantMessageID: 'am1' })
    ing('session.next.text.delta', { sessionID: SID, assistantMessageID: 'am1', delta: '答' })
    ing('session.next.text.ended', { sessionID: SID, assistantMessageID: 'am1', text: '答案正文' })

    const msg = useChatStore.getState().messages.find((m) => m.messageID === 'am1')
    // 正文被权威全文覆盖为纯答案——思考不丢失
    expect(msg!.content).toBe('答案正文')
    const rp = findReasoningPart()
    expect(rp).toBeDefined()
    expect(rp!.data.content).toBe('长篇思考')
  })

  it('message.part.updated 携带 reasoning part 时按类型合入（持久化通道对齐）', () => {
    const ing = useChatStore.getState().ingestEvent
    ing('session.next.reasoning.started', { sessionID: SID, assistantMessageID: 'am2' })
    ing('session.next.reasoning.delta', { sessionID: SID, assistantMessageID: 'am2', delta: 'local' })

    ing('message.part.updated', {
      sessionID: SID,
      part: { id: 'prt_x', type: 'reasoning', messageID: 'am2', text: 'server-authoritative' },
    })

    // 服务端权威覆盖本地累计，且仍是同一个思考块（不双份）
    const msg = useChatStore.getState().messages.find((m) => m.messageID === 'am2')
    const rps = msg!.parts!.filter((p) => p.type === 'reasoning')
    expect(rps).toHaveLength(1)
    expect(rps[0].data.content).toBe('server-authoritative')
  })
})

describe('busy 期条件轮询', () => {
  function makeClient(statusMap: Record<string, unknown> | 'fail') {
    return {
      call: jest.fn(async (method: string) => {
        if (method === 'session.status') {
          if (statusMap === 'fail') throw new Error('blip')
          return statusMap
        }
        return []
      }),
    } as any
  }

  beforeEach(() => {
    jest.useFakeTimers()
    resetChatStore()
    useChatStore.setState({ activeSessionId: 'sess-1', pendingSteps: 0, waiting: false, lastActivityAt: Date.now() })
  })

  afterEach(() => {
    useChatStore.getState().stopStatusPolling()
    jest.useRealTimers()
  })

  it('运行态启动轮询：5s 内发出 session.status 查询', async () => {
    const client = makeClient({}) // 缺席 → idle
    useAuthStore.setState({ client: client as never })

    useChatStore.getState().ingestEvent('session.next.step.started', { sessionID: 'sess-1' })

    await jest.advanceTimersByTimeAsync(5100)
    expect(client.call).toHaveBeenCalledWith('session.status', {})
  })

  it('快照 running → 维持运行态并继续轮询；转 idle → 解锁且停止', async () => {
    let running = true
    const client = makeClient({})
    client.call.mockImplementation(async (method: string) => {
      if (method === 'session.status') return running ? { 'sess-1': { type: 'running' } } : {}
      return []
    })

    useAuthStore.setState({ client: client as never })
    useChatStore.getState().ingestEvent('session.next.prompt.admitted', { sessionID: 'sess-1', messageID: 'u1', prompt: 'x' })
    useChatStore.getState().ingestEvent('session.next.step.started', { sessionID: 'sess-1' })

    await jest.advanceTimersByTimeAsync(5100)
    expect(useChatStore.getState().waiting).toBe(true)
    expect(useChatStore.getState().sessionRunStatus['sess-1']).toBe('busy')

    await jest.advanceTimersByTimeAsync(5100)
    expect(useChatStore.getState().waiting).toBe(true)
    const callsWhileRunning = client.call.mock.calls.filter((c: any[]) => c[0] === 'session.status').length
    expect(callsWhileRunning).toBeGreaterThanOrEqual(2)

    running = false
    await jest.advanceTimersByTimeAsync(5100)
    expect(useChatStore.getState().waiting).toBe(false)

    const callsAfterIdle = client.call.mock.calls.filter((c: any[]) => c[0] === 'session.status').length
    await jest.advanceTimersByTimeAsync(11000)
    const callsFinal = client.call.mock.calls.filter((c: any[]) => c[0] === 'session.status').length
    expect(callsFinal).toBe(callsAfterIdle) // 已停止，不再查询
  })

  it('切换活跃会话后旧会话轮询停止', async () => {
    const client = makeClient({ 'sess-1': { type: 'running' } })
    useAuthStore.setState({ client: client as never })

    useChatStore.getState().ingestEvent('session.next.step.started', { sessionID: 'sess-1' })
    await jest.advanceTimersByTimeAsync(100)

    useChatStore.setState({ activeSessionId: 'sess-2' })
    const callsAtSwitch = client.call.mock.calls.filter((c: any[]) => c[0] === 'session.status').length

    await jest.advanceTimersByTimeAsync(11000)
    const callsTotal = client.call.mock.calls.filter((c: any[]) => c[0] === 'session.status').length
    expect(callsTotal).toBe(callsAtSwitch)
  })

  it('幂等：同会话重复 ensure 不叠加定时器（tick 频率不变）', async () => {
    const client = makeClient({ 'sess-1': { type: 'running' } })
    useAuthStore.setState({ client: client as never })

    for (let i = 0; i < 10; i++) {
      useChatStore.getState().ensureStatusPolling('sess-1')
    }
    await jest.advanceTimersByTimeAsync(10100)
    const calls = client.call.mock.calls.filter((c: any[]) => c[0] === 'session.status').length
    expect(calls).toBe(2) // 单一定时器：5s、10s 各一次
  })
})
