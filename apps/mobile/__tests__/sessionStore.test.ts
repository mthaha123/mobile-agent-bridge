/**
 * sessionStore tests
 *
 * Tests session CRUD and advanced operations: get, messages, update, rename,
 * todo, diff, fork, revert, unrevert.
 * Mocks BridgeClient to isolate session store logic.
 */

jest.mock('../src/services/BridgeClient', () => ({
  BridgeClient: jest.fn().mockImplementation(() => ({
    call: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
    connected: true,
    token: 'mock-token',
  })),
}))

import { useSessionStore, Session } from '../src/stores/sessionStore'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const mockSession: Session = {
  id: 'sess-1',
  name: 'Test Session',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T01:00:00Z',
  messageCount: 3,
}

const mockSession2: Session = {
  id: 'sess-2',
  name: 'Another Session',
  createdAt: '2024-01-02T00:00:00Z',
  updatedAt: '2024-01-02T01:00:00Z',
  messageCount: 0,
}

function mockClientCall(): jest.Mock<Promise<unknown>, [string, unknown?]> {
  return jest.fn<Promise<unknown>, [string, unknown?]>()
}

function resetStore() {
  useSessionStore.setState({
    sessions: [],
    loading: false,
    error: null,
  })
}

beforeEach(() => {
  resetStore()
  jest.clearAllMocks()
})

afterEach(() => {
  resetStore()
})

// ---------------------------------------------------------------------------
// setSessions / addSession / removeSession / patchSession
// ---------------------------------------------------------------------------

describe('local state mutations', () => {
  it('setSessions replaces sessions', () => {
    useSessionStore.getState().setSessions([mockSession])
    expect(useSessionStore.getState().sessions).toEqual([mockSession])
  })

  it('addSession prepends a session', () => {
    useSessionStore.getState().setSessions([mockSession])
    useSessionStore.getState().addSession(mockSession2)
    expect(useSessionStore.getState().sessions).toEqual([mockSession2, mockSession])
  })

  it('removeSession removes by id', () => {
    useSessionStore.getState().setSessions([mockSession, mockSession2])
    useSessionStore.getState().removeSession('sess-1')
    expect(useSessionStore.getState().sessions).toEqual([mockSession2])
  })

  it('patchSession updates a session in place', () => {
    useSessionStore.getState().setSessions([mockSession])
    useSessionStore.getState().patchSession('sess-1', { name: 'Updated' })
    expect(useSessionStore.getState().sessions[0].name).toBe('Updated')
  })
})

// ---------------------------------------------------------------------------
// fetchSessions
// ---------------------------------------------------------------------------

describe('fetchSessions', () => {
  it('handles v2 array response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([mockSession, mockSession2])

    await useSessionStore.getState().fetchSessions(clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.list', {})
    const state = useSessionStore.getState()
    expect(state.sessions).toEqual([mockSession, mockSession2])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
  })

  it('maps SDK session shape (title/time) into app Session', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([
      { id: 'sdk-1', title: 'REAL-E2E-OK', time: { created: 1785480695714, updated: 1785480700000 } },
    ])

    await useSessionStore.getState().fetchSessions(clientCall)

    const sessions = useSessionStore.getState().sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('sdk-1')
    expect(sessions[0].name).toBe('REAL-E2E-OK')
    expect(sessions[0].createdAt).toBe('2026-07-31T06:51:35.714Z')
    expect(sessions[0].updatedAt).toBe('2026-07-31T06:51:40.000Z')
    expect(sessions[0].messageCount).toBe(0)
  })

  it('handles v1 { sessions } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ sessions: [mockSession] })

    await useSessionStore.getState().fetchSessions(clientCall)

    expect(useSessionStore.getState().sessions).toEqual([mockSession])
    expect(useSessionStore.getState().loading).toBe(false)
  })

  it('sets error on failure', async () => {
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('network error'))

    await useSessionStore.getState().fetchSessions(clientCall)

    const state = useSessionStore.getState()
    expect(state.error).toBe('network error')
    expect(state.loading).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('creates and adds a session, returns its id', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(mockSession)

    const id = await useSessionStore.getState().createSession(clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.create', {})
    expect(id).toBe('sess-1')
    expect(useSessionStore.getState().sessions).toEqual([mockSession])
  })

  it('handles v1 { session } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ session: mockSession })

    const id = await useSessionStore.getState().createSession(clientCall)

    expect(id).toBe('sess-1')
    expect(useSessionStore.getState().sessions).toEqual([mockSession])
  })

  it('returns null when session has no id', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ name: 'no-id' })

    const id = await useSessionStore.getState().createSession(clientCall)

    expect(id).toBeNull()
  })

  it('returns null on error and sets error', async () => {
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('create failed'))

    const id = await useSessionStore.getState().createSession(clientCall)

    expect(id).toBeNull()
    expect(useSessionStore.getState().error).toBe('create failed')
  })

  it('maps SDK session title to app Session name on create', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ id: 'sdk-new', title: 'New Session', time: { created: 1785480695714, updated: 1785480695714 } })

    const id = await useSessionStore.getState().createSession(clientCall)

    expect(id).toBe('sdk-new')
    const session = useSessionStore.getState().sessions[0]
    expect(session.name).toBe('New Session')
  })
})

// ---------------------------------------------------------------------------
// renameSession
// ---------------------------------------------------------------------------

describe('renameSession', () => {
  it('calls session.rename and patches local title from server response', async () => {
    useSessionStore.setState({ sessions: [{ ...mockSession }] })
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ id: 'sess-1', title: 'Renamed Session', time: { updated: 1700000000000 } })

    const result = await useSessionStore.getState().renameSession('sess-1', 'Renamed Session', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.rename', { sessionId: 'sess-1', title: 'Renamed Session' })
    expect(useSessionStore.getState().sessions[0].name).toBe('Renamed Session')
    expect(result?.name).toBe('Renamed Session')
  })

  it('trims the title before sending', async () => {
    useSessionStore.setState({ sessions: [{ ...mockSession }] })
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ id: 'sess-1', title: 'Trimmed' })

    await useSessionStore.getState().renameSession('sess-1', '  Trimmed  ', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.rename', { sessionId: 'sess-1', title: 'Trimmed' })
  })

  it('falls back to local title when response lacks name mapping', async () => {
    useSessionStore.setState({ sessions: [{ ...mockSession }] })
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({})

    await useSessionStore.getState().renameSession('sess-1', 'Fallback Name', clientCall)

    expect(useSessionStore.getState().sessions[0].name).toBe('Fallback Name')
  })

  it('returns null for empty/blank title without calling the bridge', async () => {
    useSessionStore.setState({ sessions: [{ ...mockSession }] })
    const clientCall = mockClientCall()

    expect(await useSessionStore.getState().renameSession('sess-1', '   ', clientCall)).toBeNull()
    expect(clientCall).not.toHaveBeenCalled()
  })

  it('returns null on error and sets error state', async () => {
    useSessionStore.setState({ sessions: [{ ...mockSession }] })
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('rename failed'))

    const result = await useSessionStore.getState().renameSession('sess-1', 'New', clientCall)

    expect(result).toBeNull()
    expect(useSessionStore.getState().error).toBe('rename failed')
  })
})

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  it('returns session on success (v2)', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(mockSession)

    const result = await useSessionStore.getState().getSession('sess-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.get', { sessionId: 'sess-1' })
    expect(result).toEqual(mockSession)
  })

  it('handles v1 { session } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ session: mockSession })

    const result = await useSessionStore.getState().getSession('sess-1', clientCall)

    expect(result).toEqual(mockSession)
  })

  it('returns null on error and sets error', async () => {
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('get failed'))

    const result = await useSessionStore.getState().getSession('sess-1', clientCall)

    expect(result).toBeNull()
    expect(useSessionStore.getState().error).toBe('get failed')
  })
})

// ---------------------------------------------------------------------------
// getSessionMessages
// ---------------------------------------------------------------------------

describe('getSessionMessages', () => {
  const messages = [
    { id: 'm1', role: 'user', content: 'hi', timestamp: 1 },
    { id: 'm2', role: 'assistant', content: 'hello', timestamp: 2 },
  ]

  it('returns messages array (v2)', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(messages)

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.messages', { sessionId: 'sess-1' })
    expect(result.messages).toEqual([
      { id: 'm1', role: 'user', content: 'hi', text: 'hi', rawContent: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello', text: 'hello', rawContent: 'hello' },
    ])
  })

  it('handles v1 { messages } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ messages })

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result.messages).toEqual([
      { id: 'm1', role: 'user', content: 'hi', text: 'hi', rawContent: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello', text: 'hello', rawContent: 'hello' },
    ])
  })

  it('maps SDK event-format messages (type/text/content), preserving input order', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([
      {
        id: 'msg_a1', type: 'assistant',
        content: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'Answer here' }],
      },
      { id: 'msg_u1', type: 'user', text: 'Hello?' },
    ])

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result.messages).toEqual([
      { id: 'msg_a1', role: 'assistant', content: 'Answer here', text: 'Answer here', rawContent: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'Answer here' }] },
      { id: 'msg_u1', role: 'user', content: 'Hello?', text: 'Hello?', rawContent: 'Hello?' },
    ])
  })

  it('drops non-user/assistant event types', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([
      { id: 'msg_sys', type: 'system', text: 'sys' },
      { id: 'msg_a1', type: 'assistant', text: 'reply' },
    ])

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result.messages).toEqual([
      { id: 'msg_a1', role: 'assistant', content: 'reply', text: 'reply', rawContent: 'reply' },
    ])
  })

  it('parses SDK v2 message records ({ info, parts }), preserving input order', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([
      {
        info: { id: 'msg_a2', sessionID: 'sess-1', role: 'assistant', time: { created: 2000 } },
        parts: [{ id: 'p1', type: 'text', text: 'Reply' }],
      },
      {
        info: { id: 'msg_u1', sessionID: 'sess-1', role: 'user', time: { created: 1000 } },
        parts: [{ id: 'p2', type: 'text', text: 'Hello?' }],
      },
    ])

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result.messages).toEqual([
      { id: 'msg_a2', role: 'assistant', content: 'Reply', text: 'Reply', rawContent: [{ id: 'p1', type: 'text', text: 'Reply' }], time: { created: 2000 } },
      { id: 'msg_u1', role: 'user', content: 'Hello?', text: 'Hello?', rawContent: [{ id: 'p2', type: 'text', text: 'Hello?' }], time: { created: 1000 } },
    ])
  })

  it('drops non-user/assistant v2 records', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([
      { info: { id: 'msg_sys', role: 'system' }, parts: [{ type: 'text', text: 'sys' }] },
      { info: { id: 'msg_a1', role: 'assistant' }, parts: [{ type: 'text', text: 'reply' }] },
    ])

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result.messages).toEqual([
      { id: 'msg_a1', role: 'assistant', content: 'reply', text: 'reply', rawContent: [{ type: 'text', text: 'reply' }] },
    ])
  })

  it('returns empty array on error and sets error', async () => {
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('messages failed'))

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result.messages).toEqual([])
    expect(result.cursor).toBeUndefined()
    expect(useSessionStore.getState().error).toBe('messages failed')
  })
})

// ---------------------------------------------------------------------------
// revertSession
// ---------------------------------------------------------------------------

describe('revertSession', () => {
  it('calls session.revert with messageID and partID', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(undefined)

    await useSessionStore.getState().revertSession('sess-1', 'msg-1', 'part-2', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.revert', {
      sessionId: 'sess-1',
      messageID: 'msg-1',
      partID: 'part-2',
    })
  })

  it('warns on error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('revert failed'))

    await useSessionStore.getState().revertSession('sess-1', 'm1', 'p1', clientCall)

    expect(warnSpy).toHaveBeenCalledWith('session.revert failed:', 'revert failed')
    warnSpy.mockRestore()
  })
})
