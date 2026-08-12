/**
 * authStore tests
 *
 * Tests authentication flow: login, logout, bridge URL management.
 * Mocks BridgeClient and projectStore to isolate auth logic.
 */

// Mock BridgeClient before imports
const mockConnect = jest.fn()
const mockDisconnect = jest.fn()
const mockDestroy = jest.fn()
const mockCall = jest.fn()
const mockOn = jest.fn()

jest.mock('../src/services/BridgeClient', () => ({
  BridgeClient: jest.fn().mockImplementation(() => ({
    call: mockCall,
    connect: mockConnect,
    disconnect: mockDisconnect,
    destroy: mockDestroy,
    on: mockOn,
    connected: true,
    token: 'mock-token',
  })),
}))

// Mock projectStore so dynamic import in login() returns a controlled module
const mockSwitchProject = jest.fn()
jest.mock('../src/stores/projectStore', () => {
  const mockSetDirectory = jest.fn()
  return {
    useProjectStore: {
      getState: () => ({
        switchProject: mockSwitchProject,
        setDirectory: mockSetDirectory,
        directory: '/test/project',
      }),
    },
  }
})

import { BridgeClient } from '../src/services/BridgeClient'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resetAuthStore() {
  useAuthStore.setState({
    bridgeUrl: '',
    token: null,
    authenticated: false,
    loading: false,
    error: null,
    client: null,
  })
}

beforeEach(() => {
  resetAuthStore()
  jest.clearAllMocks()
})

afterEach(() => {
  resetAuthStore()
})

// ---------------------------------------------------------------------------
// setBridgeUrl
// ---------------------------------------------------------------------------

describe('setBridgeUrl', () => {
  it('sets the bridge URL and clears error', () => {
    useAuthStore.getState().setBridgeUrl('ws://localhost:8080/ws')
    const state = useAuthStore.getState()
    expect(state.bridgeUrl).toBe('ws://localhost:8080/ws')
    expect(state.error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// clearError
// ---------------------------------------------------------------------------

describe('clearError', () => {
  it('clears the error', () => {
    useAuthStore.setState({ error: 'some error' })
    useAuthStore.getState().clearError()
    expect(useAuthStore.getState().error).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('login', () => {
  it('rejects when bridgeUrl is empty', async () => {
    useAuthStore.getState().setBridgeUrl('')
    await useAuthStore.getState().login('password123')

    const state = useAuthStore.getState()
    expect(state.error).toBe('请先输入 Bridge 地址')
    expect(state.loading).toBe(false)
    expect(state.authenticated).toBe(false)
    expect(BridgeClient).not.toHaveBeenCalled()
  })

  it('performs full login flow on success', async () => {
    // Arrange
    mockCall.mockResolvedValue({ token: 'jwt-token-123' })

    useAuthStore.getState().setBridgeUrl('ws://localhost:19985/ws')
    mockSwitchProject.mockResolvedValue(true)

    // Act
    await useAuthStore.getState().login('test123')

    // Assert
    const state = useAuthStore.getState()
    expect(state.authenticated).toBe(true)
    expect(state.loading).toBe(false)
    expect(state.token).toBe('jwt-token-123')
    expect(state.error).toBeNull()
    expect(state.client).not.toBeNull()

    // First BridgeClient for login (no token)
    expect(BridgeClient).toHaveBeenCalledTimes(2)
    expect(BridgeClient).toHaveBeenNthCalledWith(1, { url: 'ws://localhost:19985/ws' })
    expect(BridgeClient).toHaveBeenNthCalledWith(2, {
      url: 'ws://localhost:19985/ws',
      token: 'jwt-token-123',
    })

    // Login client connect + call + disconnect
    expect(mockConnect).toHaveBeenCalledTimes(2)
    expect(mockCall).toHaveBeenCalledWith('auth.login', { password: 'test123' })
    expect(mockDisconnect).toHaveBeenCalledTimes(1)

    // projectStore.switchProject should be called
    expect(mockSwitchProject).toHaveBeenCalledTimes(1)
  })

  it('handles login failure gracefully', async () => {
    mockCall.mockRejectedValue(new Error('invalid password'))

    useAuthStore.getState().setBridgeUrl('ws://localhost:19985/ws')

    await useAuthStore.getState().login('wrong-password')

    const state = useAuthStore.getState()
    expect(state.authenticated).toBe(false)
    expect(state.loading).toBe(false)
    expect(state.error).toBe('invalid password')
    expect(state.client).toBeNull()
    expect(state.token).toBeNull()
  })

  it('handles error from projectStore.switchProject during login', async () => {
    // When switchProject fails, login also fails
    mockCall.mockResolvedValue({ token: 'jwt-token-123' })
    mockSwitchProject.mockRejectedValue(new Error('switch failed'))

    useAuthStore.getState().setBridgeUrl('ws://localhost:19985/ws')

    await useAuthStore.getState().login('test123')

    const state = useAuthStore.getState()
    expect(state.authenticated).toBe(false)
    expect(state.loading).toBe(false)
    expect(state.error).toBe('switch failed')
  })
})

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('logout', () => {
  it('destroys client and resets state', () => {
    // Set up logged-in state
    useAuthStore.setState({
      bridgeUrl: 'ws://localhost:19985/ws',
      token: 'jwt-token',
      authenticated: true,
      client: { destroy: mockDestroy } as any,
    })

    useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.authenticated).toBe(false)
    expect(state.token).toBeNull()
    expect(state.client).toBeNull()
    expect(state.bridgeUrl).toBe('')
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// refreshToken
// ---------------------------------------------------------------------------

describe('refreshToken', () => {
  it('refreshes token successfully using existing client', async () => {
    const fakeClient = { call: jest.fn().mockResolvedValue({ token: 'new-token' }) }
    useAuthStore.setState({ client: fakeClient as any })

    await useAuthStore.getState().refreshToken()

    const state = useAuthStore.getState()
    expect(state.token).toBe('new-token')
    expect(state.error).toBeNull()
    expect(fakeClient.call).toHaveBeenCalledWith('auth.refresh', {})
  })

  it('sets error when client is null', async () => {
    useAuthStore.setState({ client: null, error: null })

    await useAuthStore.getState().refreshToken()

    const state = useAuthStore.getState()
    expect(state.error).toBe('未连接')
    expect(state.token).toBeNull()
  })

  it('handles refresh failure gracefully', async () => {
    const fakeClient = { call: jest.fn().mockRejectedValue(new Error('token expired')) }
    useAuthStore.setState({ client: fakeClient as any, token: 'old-token' })

    await useAuthStore.getState().refreshToken()

    const state = useAuthStore.getState()
    expect(state.error).toBe('token expired')
    expect(state.token).toBe('old-token')
  })
})

// ---------------------------------------------------------------------------
// setToken
// ---------------------------------------------------------------------------

describe('setToken', () => {
  it('sets the token value', () => {
    useAuthStore.setState({ token: null })

    useAuthStore.getState().setToken('external-token')

    expect(useAuthStore.getState().token).toBe('external-token')
  })
})
