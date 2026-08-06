/**
 * chatStore tests
 *
 * Tests chat message actions: abort, shell command, write command.
 * These methods accept a clientCall function to stay decoupled from BridgeClient.
 */

import { useChatStore } from '../src/stores/chatStore'

function resetChatStore() {
  useChatStore.setState({
    activeSessionId: null,
    messages: [],
    inputText: '',
    waiting: false,
    streamStates: {},
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
      streamStates: { x: { lastAppliedId: 0, buffer: {} } },
    })

    useChatStore.getState().setActiveSession('s2')

    expect(useChatStore.getState().activeSessionId).toBe('s2')
    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().streamStates).toEqual({})
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
  it('clears messages, waiting, and streamStates', () => {
    useChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
      waiting: true,
      streamStates: { x: { lastAppliedId: 0, buffer: {} } },
    })

    useChatStore.getState().clearMessages()

    expect(useChatStore.getState().messages).toEqual([])
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().streamStates).toEqual({})
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
      streamStates: { 'msg-1': { lastAppliedId: 5, buffer: {} } },
    })

    useChatStore.getState().finalizeAssistantContent('msg-1', 'final text')

    const msgs = useChatStore.getState().messages
    expect(msgs[1].content).toBe('final text')
    expect(useChatStore.getState().streamStates['msg-1']).toBeUndefined()
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

  it('cleans up stream state on finalize', () => {
    useChatStore.setState({
      streamStates: {
        'msg-1': { lastAppliedId: 3, buffer: { 4: 'buffered' } },
      },
    })

    useChatStore.getState().finalizeAssistantContent('msg-1', 'done')

    expect(useChatStore.getState().streamStates['msg-1']).toBeUndefined()
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
