/**
 * appFlow — 全流程集成测试
 *
 * 模拟完整 app 业务流程：登录 → 会话 → 聊天 → 工具审批/进度 → 问题向导
 * 所有 store 都使用真实实现，BridgeClient 用 mock 替换
 */
import { useAuthStore } from '../src/stores/authStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useChatStore } from '../src/stores/chatStore'
import { useToolStore } from '../src/stores/toolStore'
import { useQuestionStore } from '../src/stores/questionStore'
import { useToolProgressStore } from '../src/stores/toolProgressStore'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'
import { useProjectStore } from '../src/stores/projectStore'

/** 创建 mock BridgeClient */
function mockClient(handlers: Record<string, (params?: any) => any> = {}) {
  const call = jest.fn(async (method: string, params?: any) => {
    const h = handlers[method]
    if (h) return h(params)
    throw new Error(`Unexpected call: ${method}`)
  })
  return {
    on: jest.fn(),
    call,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    connected: true,
    token: 'mock-token',
  }
}

/** 通知 handler（模拟 AppProvider.setupClient 中注册的逻辑） */
function handleNotification(
  client: any,
  notify: (method: string, payload: any) => void,
) {
  // 提取 on('notification', handler) 中注册的 handler
  const onCalls = client.on.mock.calls.filter((c: any[]) => c[0] === 'notification')
  for (const [, handler] of onCalls) {
    handler(notify)
  }
}

beforeEach(() => {
  // 重置所有 store
  useAuthStore.setState({
    bridgeUrl: '', token: null, authenticated: false,
    loading: false, error: null, client: null,
  })
  useSessionStore.setState({ sessions: [], loading: false, error: null })
  useChatStore.setState({
    activeSessionId: null, messages: [], inputText: '', waiting: false,
  })
  useToolStore.setState({ pendingApprovals: [], visible: false })
  useQuestionStore.setState({ pending: [], visible: false })
  useToolProgressStore.setState({ activeCalls: [] })
  useDiffStore.setState({ diffs: {} })
  useTodoStore.setState({ todos: {} })
  useProjectStore.setState({ directory: '', project: null, switching: false })
})

// ─── 1. 认证 + 会话 流程 ────────────────────────────────

describe('Auth → Session flow', () => {
  it('creates client and fetches sessions after login', async () => {
    const client = mockClient({
      'auth.login': () => ({ token: 'jwt-123' }),
      'session.list': () => ([
        { id: 's1', name: 'Chat 1', createdAt: '2024-01-01', updatedAt: '2024-01-02', messageCount: 3 },
      ]),
      'project.current': () => ({ directory: '/home/user/project' }),
    })
    useAuthStore.setState({ client: client as any, bridgeUrl: 'ws://localhost:8080/ws' })

    // 模拟 AppProvider 注册 notification handler
    const notifyHandler = jest.fn()
    client.on('notification', notifyHandler)

    // 模拟 login 流程
    useAuthStore.setState({ token: 'jwt-123', authenticated: true, error: null })

    // 验证 client 就绪
    expect(useAuthStore.getState().token).toBe('jwt-123')
    expect(useAuthStore.getState().authenticated).toBe(true)

    // 获取会话列表
    const bindCall = client.call.bind(client)
    await useSessionStore.getState().fetchSessions(bindCall)

    const sessions = useSessionStore.getState().sessions
    expect(sessions).toHaveLength(1)
    expect(sessions[0].name).toBe('Chat 1')
    expect(sessions[0].messageCount).toBe(3)

    // 创建新会话
    useChatStore.getState().setActiveSession('s1')
    expect(useChatStore.getState().activeSessionId).toBe('s1')
  })

  it('creates session and navigates to chat', async () => {
    const client = mockClient({
      'session.create': () => ({ id: 's2', name: 'New Chat', createdAt: '2024-01-03', updatedAt: '2024-01-03', messageCount: 0 }),
    })
    const bindCall = client.call.bind(client)

    const id = await useSessionStore.getState().createSession(bindCall)
    expect(id).toBe('s2')

    useChatStore.getState().setActiveSession(id!)
    expect(useChatStore.getState().activeSessionId).toBe('s2')
    expect(useSessionStore.getState().sessions).toHaveLength(1)
  })
})

// ─── 2. 聊天 + 通知 流程 ─────────────────────────────────

describe('Chat + Notification flow', () => {
  it('sends message and receives delta via handler', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const client = mockClient({ 'message.send': () => ({}) })

    useChatStore.getState().addMessage({ role: 'user', content: 'Hello' })
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello')

    // 模拟 AppProvider 通知 handler
    const notifyHandler = jest.fn()
    client.on('notification', notifyHandler)

    // 模拟收到 text delta
    const { updateLastAssistant } = useChatStore.getState()
    updateLastAssistant('Hello!')
    expect(useChatStore.getState().messages).toHaveLength(2)
    expect(useChatStore.getState().messages[1].role).toBe('assistant')
    expect(useChatStore.getState().messages[1].content).toBe('Hello!')

    // 模拟增量追加（updateLastAssistant 现在是追加而非替换）
    updateLastAssistant(' How can I help?')
    expect(useChatStore.getState().messages[1].content).toBe('Hello! How can I help?')
  })

  it('handles session.status busy/idle', () => {
    useChatStore.setState({ activeSessionId: 's1', waiting: false })

    // busy
    useChatStore.getState().setWaiting(true)
    expect(useChatStore.getState().waiting).toBe(true)

    // idle
    useChatStore.getState().setWaiting(false)
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('aborts message and resets waiting', async () => {
    useChatStore.setState({ activeSessionId: 's1', waiting: true })
    const client = mockClient({ 'message.abort': () => {} })
    await useChatStore.getState().abortMessage('s1', client.call.bind(client))
    expect(useChatStore.getState().waiting).toBe(false)
  })
})

// ─── 3. 工具审批 流程 ─────────────────────────────────────

describe('Tool approval flow', () => {
  it('enqueues and approves tool request', async () => {
    const replyCall = jest.fn()
    const client = mockClient({
      'permission.v2.reply': () => ({}),
    })

    // enqueue（模拟 permission.v2.asked 通知）
    useToolStore.getState().enqueue({
      id: 'req-1', tool: 'writeFile', args: { path: 'test.ts' },
      sessionId: 's1', requestedAt: Date.now(),
    })
    expect(useToolStore.getState().pendingApprovals).toHaveLength(1)
    expect(useToolStore.getState().visible).toBe(true)

    // approve
    await useToolStore.getState().approve('req-1', replyCall)
    expect(replyCall).toHaveBeenCalledWith('req-1', 'once')
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
    expect(useToolStore.getState().visible).toBe(false)
  })

  it('enqueues and rejects tool request', async () => {
    const replyCall = jest.fn()

    useToolStore.getState().enqueue({
      id: 'req-2', tool: 'read', args: { path: 'config.json' },
      sessionId: 's1', requestedAt: Date.now(),
    })
    expect(useToolStore.getState().visible).toBe(true)

    await useToolStore.getState().reject('req-2', replyCall)
    expect(replyCall).toHaveBeenCalledWith('req-2', 'reject')
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
    expect(useToolStore.getState().visible).toBe(false)
  })

  it('keeps modal visible when multiple approvals queued', () => {
    useToolStore.getState().enqueue({
      id: 'req-1', tool: 'read', args: {},
      sessionId: 's1', requestedAt: Date.now(),
    })
    useToolStore.getState().enqueue({
      id: 'req-2', tool: 'write', args: {},
      sessionId: 's1', requestedAt: Date.now(),
    })
    expect(useToolStore.getState().pendingApprovals).toHaveLength(2)
    expect(useToolStore.getState().visible).toBe(true)
  })
})

// ─── 4. 工具进度 流程 ─────────────────────────────────────

describe('Tool progress flow', () => {
  it('tracks full tool call lifecycle', () => {
    // session.next.tool.called
    useToolProgressStore.getState().addCall({
      callID: 'call-1', sessionId: 's1', tool: 'read', input: { path: 'file.ts' },
    })
    let state = useToolProgressStore.getState()
    expect(state.activeCalls).toHaveLength(1)
    expect(state.activeCalls[0].tool).toBe('read')
    expect(state.activeCalls[0].status).toBe('called')

    // session.next.tool.progress
    useToolProgressStore.getState().updateProgress('call-1', { content: ['reading file...'] })
    state = useToolProgressStore.getState()
    expect(state.activeCalls[0].status).toBe('progress')
    expect(state.activeCalls[0].content).toEqual(['reading file...'])

    // session.next.tool.success
    useToolProgressStore.getState().markSuccess('call-1', ['done'], 'result', ['/tmp/out'])
    state = useToolProgressStore.getState()
    expect(state.activeCalls[0].status).toBe('success')
    expect(state.activeCalls[0].outputPaths).toEqual(['/tmp/out'])
  })

  it('handles tool failure', () => {
    useToolProgressStore.getState().addCall({
      callID: 'call-1', sessionId: 's1', tool: 'read', input: {},
    })
    useToolProgressStore.getState().markFailed('call-1', 'not found')
    const state = useToolProgressStore.getState()
    expect(state.activeCalls[0].status).toBe('failed')
    expect(state.activeCalls[0].error).toBe('not found')
  })
})

// ─── 5. 问题向导 流程 ─────────────────────────────────────

describe('Question wizard flow', () => {
  it('adds and removes questions', () => {
    // question.v2.asked notification
    useQuestionStore.getState().addQuestion({
      id: 'q-1', sessionId: 's1',
      questions: [{
        question: 'Allow file access?',
        header: 'Permission Required',
        options: [{ label: 'Yes', description: 'Allow' }, { label: 'No', description: 'Deny' }],
      }],
    })
    expect(useQuestionStore.getState().pending).toHaveLength(1)
    expect(useQuestionStore.getState().visible).toBe(true)

    useQuestionStore.getState().removeQuestion('q-1')
    expect(useQuestionStore.getState().pending).toHaveLength(0)
    expect(useQuestionStore.getState().visible).toBe(false)
  })

  it('handles multiple questions from same notification (multi-question)', () => {
    useQuestionStore.getState().addQuestion({
      id: 'q-1', sessionId: 's1',
      questions: [
        { question: 'Q1', header: '', options: [{ label: 'A', description: '' }] },
        { question: 'Q2', header: '', options: [{ label: 'B', description: '' }] },
      ],
    })
    expect(useQuestionStore.getState().pending[0].questions).toHaveLength(2)
  })

  it('clears all questions for a session', () => {
    useQuestionStore.getState().addQuestion({
      id: 'q-1', sessionId: 's1',
      questions: [{ question: 'Q?', header: '', options: [] }],
    })
    useQuestionStore.getState().addQuestion({
      id: 'q-2', sessionId: 's1',
      questions: [{ question: 'Q2?', header: '', options: [] }],
    })
    expect(useQuestionStore.getState().pending).toHaveLength(2)

    useQuestionStore.getState().clearSession('s1')
    expect(useQuestionStore.getState().pending).toHaveLength(0)
    expect(useQuestionStore.getState().visible).toBe(false)
  })
})

// ─── 6. Diff + Todo 流程 ─────────────────────────────────

describe('Diff + Todo flow', () => {
  it('stores diffs per session', () => {
    useDiffStore.getState().setDiffs('s1', [
      { file: 'src/index.ts', additions: 5, deletions: 2, status: 'modified' },
    ])
    expect(useDiffStore.getState().diffs['s1']).toHaveLength(1)
    expect(useDiffStore.getState().diffs['s1'][0].additions).toBe(5)

    // clear
    useDiffStore.getState().clearSession('s1')
    expect(useDiffStore.getState().diffs['s1']).toBeUndefined()
  })

  it('stores todos per session', () => {
    useTodoStore.getState().setTodos('s1', [
      { content: 'Add tests', status: 'pending', priority: 'high' },
    ])
    expect(useTodoStore.getState().todos['s1']).toHaveLength(1)
    expect(useTodoStore.getState().todos['s1'][0].content).toBe('Add tests')
  })
})

// ─── 7. 完整业务流程 模拟 ─────────────────────────────────

describe('Full app flow simulation', () => {
  it('auth → sessions → tool progress → tool approval', async () => {
    // Step 1: Auth
    const client = mockClient({
      'auth.login': () => ({ token: 'jwt-full' }),
      'session.list': () => ([
        { id: 's1', name: 'Project Chat', createdAt: '', updatedAt: '', messageCount: 5 },
      ]),
      'session.create': () => ({ id: 's2', name: 'New Task', createdAt: '', updatedAt: '', messageCount: 0 }),
      'message.send': () => ({}),
      'project.current': () => ({ directory: '/p' }),
    })
    useAuthStore.setState({
      client: client as any, token: 'jwt-full', authenticated: true, bridgeUrl: 'ws://localhost:8080/ws',
    })
    const bindCall = client.call.bind(client)

    // Step 2: Fetch sessions
    await useSessionStore.getState().fetchSessions(bindCall)
    expect(useSessionStore.getState().sessions).toHaveLength(1)

    // Step 3: Create new session
    const newId = await useSessionStore.getState().createSession(bindCall)
    expect(newId).toBe('s2')
    expect(useSessionStore.getState().sessions).toHaveLength(2)

    // Step 4: Enter chat
    useChatStore.getState().setActiveSession(newId!)
    expect(useChatStore.getState().activeSessionId).toBe('s2')

    // Step 5: Send message
    useChatStore.getState().addMessage({ role: 'user', content: 'Add error handling' })
    useChatStore.getState().setWaiting(true)

    // Step 6: Tool progress arrives
    useToolProgressStore.getState().addCall({
      callID: 'call-1', sessionId: 's2', tool: 'writeFile', input: { path: 'src/utils.ts' },
    })
    expect(useToolProgressStore.getState().activeCalls).toHaveLength(1)

    // Step 7: Tool approval arrives
    useToolStore.getState().enqueue({
      id: 'approve-1', tool: 'writeFile', args: { path: 'src/utils.ts' },
      sessionId: 's2', requestedAt: Date.now(),
    })
    expect(useToolStore.getState().pendingApprovals).toHaveLength(1)

    // Step 8: Approve tool
    const replyCall = jest.fn()
    await useToolStore.getState().approve('approve-1', replyCall)
    expect(replyCall).toHaveBeenCalledWith('approve-1', 'once')

    // Step 9: Tool progress updates
    useToolProgressStore.getState().updateProgress('call-1', { content: ['writing...'] })
    expect(useToolProgressStore.getState().activeCalls[0].status).toBe('progress')
    expect(useToolProgressStore.getState().activeCalls[0].content).toEqual(['writing...'])

    // Step 10: Tool completes
    useToolProgressStore.getState().markSuccess('call-1')

    // Step 11: AI response arrives
    useChatStore.getState().setWaiting(false)
    useChatStore.getState().addMessage({
      role: 'assistant', content: 'Added error handling to src/utils.ts',
    })
    expect(useChatStore.getState().messages).toHaveLength(2)
    expect(useChatStore.getState().waiting).toBe(false)
  })
})

// ─── 8. Delta 重组（stream reassembly） ───────────────────

describe('Delta stream reassembly', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages()
    useChatStore.getState().setActiveSession('s1')
  })

  it('appends in-order deltas sequentially', () => {
    const { appendAssistantDelta } = useChatStore.getState()
    appendAssistantDelta('m1', 'Hello', 1)
    appendAssistantDelta('m1', ' world', 2)
    appendAssistantDelta('m1', '!', 3)
    expect(useChatStore.getState().messages[0].content).toBe('Hello world!')
  })

  it('buffers out-of-order deltas and flushes when gap fills', () => {
    const { appendAssistantDelta } = useChatStore.getState()
    // id=1 arrives first (SSE 单连接保序)
    appendAssistantDelta('m1', 'Hello', 1)
    expect(useChatStore.getState().messages[0].content).toBe('Hello')
    // id=3 arrives before id=2 → buffered
    appendAssistantDelta('m1', '!', 3)
    expect(useChatStore.getState().messages[0].content).toBe('Hello')
    // id=2 arrives → applied, flush sees id=3 next → apply
    appendAssistantDelta('m1', ' world', 2)
    expect(useChatStore.getState().messages[0].content).toBe('Hello world!')
  })

  it('discards duplicate eventId', () => {
    const { appendAssistantDelta } = useChatStore.getState()
    appendAssistantDelta('m1', 'Hello', 1)
    appendAssistantDelta('m1', 'X', 1) // duplicate, id=1 already applied
    expect(useChatStore.getState().messages[0].content).toBe('Hello')
  })

  it('finalizeAssistantContent overrides accumulated content', () => {
    const { appendAssistantDelta, finalizeAssistantContent } = useChatStore.getState()
    appendAssistantDelta('m1', 'Hello', 1)
    appendAssistantDelta('m1', ' world', 2)
    finalizeAssistantContent('m1', 'Hello world!')
    expect(useChatStore.getState().messages[0].content).toBe('Hello world!')
    // stream state cleaned up
    expect(useChatStore.getState().streamStates['m1']).toBeUndefined()
  })

  it('finalizeAssistantContent creates message if none exists', () => {
    const { finalizeAssistantContent } = useChatStore.getState()
    finalizeAssistantContent('m1', 'Hello world!')
    expect(useChatStore.getState().messages[0].content).toBe('Hello world!')
  })

  it('advanceStreamId bridges gap between reasoning and text deltas', () => {
    const { appendAssistantDelta, advanceStreamId } = useChatStore.getState()
    // 模拟 reasoning: id=1,2,3
    appendAssistantDelta('m1', 'think', 1)
    appendAssistantDelta('m1', ' hard', 2)
    advanceStreamId('m1', 3) // reasoning.ended
    // 模拟 text: id=4,5,6
    appendAssistantDelta('m1', 'Answer', 4)
    appendAssistantDelta('m1', ' is 42', 5)
    expect(useChatStore.getState().messages[0].content).toBe('think hardAnswer is 42')
  })

  it('advanceStreamId flushes buffered deltas', () => {
    const { appendAssistantDelta, advanceStreamId } = useChatStore.getState()
    appendAssistantDelta('m1', 'Hello', 1)
    appendAssistantDelta('m1', '!', 3)   // id=3 入 buffer
    advanceStreamId('m1', 2)             // advance → flush id=3
    expect(useChatStore.getState().messages[0].content).toBe('Hello!')
  })
})
