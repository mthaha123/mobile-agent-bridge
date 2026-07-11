/**
 * projectStore tests
 *
 * Tests the project state management: switching, fetching, and event handling.
 * The store reads BridgeClient from authStore — we mock it by setting authStore state directly.
 */

// Mock BridgeClient before any imports
jest.mock('../src/services/BridgeClient', () => ({
  BridgeClient: jest.fn().mockImplementation(() => ({
    call: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
    get connected() {
      return true
    },
    get token() {
      return 'mock-token'
    },
  })),
}))

import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resetStores() {
  useAuthStore.setState({
    bridgeUrl: '',
    token: null,
    authenticated: false,
    loading: false,
    error: null,
    client: null,
  })
  useProjectStore.setState({
    directory: '',
    project: null,
    switching: false,
  })
}

function makeClient() {
  return {
    call: jest.fn<any>().mockResolvedValue({}),
    connect: jest.fn(),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
    connected: true,
    token: 'mock-token',
  }
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  resetStores()
})

// ---------------------------------------------------------------------------
// setDirectory
// ---------------------------------------------------------------------------

describe('setDirectory', () => {
  it('stores the directory string', () => {
    useProjectStore.getState().setDirectory('/home/user/proj')
    expect(useProjectStore.getState().directory).toBe('/home/user/proj')
  })
})

// ---------------------------------------------------------------------------
// setProject
// ---------------------------------------------------------------------------

describe('setProject', () => {
  it('updates directory and project from payload', () => {
    useProjectStore.getState().setProject({
      directory: '/data/project',
      project: { name: 'my-project' },
    })
    expect(useProjectStore.getState().directory).toBe('/data/project')
    expect(useProjectStore.getState().project).toEqual({ name: 'my-project' })
  })

  it('sets project to null when payload lacks project', () => {
    useProjectStore.getState().setProject({
      directory: '/data/project',
    })
    expect(useProjectStore.getState().project).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// switchProject
// ---------------------------------------------------------------------------

describe('switchProject', () => {
  it('calls project.switch on client and updates state on success', async () => {
    const client = makeClient()
    client.call.mockResolvedValue({
      directory: '/data/project',
      project: { name: 'proj' },
    })
    useAuthStore.setState({ client: client as any })

    await useProjectStore.getState().switchProject('/data/project')

    expect(client.call).toHaveBeenCalledWith('project.switch', {
      directory: '/data/project',
    })
    expect(useProjectStore.getState().directory).toBe('/data/project')
    expect(useProjectStore.getState().project).toEqual({ name: 'proj' })
    expect(useProjectStore.getState().switching).toBe(false)
  })

  it('uses stored directory when no argument given', async () => {
    const client = makeClient()
    client.call.mockResolvedValue({
      directory: '/stored/dir',
      project: null,
    })
    useAuthStore.setState({ client: client as any })
    useProjectStore.setState({ directory: '/stored/dir' })

    await useProjectStore.getState().switchProject()

    expect(client.call).toHaveBeenCalledWith('project.switch', {
      directory: '/stored/dir',
    })
  })

  it('does nothing when client is null', async () => {
    useAuthStore.setState({ client: null })
    // Should not throw
    await useProjectStore.getState().switchProject('/any')
  })

  it('does nothing when no directory available', async () => {
    const client = makeClient()
    useAuthStore.setState({ client: client as any })
    // directory is empty string
    await useProjectStore.getState().switchProject()

    expect(client.call).not.toHaveBeenCalled()
  })

  it('sets switching=false on error', async () => {
    const client = makeClient()
    client.call.mockRejectedValue(new Error('switch failed'))
    useAuthStore.setState({ client: client as any })
    useProjectStore.setState({ switching: true })

    await useProjectStore.getState().switchProject('/err')
    // The error is caught internally, switching should be false
    expect(useProjectStore.getState().switching).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// fetchCurrentProject
// ---------------------------------------------------------------------------

describe('fetchCurrentProject', () => {
  it('calls project.current and updates state', async () => {
    const client = makeClient()
    client.call.mockResolvedValue({
      directory: '/current/dir',
      project: { name: 'current-proj' },
    })
    useAuthStore.setState({ client: client as any })

    await useProjectStore.getState().fetchCurrentProject()

    expect(client.call).toHaveBeenCalledWith('project.current', {})
    expect(useProjectStore.getState().directory).toBe('/current/dir')
    expect(useProjectStore.getState().project).toEqual({ name: 'current-proj' })
  })

  it('does not update state when response has no directory', async () => {
    const client = makeClient()
    client.call.mockResolvedValue({})
    useAuthStore.setState({ client: client as any })
    useProjectStore.setState({ directory: '/existing' })

    await useProjectStore.getState().fetchCurrentProject()

    // directory should remain unchanged
    expect(useProjectStore.getState().directory).toBe('/existing')
  })

  it('does nothing when client is null', async () => {
    useAuthStore.setState({ client: null })
    await useProjectStore.getState().fetchCurrentProject()
  })

  it('silently catches errors', async () => {
    const client = makeClient()
    client.call.mockRejectedValue(new Error('fetch failed'))
    useAuthStore.setState({ client: client as any })

    await expect(
      useProjectStore.getState().fetchCurrentProject(),
    ).resolves.not.toThrow()
  })
})
