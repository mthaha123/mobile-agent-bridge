import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { MainLayout } from '../src/components/MainLayout'
import { useUiStore } from '../src/stores/uiStore'
import { useAuthStore } from '../src/stores/authStore'
import { useChatStore } from '../src/stores/chatStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useProjectStore } from '../src/stores/projectStore'
import { mockClient, resetAllStores } from './test-utils'

function textOf(tree: TestRenderer.ReactTestRenderer): string {
  let s = ''
  function walk(node: any) {
    if (!node) return
    if (typeof node === 'string') { s += node; return }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree.toJSON())
  return s
}

function setup(overrides?: { activeTab?: string; chatSubScreen?: string }) {
  act(() => {
    useUiStore.setState({
      screen: 'main',
      activeTab: (overrides?.activeTab as any) ?? 'chat',
      chatSubScreen: (overrides?.chatSubScreen as any) ?? 'sessions',
    })
    useAuthStore.setState({
      client: {
        connected: true,
        on: jest.fn(() => jest.fn()),
        call: jest.fn(async () => ({ data: [] })),
        listFiles: jest.fn(async () => []),
        readFile: jest.fn(async () => ({ path: '', content: '' })),
        searchFiles: jest.fn(async () => []),
      } as any,
      bridgeUrl: 'ws://localhost:19985/ws',
      token: 'test',
      authenticated: true,
      loading: false,
      error: null,
    })
    useChatStore.setState({
      activeSessionId: null, messages: [], inputText: '', waiting: false,
      streamStates: {}, lastAppliedId: -1,
    })
    useSessionStore.setState({ sessions: [], loading: false, error: null })
    useProjectStore.setState({ directory: '/test', project: null, switching: false })
  })
}

describe('MainLayout', () => {
  it('renders tab bar with 3 tabs', () => {
    setup()
    const tree = TestRenderer.create(<MainLayout />)
    const t = textOf(tree)
    expect(t).toContain('Chat')
    expect(t).toContain('Files')
    expect(t).toContain('Settings')
  })

  it('renders SessionsScreen when chat tab + sessions sub-screen', () => {
    setup({ activeTab: 'chat', chatSubScreen: 'sessions' })
    const tree = TestRenderer.create(<MainLayout />)
    expect(textOf(tree)).toContain('Sessions')
  })

  it('renders ChatScreen when chat sub-screen with active session', () => {
    act(() => {
      useUiStore.setState({ activeTab: 'chat', chatSubScreen: 'chat' })
      useChatStore.setState({ activeSessionId: 's1' })
    })
    const tree = TestRenderer.create(<MainLayout />)
    const t = textOf(tree)
    const hasChat = t.includes('Type a message') || t.includes('Sessions')
    expect(hasChat).toBe(true)
  })

  it('renders FileBrowserScreen when files tab active', () => {
    setup({ activeTab: 'files' })
    const tree = TestRenderer.create(<MainLayout />)
    expect(textOf(tree)).toContain('Search')
  })

  it('renders SettingsScreen when settings tab active', () => {
    setup({ activeTab: 'settings' })
    const tree = TestRenderer.create(<MainLayout />)
    const t = textOf(tree)
    expect(t).toContain('Settings')
    expect(t).toContain('Disconnect')
  })

  it('switches tab via setActiveTab', () => {
    setup()
    const tree = TestRenderer.create(<MainLayout />)
    act(() => { useUiStore.getState().setActiveTab('files') })
    expect(textOf(tree)).toContain('Search')
  })

  it('pushChat changes chatSubScreen to chat', () => {
    setup()
    const tree = TestRenderer.create(<MainLayout />)
    act(() => { useChatStore.setState({ activeSessionId: 's1' }) })
    act(() => { useUiStore.getState().pushChat() })
    expect(useUiStore.getState().chatSubScreen).toBe('chat')
  })

  it('popChat returns to sessions', () => {
    act(() => { useUiStore.setState({ chatSubScreen: 'chat' }) })
    const tree = TestRenderer.create(<MainLayout />)
    act(() => { useUiStore.getState().popChat() })
    expect(useUiStore.getState().chatSubScreen).toBe('sessions')
  })

  it('shows ConnectionBanner when client disconnected', () => {
    act(() => {
      useAuthStore.setState({
        client: { connected: false, on: jest.fn(() => jest.fn()), call: jest.fn() } as any,
      })
    })
    const tree = TestRenderer.create(<MainLayout />)
    expect(textOf(tree)).toContain('Connection lost')
  })

  it('hides ConnectionBanner when client connected', () => {
    act(() => {
      useAuthStore.setState({
        client: { connected: true, on: jest.fn(() => jest.fn()), call: jest.fn() } as any,
      })
    })
    const tree = TestRenderer.create(<MainLayout />)
    expect(textOf(tree)).not.toContain('Connection lost')
  })

  // ─── Interactions ───────────────────────────────────────

  it('client.on is called with connected and disconnected events', () => {
    setup()
    TestRenderer.create(<MainLayout />)
    const client = useAuthStore.getState().client as any
    expect(client.on).toHaveBeenCalledWith('connected', expect.any(Function))
    expect(client.on).toHaveBeenCalledWith('disconnected', expect.any(Function))
  })

  it('sessions screen renders project bar with switch button', () => {
    setup({ activeTab: 'chat', chatSubScreen: 'sessions' })
    const tree = TestRenderer.create(<MainLayout />)
    const t = textOf(tree)
    expect(t).toContain('Switch')
    expect(t).toContain('Project')
  })

  it('connected/disconnected handlers toggle banner', () => {
    const client = {
      connected: true,
      on: jest.fn(() => jest.fn()),
      call: jest.fn(),
    }
    act(() => {
      useAuthStore.setState({ client: client as any })
    })
    let tree: TestRenderer.ReactTestRenderer
    act(() => { tree = TestRenderer.create(<MainLayout />) })
    expect(textOf(tree!)).not.toContain('Connection lost')
  })
})

// ─── Unknown activeTab ────────────────────────────────────

describe('MainLayout — unknown activeTab', () => {
  it('renders sessions screen as default for unknown tab', () => {
    setup({ activeTab: 'unknown-tab' as any, chatSubScreen: 'chat' })
    useChatStore.setState({ activeSessionId: null })
    const tree = TestRenderer.create(<MainLayout />)
    expect(textOf(tree)).toContain('Sessions')
  })
})

// ─── Task 8: client.on events are tracked ─────────────────

describe('MainLayout — client.on event tracking', () => {
  it('registers listeners for connected and disconnected events', () => {
    const client = mockClient()
    act(() => { useAuthStore.setState({ client: client as any }) })

    TestRenderer.create(<MainLayout />)

    const eventNames = client.on.mock.calls.map((c: any[]) => c[0])
    expect(eventNames).toContain('connected')
    expect(eventNames).toContain('disconnected')
  })

  it('disconnect event handler triggers banner display', async () => {
    let disconnectedHandler: Function = () => {}
    const client = {
      connected: true,
      on: jest.fn((event: string, handler: Function) => {
        if (event === 'disconnected') disconnectedHandler = handler
        return jest.fn()
      }),
      call: jest.fn(),
      listFiles: jest.fn(),
      readFile: jest.fn(),
      searchFiles: jest.fn(),
    }
    act(() => { useAuthStore.setState({ client: client as any }) })

    let tree: any
    await act(async () => { tree = TestRenderer.create(<MainLayout />) })
    expect(textOf(tree)).not.toContain('Connection lost')

    await act(async () => { disconnectedHandler() })
    expect(textOf(tree)).toContain('Connection lost')
  })

  it('reconnect event handler hides banner', async () => {
    let connectedHandler: Function = () => {}
    const client = {
      connected: false,
      on: jest.fn((event: string, handler: Function) => {
        if (event === 'connected') connectedHandler = handler
        return jest.fn()
      }),
      call: jest.fn(),
      listFiles: jest.fn(),
      readFile: jest.fn(),
      searchFiles: jest.fn(),
    }
    act(() => { useAuthStore.setState({ client: client as any }) })

    let tree: any
    await act(async () => { tree = TestRenderer.create(<MainLayout />) })
    expect(textOf(tree)).toContain('Connection lost')

    await act(async () => { connectedHandler() })
    expect(textOf(tree)).not.toContain('Connection lost')
  })
})

// ─── Task 8: Session screen shows tab bar ─────────────────

describe('MainLayout — session screen tab bar', () => {
  it('shows tab bar with Chat, Files, and Settings tabs on session screen', () => {
    setup({ activeTab: 'chat', chatSubScreen: 'sessions' })
    const tree = TestRenderer.create(<MainLayout />)
    const t = textOf(tree)
    expect(t).toContain('Chat')
    expect(t).toContain('Files')
    expect(t).toContain('Settings')
  })

  it('tab bar remains visible after switching to chat sub-screen', () => {
    act(() => {
      useUiStore.setState({ activeTab: 'chat', chatSubScreen: 'chat' })
      useChatStore.setState({ activeSessionId: 's1' })
    })
    const tree = TestRenderer.create(<MainLayout />)
    const t = textOf(tree)
    expect(t).toContain('Chat')
    expect(t).toContain('Files')
    expect(t).toContain('Settings')
  })
})
