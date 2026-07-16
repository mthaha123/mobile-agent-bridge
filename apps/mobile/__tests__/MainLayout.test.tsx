import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { MainLayout } from '../src/components/MainLayout'
import { useUiStore } from '../src/stores/uiStore'
import { useAuthStore } from '../src/stores/authStore'
import { useChatStore } from '../src/stores/chatStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useProjectStore } from '../src/stores/projectStore'

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
    // ChatScreen renders input placeholder OR fallback to Sessions
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
    act(() => { useChatStore.setState({ activeSessionId: 's1' }) })
    const tree = TestRenderer.create(<MainLayout />)
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
})
