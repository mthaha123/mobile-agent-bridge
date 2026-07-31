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
// deleteSession
// ---------------------------------------------------------------------------

describe('deleteSession', () => {
  it('deletes session and removes from list', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(undefined)
    useSessionStore.getState().setSessions([mockSession])

    await useSessionStore.getState().deleteSession('sess-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.delete', { sessionId: 'sess-1' })
    expect(useSessionStore.getState().sessions).toEqual([])
  })

  it('warns on error and does not remove', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('not supported'))
    useSessionStore.getState().setSessions([mockSession])

    await useSessionStore.getState().deleteSession('sess-1', clientCall)

    expect(warnSpy).toHaveBeenCalledWith('session.delete not supported:', 'not supported')
    expect(useSessionStore.getState().sessions).toEqual([mockSession])
    warnSpy.mockRestore()
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
    expect(result).toEqual([
      { id: 'm1', role: 'user', content: 'hi', text: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello', text: 'hello' },
    ])
  })

  it('handles v1 { messages } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ messages })

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result).toEqual([
      { id: 'm1', role: 'user', content: 'hi', text: 'hi' },
      { id: 'm2', role: 'assistant', content: 'hello', text: 'hello' },
    ])
  })

  it('maps SDK event-format messages (type/text/content, newest first) and reverses to chronological', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([
      {
        id: 'msg_a1', type: 'assistant',
        content: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'Answer here' }],
      },
      { id: 'msg_u1', type: 'user', text: 'Hello?' },
    ])

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result).toEqual([
      { id: 'msg_u1', role: 'user', content: 'Hello?', text: 'Hello?' },
      { id: 'msg_a1', role: 'assistant', content: 'Answer here', text: 'Answer here' },
    ])
  })

  it('drops non-user/assistant event types', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue([
      { id: 'msg_sys', type: 'system', text: 'sys' },
      { id: 'msg_a1', type: 'assistant', text: 'reply' },
    ])

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result).toEqual([
      { id: 'msg_a1', role: 'assistant', content: 'reply', text: 'reply' },
    ])
  })

  it('returns empty array on error and sets error', async () => {
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('messages failed'))

    const result = await useSessionStore.getState().getSessionMessages('sess-1', clientCall)

    expect(result).toEqual([])
    expect(useSessionStore.getState().error).toBe('messages failed')
  })
})

// ---------------------------------------------------------------------------
// renameSession
// ---------------------------------------------------------------------------

describe('renameSession', () => {
  it('calls session.rename with name', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(undefined)

    await useSessionStore.getState().renameSession('sess-1', 'Renamed', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.rename', {
      sessionId: 'sess-1',
      name: 'Renamed',
    })
  })

  it('warns on error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('rename failed'))

    await useSessionStore.getState().renameSession('sess-1', 'X', clientCall)

    expect(warnSpy).toHaveBeenCalledWith('session.rename failed:', 'rename failed')
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getSessionTodo
// ---------------------------------------------------------------------------

describe('getSessionTodo', () => {
  const todos = [{ id: 't1', task: 'fix bug' }]

  it('returns todo array (v2)', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(todos)

    const result = await useSessionStore.getState().getSessionTodo('sess-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.todo', { sessionId: 'sess-1' })
    expect(result).toEqual(todos)
  })

  it('handles v1 { todos } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ todos })

    const result = await useSessionStore.getState().getSessionTodo('sess-1', clientCall)

    expect(result).toEqual(todos)
  })

  it('returns empty array and warns on error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('todo failed'))

    const result = await useSessionStore.getState().getSessionTodo('sess-1', clientCall)

    expect(result).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('session.todo failed:', 'todo failed')
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// getSessionDiff
// ---------------------------------------------------------------------------

describe('getSessionDiff', () => {
  const diffs = [{ path: 'file.ts', content: '...' }]

  it('returns diff array (v2)', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(diffs)

    const result = await useSessionStore.getState().getSessionDiff('sess-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.diff', { sessionId: 'sess-1' })
    expect(result).toEqual(diffs)
  })

  it('handles v1 { diffs } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ diffs })

    const result = await useSessionStore.getState().getSessionDiff('sess-1', clientCall)

    expect(result).toEqual(diffs)
  })

  it('returns empty array and warns on error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('diff failed'))

    const result = await useSessionStore.getState().getSessionDiff('sess-1', clientCall)

    expect(result).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('session.diff failed:', 'diff failed')
    warnSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// forkSession
// ---------------------------------------------------------------------------

describe('forkSession', () => {
  it('returns new session id from v2 string response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue('sess-forked')

    const newId = await useSessionStore.getState().forkSession('sess-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.fork', { sessionId: 'sess-1' })
    expect(newId).toBe('sess-forked')
  })

  it('handles v1 { sessionId } response', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue({ sessionID: 'sess-forked' })

    const newId = await useSessionStore.getState().forkSession('sess-1', clientCall)

    expect(newId).toBe('sess-forked')
  })

  it('returns null on error and sets error', async () => {
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('fork failed'))

    const newId = await useSessionStore.getState().forkSession('sess-1', clientCall)

    expect(newId).toBeNull()
    expect(useSessionStore.getState().error).toBe('fork failed')
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

// ---------------------------------------------------------------------------
// unrevertSession
// ---------------------------------------------------------------------------

describe('unrevertSession', () => {
  it('calls session.unrevert with sessionID', async () => {
    const clientCall = mockClientCall()
    clientCall.mockResolvedValue(undefined)

    await useSessionStore.getState().unrevertSession('sess-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('session.unrevert', { sessionId: 'sess-1' })
  })

  it('warns on error', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const clientCall = mockClientCall()
    clientCall.mockRejectedValue(new Error('unrevert failed'))

    await useSessionStore.getState().unrevertSession('sess-1', clientCall)

    expect(warnSpy).toHaveBeenCalledWith('session.unrevert failed:', 'unrevert failed')
    warnSpy.mockRestore()
  })
})
