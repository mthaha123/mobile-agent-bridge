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
// shellCommand
// ---------------------------------------------------------------------------

describe('shellCommand', () => {
  it('calls message.shell and sets waiting to false on success', async () => {
    useChatStore.setState({ waiting: true })
    const clientCall = jest.fn().mockResolvedValue(undefined)

    await useChatStore.getState().shellCommand(sessionId, 'ls -la', clientCall)

    expect(clientCall).toHaveBeenCalledWith('message.shell', { sessionId, command: 'ls -la' })
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('sets waiting to false even when clientCall rejects', async () => {
    useChatStore.setState({ waiting: true })
    const clientCall = jest.fn().mockRejectedValue(new Error('shell failed'))

    await expect(useChatStore.getState().shellCommand(sessionId, 'ls', clientCall)).rejects.toThrow('shell failed')

    expect(useChatStore.getState().waiting).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// writeCommand
// ---------------------------------------------------------------------------

describe('writeCommand', () => {
  it('calls message.command and sets waiting to false on success', async () => {
    useChatStore.setState({ waiting: true })
    const clientCall = jest.fn().mockResolvedValue(undefined)

    await useChatStore.getState().writeCommand(sessionId, 'git add .', clientCall)

    expect(clientCall).toHaveBeenCalledWith('message.command', { sessionId, command: 'git add .' })
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('sets waiting to false even when clientCall rejects', async () => {
    useChatStore.setState({ waiting: true })
    const clientCall = jest.fn().mockRejectedValue(new Error('write failed'))

    await expect(useChatStore.getState().writeCommand(sessionId, 'git commit', clientCall)).rejects.toThrow('write failed')

    expect(useChatStore.getState().waiting).toBe(false)
  })
})
