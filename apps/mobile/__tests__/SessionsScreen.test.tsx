import React from 'react'
import TestRenderer from 'react-test-renderer'
import { SessionsScreen } from '../src/screens/SessionsScreen'
import { useSessionStore } from '../src/stores/sessionStore'
import { useAuthStore } from '../src/stores/authStore'
import { useChatStore } from '../src/stores/chatStore'
import { useProjectStore } from '../src/stores/projectStore'

const onNavigateToChat = jest.fn()
const onBack = jest.fn()

beforeEach(() => {
  useSessionStore.setState({ sessions: [], loading: false, error: null })
  useAuthStore.setState({
    client: null, bridgeUrl: '', token: null, authenticated: false,
    loading: false, error: null,
  })
  useChatStore.setState({ activeSessionId: null, messages: [], inputText: '', waiting: false })
  useProjectStore.setState({ directory: '', project: null, switching: false })
})

// ─── Rendering ────────────────────────────────────────────

describe('SessionsScreen', () => {
  it('renders header and project bar', () => {
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders loading indicator when loading with no sessions', () => {
    useSessionStore.setState({ loading: true, sessions: [] })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders session list', () => {
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'Chat 1', createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), messageCount: 3,
      }],
    })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders project directory', () => {
    useProjectStore.setState({ directory: '/home/user/project' })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders switching state in project bar', () => {
    useProjectStore.setState({ directory: '/p', switching: true })
    const tree = TestRenderer.create(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})
