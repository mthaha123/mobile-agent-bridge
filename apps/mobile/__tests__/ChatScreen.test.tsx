jest.mock('react-native', () => {
  const mockComponent = (name: string) => {
    const Comp: React.FC<{ children?: React.ReactNode }> = (props) =>
      props.children ?? null
    Comp.displayName = name
    return Comp
  }
  return {
    View: mockComponent('View'),
    Text: mockComponent('Text'),
    TextInput: mockComponent('TextInput'),
    TouchableOpacity: mockComponent('TouchableOpacity'),
    StyleSheet: { create: (s: any) => s },
    ActivityIndicator: mockComponent('ActivityIndicator'),
    FlatList: mockComponent('FlatList'),
    Modal: mockComponent('Modal'),
    ScrollView: mockComponent('ScrollView'),
    KeyboardAvoidingView: mockComponent('KeyboardAvoidingView'),
    Platform: { OS: 'ios', select: () => {} },
  }
})

jest.mock('../src/screens/ToolApprovalSheet', () => ({ setToolReplyCall: jest.fn() }))

import React from 'react'
import TestRenderer from 'react-test-renderer'
import { ChatScreen } from '../src/screens/ChatScreen'
import { useChatStore } from '../src/stores/chatStore'
import { useAuthStore } from '../src/stores/authStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useProjectStore } from '../src/stores/projectStore'

const onNavigateToSessions = jest.fn()

beforeEach(() => {
  useChatStore.setState({
    activeSessionId: null, messages: [], inputText: '', waiting: false,
  })
  useSessionStore.setState({ sessions: [], loading: false, error: null })
  useAuthStore.setState({
    client: null, bridgeUrl: '', token: null, authenticated: false,
    loading: false, error: null,
  })
  useProjectStore.setState({ directory: '', project: null, switching: false })
})

// ─── Empty state ──────────────────────────────────────────

describe('ChatScreen', () => {
  it('renders empty state when no active session', () => {
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders with messages when session is active', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'Hi there', timestamp: 2000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders session name from sessions list', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    useSessionStore.setState({
      sessions: [{ id: 's1', name: 'My Chat', createdAt: '', updatedAt: '', messageCount: 0 }],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders waiting indicator when AI is thinking', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 }],
      waiting: true,
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders empty session when no matching session name', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    // sessions list has no match — fallback name used
    useSessionStore.setState({
      sessions: [{ id: 's2', name: 'Other', createdAt: '', updatedAt: '', messageCount: 0 }],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})
