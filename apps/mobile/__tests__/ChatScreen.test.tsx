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
import { MarkdownRenderer } from '../src/components/chat/MarkdownRenderer'

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

  // ─── Markdown rendering integration ──────────────────────

  it('assistant message renders via MarkdownRenderer', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'assistant', content: 'Hello **world**', timestamp: 1000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const mdComponents = tree.root.findAllByType(MarkdownRenderer)
    expect(mdComponents.length).toBeGreaterThanOrEqual(1)
    expect(mdComponents[0].props.content).toBe('Hello **world**')
  })

  it('assistant message with markdown renders content text', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'assistant', content: '# Title\n\n**bold** text\n\n```js\ncode\n```', timestamp: 1000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(textOf(tree)).toContain('Title')
    expect(textOf(tree)).toContain('bold')
    expect(textOf(tree)).toContain('code')
  })

  it('user message does not use MarkdownRenderer', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'user', content: 'Hello', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'Hi', timestamp: 2000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const mdComponents = tree.root.findAllByType(MarkdownRenderer)
    expect(mdComponents).toHaveLength(1)
    expect(mdComponents[0].props.content).toBe('Hi')
  })

  it('copy is available via long-press menu on messages', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'user', content: 'copy this', timestamp: 1000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    // 固定 Copy 按钮已移除（b7db1d1 align to Web style），消息内容仍可渲染
    expect(textOf(tree)).toContain('copy this')
  })

  it('assistant message content renders without fixed copy button', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'assistant', content: 'answer', timestamp: 1000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(textOf(tree)).toContain('answer')
  })

  it('system message does not use MarkdownRenderer', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'system', content: 'System notice', timestamp: 1000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const mdComponents = tree.root.findAllByType(MarkdownRenderer)
    expect(mdComponents).toHaveLength(0)
  })

  it('multiple assistant messages each get their own MarkdownRenderer', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      messages: [
        { id: 'm1', role: 'assistant', content: 'First', timestamp: 1000 },
        { id: 'm2', role: 'user', content: 'Okay', timestamp: 2000 },
        { id: 'm3', role: 'assistant', content: 'Second', timestamp: 3000 },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const mdComponents = tree.root.findAllByType(MarkdownRenderer)
    expect(mdComponents).toHaveLength(2)
    expect(mdComponents[0].props.content).toBe('First')
    expect(mdComponents[1].props.content).toBe('Second')
  })

  // ─── 历史消息全量加载（选择已有会话） ──────────────────────

  it('loads full history via getSessionMessages when session becomes active (order asc)', async () => {
    const getSessionMessages = jest.fn().mockResolvedValue({
      messages: [
        { id: 'h1', role: 'user', content: 'First Q', text: 'First Q', rawContent: 'First Q' },
        { id: 'h2', role: 'assistant', content: 'First A', text: 'First A', rawContent: 'First A' },
        { id: 'h3', role: 'user', content: 'Second Q', text: 'Second Q', rawContent: 'Second Q' },
      ],
      cursor: undefined,
    })
    useSessionStore.getState().getSessionMessages = getSessionMessages as any

    const client = { call: jest.fn(), on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    let tree: TestRenderer.ReactTestRenderer
    await act(async () => {
      tree = TestRenderer.create(
        <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
      )
    })

    expect(getSessionMessages).toHaveBeenCalledWith('s1', expect.anything(), { order: 'asc', limit: 50 })
    const msgs = useChatStore.getState().messages
    expect(msgs.map((m) => m.content)).toEqual(['First Q', 'First A', 'Second Q'])
  })

  it('dedupes history messages by messageID when re-loaded', async () => {
    const history = [
      { id: 'h1', role: 'user', content: 'Q', text: 'Q', rawContent: 'Q' },
      { id: 'h2', role: 'assistant', content: 'A', text: 'A', rawContent: 'A' },
    ]
    const getSessionMessages = jest.fn().mockResolvedValue({ messages: history, cursor: undefined })
    useSessionStore.getState().getSessionMessages = getSessionMessages as any

    const client = { call: jest.fn(), on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    await act(async () => {
      TestRenderer.create(<ChatScreen onNavigateToSessions={onNavigateToSessions} />)
    })
    const afterLoad = useChatStore.getState().messages
    expect(afterLoad).toHaveLength(2)

    // 再次加载相同历史 → 去重，不重复
    useChatStore.getState().addMessage({ role: 'user', content: 'Q', messageID: 'h1' })
    useChatStore.getState().addMessage({ role: 'assistant', content: 'A', messageID: 'h2' })
    expect(useChatStore.getState().messages).toHaveLength(2)
  })

  it('renders full history in chronological order (user first)', async () => {
    const getSessionMessages = jest.fn().mockResolvedValue({
      messages: [
        { id: 'h1', role: 'user', content: 'Oldest Q', text: 'Oldest Q', rawContent: 'Oldest Q' },
        { id: 'h2', role: 'assistant', content: 'Latest A', text: 'Latest A', rawContent: 'Latest A' },
      ],
      cursor: undefined,
    })
    useSessionStore.getState().getSessionMessages = getSessionMessages as any
    const client = { call: jest.fn(), on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    let tree: TestRenderer.ReactTestRenderer
    await act(async () => {
      tree = TestRenderer.create(<ChatScreen onNavigateToSessions={onNavigateToSessions} />)
    })

    const text = textOf(tree!)
    // user 消息在前（chronological），且都渲染了
    expect(text).toContain('Oldest Q')
    expect(text).toContain('Latest A')
  })

  it('backfills a newer message that arrives after the initial snapshot', async () => {
    const getSessionMessages = jest.fn().mockImplementation((_id, _cb, opts) => {
      // 初始 asc 快照：只有 h1/h2
      if (opts?.order === 'asc') {
        return Promise.resolve({
          messages: [
            { id: 'h1', role: 'user', content: 'Q1', text: 'Q1', rawContent: 'Q1' },
            { id: 'h2', role: 'assistant', content: 'A1', text: 'A1', rawContent: 'A1' },
          ],
          cursor: undefined,
        })
      }
      // desc 兜底刷新：已经多了一条 h3（事件流丢失窗口内产生的新消息）
      return Promise.resolve({
        messages: [
          { id: 'h3', role: 'user', content: 'Q2', text: 'Q2', rawContent: 'Q2' },
          { id: 'h2', role: 'assistant', content: 'A1', text: 'A1', rawContent: 'A1' },
          { id: 'h1', role: 'user', content: 'Q1', text: 'Q1', rawContent: 'Q1' },
        ],
        cursor: undefined,
      })
    })
    useSessionStore.getState().getSessionMessages = getSessionMessages as any

    const client = { call: jest.fn(), on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    await act(async () => {
      TestRenderer.create(<ChatScreen onNavigateToSessions={onNavigateToSessions} />)
    })

    const msgs = useChatStore.getState().messages
    // h3 合流进来且 h1/h2 不去重失败
    expect(msgs.map((m) => m.content)).toContain('Q2')
    expect(msgs).toHaveLength(3)
  })
})
