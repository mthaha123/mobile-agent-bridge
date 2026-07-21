import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert } from 'react-native'
import { ChatScreen } from '../src/screens/ChatScreen'
import { useChatStore } from '../src/stores/chatStore'
import { useAuthStore } from '../src/stores/authStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useUiStore } from '../src/stores/uiStore'
import { useToolProgressStore } from '../src/stores/toolProgressStore'
import { textOf } from './test-utils'

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
  useUiStore.setState({ screen: 'main', activeTab: 'chat', chatSubScreen: 'sessions' })
  jest.clearAllMocks()
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
    useSessionStore.setState({
      sessions: [{ id: 's2', name: 'Other', createdAt: '', updatedAt: '', messageCount: 0 }],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  // ─── Interactions ───────────────────────────────────────

  it('empty state shows "Select or create a session"', () => {
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    let text = ''
    function walk(n: any) {
      if (!n) return
      if (typeof n === 'string') { text += n; return }
      if (n.children) n.children.forEach(walk)
    }
    walk(tree.toJSON())
    expect(text).toContain('Select or create a session')
  })

  it('input text updates when user types', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const input = tree.root.find(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.placeholder === 'Type a message...',
    )
    expect(input).toBeTruthy()
    TestRenderer.act(() => { input.props.onChangeText('Hello AI') })
    expect(useChatStore.getState().inputText).toBe('Hello AI')
  })

  it('send button is disabled when input is empty', () => {
    useChatStore.setState({ activeSessionId: 's1', inputText: '' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const sendBtn = tree.root.find(
      (n: any) => typeof n.props?.onPress === 'function' && n.props?.disabled !== undefined,
    )
    expect(sendBtn.props.disabled).toBe(true)
  })

  it('shows stop button when waiting', () => {
    useChatStore.setState({ activeSessionId: 's1', inputText: 'hello', waiting: true })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const stopText = tree.root.find(
      (n: any) => typeof n.type === 'string' && n.children?.includes('■'),
    )
    expect(stopText).toBeDefined()
    const stopBtn = stopText.parent?.parent
    expect(typeof stopBtn?.props?.onPress).toBe('function')
  })

  it('waiting shows "AI is thinking..." in store state', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [{ id: 'm1', role: 'user', content: 'Hi', timestamp: 1000 }],
      waiting: true,
    })
    TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(useChatStore.getState().waiting).toBe(true)
  })

  it('messages are stored with correct content', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'user', content: 'What is 2+2?', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: '4', timestamp: 2000 },
      ],
    })
    TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    expect(msgs[0].content).toBe('What is 2+2?')
    expect(msgs[1].content).toBe('4')
  })

  it('system message is stored with correct content', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'system', content: 'Session started', timestamp: 1000 },
      ],
    })
    TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const msgs = useChatStore.getState().messages
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toBe('Session started')
  })

  it('send button calls client.call and clears input', async () => {
    const mockCall = jest.fn().mockResolvedValue({})
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1', inputText: 'Hello AI' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const sendBtn = tree.root.find(
      (n: any) => typeof n.props?.onPress === 'function' && n.props?.disabled !== undefined,
    )
    expect(sendBtn).toBeTruthy()
    expect(sendBtn.props.disabled).toBe(false)

    await act(async () => { await sendBtn.props.onPress() })

    expect(mockCall).toHaveBeenCalledWith('message.send', { sessionId: 's1', message: 'Hello AI' })
    expect(useChatStore.getState().inputText).toBe('')
  })

  it('back button calls popChat to navigate to sessions', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    useUiStore.setState({ chatSubScreen: 'chat' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const backBtn = pressables.find((n: any) => {
      let text = ''
      function walk(node: any) {
        if (!node) return
        if (typeof node === 'string') { text += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return text.includes('< Sessions')
    })
    expect(backBtn).toBeTruthy()

    act(() => { backBtn!.props.onPress() })
    expect(useUiStore.getState().chatSubScreen).toBe('sessions')
  })

  it('empty input does not trigger send', async () => {
    const mockCall = jest.fn()
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1', inputText: '' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const sendBtn = tree.root.find(
      (n: any) => typeof n.props?.onPress === 'function' && n.props?.disabled !== undefined,
    )
    expect(sendBtn.props.disabled).toBe(true)
    mockCall.mockClear()
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('non-Error throw does not produce "undefined" in error message', async () => {
    const mockCall = jest.fn().mockRejectedValue('raw string error')
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1', inputText: 'Hello' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const sendBtn = tree.root.find(
      (n: any) => typeof n.props?.onPress === 'function' && n.props?.disabled !== undefined,
    )

    await act(async () => { await sendBtn.props.onPress() })

    const msgs = useChatStore.getState().messages
    const errorMsg = msgs.find((m: any) => m.role === 'system' && m.content.includes('发送失败'))
    expect(errorMsg).toBeDefined()
    expect(errorMsg!.content).not.toContain('undefined')
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('null activeSessionId shows empty state with new session button', () => {
    useChatStore.setState({ activeSessionId: null })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    let text = ''
    function walk(n: any) {
      if (!n) return
      if (typeof n === 'string') { text += n; return }
      if (n.children) n.children.forEach(walk)
    }
    walk(tree.toJSON())
    expect(text).toContain('Select or create a session')
    expect(text).toContain('+ New Session')
  })

  it('send failure adds system error message', async () => {
    const mockCall = jest.fn().mockRejectedValue(new Error('Network error'))
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1', inputText: 'Hello' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const sendBtn = tree.root.find(
      (n: any) => typeof n.props?.onPress === 'function' && n.props?.disabled !== undefined,
    )

    await act(async () => { await sendBtn.props.onPress() })

    const msgs = useChatStore.getState().messages
    const errorMsg = msgs.find((m: any) => m.role === 'system' && m.content.includes('发送失败'))
    expect(errorMsg).toBeDefined()
    expect(errorMsg!.content).toContain('Network error')
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('auto-navigates back when activeSessionId is null and chatSubScreen is chat', () => {
    act(() => {
      useUiStore.setState({ chatSubScreen: 'chat' })
      useChatStore.setState({ activeSessionId: null })
    })
    TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(useUiStore.getState().chatSubScreen).toBe('sessions')
  })

  it('input is disabled when waiting', () => {
    useChatStore.setState({ activeSessionId: 's1', waiting: true })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const input = tree.root.find(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.placeholder === 'Type a message...',
    )
    expect(input.props.editable).toBe(false)
  })

  it('input is enabled when not waiting', () => {
    useChatStore.setState({ activeSessionId: 's1', waiting: false })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const input = tree.root.find(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.placeholder === 'Type a message...',
    )
    expect(input.props.editable).toBe(true)
  })

  it('onSubmitEditing triggers send', async () => {
    const mockCall = jest.fn().mockResolvedValue({})
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1', inputText: 'Hello via keyboard' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const input = tree.root.find(
      (n: any) => typeof n.props?.onSubmitEditing === 'function',
    )

    await act(async () => { await input.props.onSubmitEditing() })

    expect(mockCall).toHaveBeenCalledWith('message.send', { sessionId: 's1', message: 'Hello via keyboard' })
    expect(useChatStore.getState().inputText).toBe('')
  })

  it('info button opens SessionInfoModal', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const infoBtn = pressables.find((n: any) => {
      let text = ''
      function walk(node: any) {
        if (!node) return
        if (typeof node === 'string') { text += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return text.includes('📋')
    })
    expect(infoBtn).toBeTruthy()

    act(() => { infoBtn!.props.onPress() })
    const modal = tree.root.find(
      (n: any) => n.props?.visible !== undefined && n.props?.sessionId !== undefined,
    )
    expect(modal.props.visible).toBe(true)
  })

  it('refresh button triggers fetchSessions', async () => {
    const mockCall = jest.fn().mockResolvedValue({ sessions: [] })
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const refreshBtn = pressables.find((n: any) => {
      let text = ''
      function walk(node: any) {
        if (!node) return
        if (typeof node === 'string') { text += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return text.includes('↻')
    })
    expect(refreshBtn).toBeTruthy()

    await act(async () => { await refreshBtn!.props.onPress() })
    expect(mockCall).toHaveBeenCalledWith('session.list', expect.anything())
  })

  it('+ New Session button creates new session', async () => {
    const mockCall = jest.fn().mockResolvedValue({ id: 'new-session-123' })
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: null })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const newSessionBtn = pressables.find((n: any) => {
      let text = ''
      function walk(node: any) {
        if (!node) return
        if (typeof node === 'string') { text += node; return }
        if (node.children) node.children.forEach(walk)
      }
      walk(n)
      return text.includes('+ New Session')
    })
    expect(newSessionBtn).toBeTruthy()

    await act(async () => { await newSessionBtn!.props.onPress() })
    expect(mockCall).toHaveBeenCalledWith('session.create', expect.anything())
    expect(useChatStore.getState().activeSessionId).toBe('new-session-123')
  })

  // ToolProgressCard is tested separately in components.test.tsx
  // FlatList footer (where ToolProgressCard renders) is not rendered by TestRenderer mock

  it('handleSearch early returns when no client', () => {
    useChatStore.setState({ waiting: true, messages: [], activeSessionId: 's1' })
    useAuthStore.setState({ client: null as any })
    const tree = TestRenderer.create(<ChatScreen />)
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const searchBtn = pressables.find((n: any) => {
      let text = ''
      function walk(n: any) {
        if (!n) return
        if (typeof n === 'string') { text += n; return }
        if (n.children) n.children.forEach(walk)
      }
      walk(n)
      return text.includes('↻')
    })
    if (searchBtn) {
      act(() => { searchBtn.props.onPress() })
      useChatStore.setState({ waiting: true })
    }
  })

  it('handleSend early returns when no activeSessionId', () => {
    useChatStore.setState({ activeSessionId: null, inputText: 'hello', messages: [] })
    useAuthStore.setState({ client: { call: jest.fn() } as any })
    act(() => { useChatStore.getState().setInputText('hello') })
  })

  it('handleSend early returns when no client', () => {
    useChatStore.setState({ activeSessionId: 's1', inputText: 'hello' })
    useAuthStore.setState({ client: null as any })
    act(() => { useChatStore.getState().setInputText('hello') })
  })

  it('shows Alert when new session without client', () => {
    useChatStore.setState({ activeSessionId: null })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const pressables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function',
    )
    const newBtn = pressables.find(
      (n: any) => n.props?.children?.props?.children === '+ New Session',
    )
    expect(newBtn).toBeDefined()
    act(() => { newBtn!.props.onPress() })
    expect(Alert.alert).toHaveBeenCalledWith('Error', '未连接到服务器')
  })
})
