import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Alert, KeyboardAvoidingView } from 'react-native'
import { ChatScreen } from '../src/screens/ChatScreen'
import { useChatStore } from '../src/stores/chatStore'
import { useAuthStore } from '../src/stores/authStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useUiStore } from '../src/stores/uiStore'
import { useConfigStore } from '../src/stores/configStore'
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

  it('input is multiline with no submit-on-enter path', () => {
    // 复用原 onSubmitEditing 用例的 setup/渲染步骤，仅改断言：
    // 多行输入 + 按钮发送（无回车发送路径）
    const mockCall = jest.fn().mockResolvedValue({})
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1', inputText: 'Hello via keyboard' })

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const input = tree.root.find(
      (n: any) => typeof n.props?.onChangeText === 'function' && n.props?.placeholder === 'Type a message...',
    )

    expect(input.props.multiline).toBe(true)
    expect(input.props.onSubmitEditing).toBeUndefined()
  })

  it('iOS keyboard offset derives from TAB_BAR_HEIGHT (not hardcoded 90)', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const kav = tree.root.findAllByType(KeyboardAvoidingView)[0]
    expect(kav.props.keyboardVerticalOffset).toBe(60 + 8)
    expect(kav.props.behavior).toBe('padding') // jest preset 下 Platform.OS 默认 'ios'
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

  it('refresh button syncs current session messages (replaces old backfill polling)', async () => {
    const mockCall = jest.fn().mockImplementation((method) => {
      if (method === 'session.messages') return Promise.resolve({ messages: [] })
      if (method === 'session.list') return Promise.resolve({ sessions: [] })
      return Promise.resolve({})
    })
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

    // 清掉挂载时由初始加载触发的 session.messages 调用，只验证按下刷新后的行为
    mockCall.mockClear()
    await act(async () => { await refreshBtn!.props.onPress() })
    // 主动作：同步当前会话最近消息（替代旧 25s backfill 轮询的语义）
    expect(mockCall).toHaveBeenCalledWith('session.messages', expect.objectContaining({ sessionId: 's1', order: 'desc' }))
    // 附带刷新会话列表以更新标题栏模型/provider 显示
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

  // FlatList footer content is not rendered by TestRenderer mock

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
    // 注意：MessageItem 把 user/system 的 content 也走 MarkdownRenderer（与旧 renderMessage 纯 Text 不同）。
    // 行为校准交由 Task 11；这里同步为新结构下的断言：user + assistant 各渲染一个 MarkdownRenderer。
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
    expect(mdComponents).toHaveLength(2)
    // inverted 展示序：最新消息（m2 'Hi'）先渲染
    expect(mdComponents.map((m) => m.props.content)).toEqual(['Hi', 'Hello'])
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
    // 同上：MessageItem 对 system 消息也走 MarkdownRenderer，旧断言（0 个）已随结构失效，
    // 同步为新结构（1 个）并留给 Task 11 校准最终行为。
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
    expect(mdComponents).toHaveLength(1)
    expect(mdComponents[0].props.content).toBe('System notice')
  })

  it('multiple assistant messages each get their own MarkdownRenderer', () => {
    // 结构变更：MessageItem 对中间 user 消息也渲染 MarkdownRenderer，故总数由 2 → 3。
    // 旧断言按索引取 assistant 内容已失效，改为校验 assistant 内容均在渲染结果中。
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
    expect(mdComponents).toHaveLength(3)
    const contents = mdComponents.map((m) => m.props.content)
    expect(contents).toContain('First')
    expect(contents).toContain('Second')
  })

  // ─── 历史消息全量加载（选择已有会话） ──────────────────────

  it('loads full history via getSessionMessages when session becomes active (order desc)', async () => {
    // 不替换 getSessionMessages，改 mock client.call（getSessionMessages 底层调用它）
    const callMock = jest.fn().mockImplementation((method: string) => {
      if (method === 'session.messages') {
        return Promise.resolve({
          messages: [
            // bridge 统一输出升序（旧→新）：h1=First Q 最旧, h3=Second Q 最新
            { id: 'h1', role: 'user', content: 'First Q', text: 'First Q', rawContent: 'First Q' },
            { id: 'h2', role: 'assistant', content: 'First A', text: 'First A', rawContent: 'First A' },
            { id: 'h3', role: 'user', content: 'Second Q', text: 'Second Q', rawContent: 'Second Q' },
          ],
          cursor: undefined,
        })
      }
      return Promise.resolve({})
    })
    const client = { call: callMock, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    let tree: TestRenderer.ReactTestRenderer
    await act(async () => {
      tree = TestRenderer.create(
        <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
      )
    })

    // 底层 client.call 被调用，order: desc
    expect(callMock).toHaveBeenCalledWith('session.messages', expect.objectContaining({ order: 'desc', limit: 50 }))
    const msgs = useChatStore.getState().messages
    // bridge 升序输出，App 直接渲染：最新在底部
    expect(msgs.map((m) => m.content)).toEqual(['First Q', 'First A', 'Second Q'])
  })

  it('dedupes history messages by messageID when re-loaded', async () => {
    const callMock = jest.fn().mockImplementation((method: string) => {
      if (method === 'session.messages') {
        return Promise.resolve({
          messages: [
            { id: 'h1', role: 'user', content: 'Q', text: 'Q', rawContent: 'Q' },
            { id: 'h2', role: 'assistant', content: 'A', text: 'A', rawContent: 'A' },
          ],
          cursor: undefined,
        })
      }
      return Promise.resolve({})
    })
    const client = { call: callMock, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
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
    const callMock = jest.fn().mockImplementation((method: string) => {
      if (method === 'session.messages') {
        return Promise.resolve({
          messages: [
            { id: 'h1', role: 'user', content: 'Oldest Q', text: 'Oldest Q', rawContent: 'Oldest Q' },
            { id: 'h2', role: 'assistant', content: 'Latest A', text: 'Latest A', rawContent: 'Latest A' },
          ],
          cursor: undefined,
        })
      }
      return Promise.resolve({})
    })
    const client = { call: callMock, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    let tree: TestRenderer.ReactTestRenderer
    await act(async () => {
      tree = TestRenderer.create(<ChatScreen onNavigateToSessions={onNavigateToSessions} />)
    })

    const text = textOf(tree!)
    expect(text).toContain('Oldest Q')
    expect(text).toContain('Latest A')
  })

  it('does NOT duplicate message text when rawContent is a text-part array (user & assistant)', async () => {
    // 真实服务端 v2 消息 {info, parts:[{type:'text',text}]}：sessionStore 归一化后
    // content 与 rawContent(=parts) 都含文本。回归 bug：buildPartsFromRaw 把 text part
    // 同时塞进 content 和 parts → MessageItem 渲染两遍。user 与 assistant 都会触发。
    const callMock = jest.fn().mockImplementation((method: string) => {
      if (method === 'session.messages') {
        return Promise.resolve({
          messages: [
            { info: { id: 'u1', role: 'user', time: { created: 1000 } }, parts: [{ type: 'text', text: 'Hello Dup' }] },
            { info: { id: 'a1', role: 'assistant', time: { created: 2000 } }, parts: [{ type: 'text', text: 'Assist Reply Dup' }] },
          ],
          cursor: undefined,
        })
      }
      return Promise.resolve({})
    })
    const client = { call: callMock, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    let tree: TestRenderer.ReactTestRenderer
    await act(async () => {
      tree = TestRenderer.create(<ChatScreen onNavigateToSessions={onNavigateToSessions} />)
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(2)
    // 任何角色的 text part 都不应残留（content 已承载文本）
    const textParts = msgs.flatMap((m) => (m.parts || []).filter((p: any) => p.type === 'text'))
    expect(textParts).toHaveLength(0)

    // 渲染层面：每个文本在 MarkdownRenderer 中只出现一次
    const md = tree!.root.findAllByType(MarkdownRenderer)
    const contents = md.map((m) => m.props.content)
    expect(contents.filter((c: string) => c === 'Hello Dup')).toHaveLength(1)
    expect(contents.filter((c: string) => c === 'Assist Reply Dup')).toHaveLength(1)
  })

  it('loads latest messages via desc order on session open', async () => {
    const callMock = jest.fn().mockImplementation((method: string) => {
      if (method === 'session.messages') {
        return Promise.resolve({
          messages: [
            // bridge 统一输出升序（旧→新）：h1=Q1 最旧, h3=Q2 最新
            { id: 'h1', role: 'user', content: 'Q1', text: 'Q1', rawContent: 'Q1' },
            { id: 'h2', role: 'assistant', content: 'A1', text: 'A1', rawContent: 'A1' },
            { id: 'h3', role: 'user', content: 'Q2', text: 'Q2', rawContent: 'Q2' },
          ],
          cursor: undefined,
        })
      }
      return Promise.resolve({})
    })
    const client = { call: callMock, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })

    await act(async () => {
      TestRenderer.create(<ChatScreen onNavigateToSessions={onNavigateToSessions} />)
    })

    const msgs = useChatStore.getState().messages
    // bridge 升序输出，App 直接渲染：Q1, A1, Q2（最新在底部）
    expect(msgs.map((m) => m.content)).toEqual(['Q1', 'A1', 'Q2'])
    expect(msgs).toHaveLength(3)
  })

  // ─── 模型选择（Model Picker）──────────────────────────────

  it('模型选择：同名模型跨 provider 时只选中一个 ✓', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'Chat', createdAt: '', updatedAt: '', messageCount: 0,
        model: { id: 'deepseek-v4-flash', providerID: 'opencode' },
      }],
    })
    useConfigStore.setState({
      models: [
        { id: 'deepseek-v4-flash', providerID: 'opencode-go', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek-v4-flash', providerID: 'opencode', name: 'DeepSeek V4 Flash' },
        { id: 'gpt-5', providerID: 'opencode', name: 'GPT-5' },
      ],
    })
    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    const modelBtn = tree.root.find(
      (n: any) => n.props?.accessibilityLabel === 'Model settings',
    )
    act(() => { modelBtn.props.onPress() })
    const text = textOf(tree)
    const checks = (text.match(/✓/g) || []).length
    expect(checks).toBe(1)
  })

  it('模型选择：点击条目按精确 provider 切换', async () => {
    const mockCall = jest.fn().mockImplementation((method: string) => {
      if (method === 'session.messages') return Promise.resolve({ messages: [] })
      if (method === 'session.list') return Promise.resolve({ sessions: [] })
      if (method === 'session.switchModel') return Promise.resolve({ ok: true })
      return Promise.resolve({})
    })
    const client = { call: mockCall, on: jest.fn(() => jest.fn()), connected: true, token: 't', listFiles: jest.fn(), readFile: jest.fn(), searchFiles: jest.fn() }
    act(() => { useAuthStore.setState({ client: client as any }) })
    useChatStore.setState({ activeSessionId: 's1' })
    useSessionStore.setState({
      sessions: [{ id: 's1', name: 'Chat', createdAt: '', updatedAt: '', messageCount: 0 }],
    })
    useConfigStore.setState({
      models: [
        { id: 'deepseek-v4-flash', providerID: 'opencode-go', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek-v4-flash', providerID: 'opencode', name: 'DeepSeek V4 Flash' },
        { id: 'gpt-5', providerID: 'opencode', name: 'GPT-5' },
      ],
    })
    let tree: TestRenderer.ReactTestRenderer
    await act(async () => {
      tree = TestRenderer.create(<ChatScreen onNavigateToSessions={onNavigateToSessions} />)
    })

    const openModal = () => {
      const modelBtn = tree!.root.find((n: any) => n.props?.accessibilityLabel === 'Model settings')
      act(() => { modelBtn.props.onPress() })
    }
    openModal()

    // 找包含 'GPT-5' 的模型条目：先定位该条目的 Text，再向上找到最近的可点击祖先
    // （不能直接按文本匹配任意 onPress——Modal 外层 overlay 也含 onPress 且子树包含全部条目）
    const gptTextNode = tree!.root.findAll((n: any) => n.type && n.props?.children === 'GPT-5')[0]
    expect(gptTextNode).toBeTruthy()
    let gptItem: any = gptTextNode
    while (gptItem && typeof gptItem.props?.onPress !== 'function') {
      gptItem = gptItem.parent
    }
    expect(gptItem).toBeTruthy()

    await act(async () => { await gptItem!.props.onPress() })
    expect(mockCall).toHaveBeenCalledWith('session.switchModel', {
      sessionId: 's1',
      model: { id: 'gpt-5', providerID: 'opencode', variant: undefined },
    })
  })
})
