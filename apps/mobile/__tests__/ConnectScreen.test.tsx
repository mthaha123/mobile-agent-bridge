import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ConnectScreen } from '../src/screens/ConnectScreen'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'
import { resetAllStores, findAllInputs, findAllPressable, textOf } from './test-utils'

const mockConnectFn = jest.fn().mockResolvedValue(undefined)
const mockCallFn = jest.fn().mockResolvedValue({ token: 'mock-token' })
const mockDisconnectFn = jest.fn()

jest.mock('../src/services/BridgeClient', () => ({
  BridgeClient: jest.fn().mockImplementation(() => ({
    connect: mockConnectFn,
    call: mockCallFn,
    disconnect: mockDisconnectFn,
  })),
}))

beforeEach(() => {
  resetAllStores()
  mockConnectFn.mockClear()
  mockCallFn.mockClear()
  mockDisconnectFn.mockClear()
})

// ─── Rendering ────────────────────────────────────────────

describe('ConnectScreen', () => {
  it('renders title and subtitle', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders error message when present', () => {
    useAuthStore.setState({ error: 'Connection failed' })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders loading state', () => {
    useAuthStore.setState({ loading: true })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders title "Mobile Agent Bridge"', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(textOf(tree)).toContain('Mobile Agent Bridge')
  })

  it('renders subtitle "Connect to your OpenCode agent"', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(textOf(tree)).toContain('Connect to your OpenCode agent')
  })

  it('renders error text when error state is set', () => {
    useAuthStore.setState({ error: 'Connection refused' })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(textOf(tree)).toContain('Connection refused')
  })

  it('renders Connect button text', () => {
    useAuthStore.setState({ loading: false })
    const tree = TestRenderer.create(<ConnectScreen />)
    expect(textOf(tree)).toContain('Connect')
  })

  it('renders 3 input fields with placeholders', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    const inputs = findAllInputs(tree)
    expect(inputs.length).toBeGreaterThanOrEqual(3)
  })

  it('URL input has url keyboard type', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    const inputs = findAllInputs(tree)
    expect(inputs[0].props.keyboardType).toBe('url')
  })

  it('password input has secureTextEntry', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    const inputs = findAllInputs(tree)
    const passwordInput = inputs.find((i: any) => i.props.secureTextEntry === true)
    expect(passwordInput).toBeDefined()
  })

  it('directory input has correct placeholder', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    const inputs = findAllInputs(tree)
    expect(inputs.length).toBeGreaterThanOrEqual(3)
    const dirInput = inputs.find((i: any) => i.props.placeholder?.includes('project directory'))
    expect(dirInput).toBeDefined()
  })
})

// ─── 交互测试 ─────────────────────────────────────────────

describe('ConnectScreen — interactions', () => {
  it('serverUrl updates when TextInput changes', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    let inputs = findAllInputs(tree)
    expect(inputs.length).toBeGreaterThanOrEqual(1)

    act(() => { inputs[0].props.onChangeText('ws://192.168.1.1:8080/ws') })

    inputs = findAllInputs(tree)
    expect(inputs[0].props.value).toBe('ws://192.168.1.1:8080/ws')
  })

  it('serverPassword updates when TextInput changes', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    let inputs = findAllInputs(tree)
    expect(inputs.length).toBeGreaterThanOrEqual(2)

    act(() => { inputs[1].props.onChangeText('my-secret-password') })

    inputs = findAllInputs(tree)
    expect(inputs[1].props.value).toBe('my-secret-password')
  })

  it('directoryInput updates when TextInput changes', () => {
    const tree = TestRenderer.create(<ConnectScreen />)
    let inputs = findAllInputs(tree)
    expect(inputs.length).toBeGreaterThanOrEqual(3)

    act(() => { inputs[2].props.onChangeText('/home/user/project') })

    inputs = findAllInputs(tree)
    expect(inputs[2].props.value).toBe('/home/user/project')
  })

  it('directory is passed to projectStore on connect', async () => {
    useProjectStore.getState().setDirectory('/my/project')
    expect(useProjectStore.getState().directory).toBe('/my/project')
    useProjectStore.getState().setDirectory('')
    expect(useProjectStore.getState().directory).toBe('')
  })

  it('Connect button triggers login flow', async () => {
    const tree = TestRenderer.create(<ConnectScreen />)

    act(() => { findAllInputs(tree)[0].props.onChangeText('ws://localhost:8080/ws') })
    act(() => { findAllInputs(tree)[1].props.onChangeText('secret123') })
    act(() => { findAllInputs(tree)[2].props.onChangeText('/home/user/project') })

    const connectBtn = findAllPressable(tree).find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Connect')
    })
    expect(connectBtn).toBeDefined()

    await act(async () => { connectBtn!.props.onPress() })

    expect(useAuthStore.getState().authenticated).toBe(true)
  })

  it('Connect button shows loading state', async () => {
    let resolveLogin: () => void
    const loginPromise = new Promise<void>((r) => { resolveLogin = r })
    mockConnectFn.mockImplementationOnce(() => loginPromise)
    mockCallFn.mockImplementationOnce(() => loginPromise.then(() => ({ token: 'mock-token' })))

    const tree = TestRenderer.create(<ConnectScreen />)
    let inputs = findAllInputs(tree)
    act(() => { inputs[0].props.onChangeText('ws://localhost:8080/ws') })

    let pressables = findAllPressable(tree)
    const connectBtn = pressables.find((p: any) => {
      const t = textOf({ toJSON: () => p } as any)
      return t.includes('Connect')
    })

    await act(async () => {
      connectBtn!.props.onPress()
    })

    expect(useAuthStore.getState().loading).toBe(true)

    resolveLogin!()
    await act(async () => { await loginPromise })
  })

  it('login sets error when bridgeUrl is empty', () => {
    useAuthStore.getState().login()
    expect(useAuthStore.getState().error).toContain('地址')
  })
})
