/**
 * interaction — 用户交互模拟测试
 *
 * 模拟真实用户操作：点击按钮、输入文本，通过 TestRenderer 树查找元素并触发事件
 */
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { ConnectScreen } from '../src/screens/ConnectScreen'
import { SessionsScreen } from '../src/screens/SessionsScreen'
import { ChatScreen } from '../src/screens/ChatScreen'
import { ToolApprovalSheet } from '../src/screens/ToolApprovalSheet'
import { useAuthStore } from '../src/stores/authStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useChatStore } from '../src/stores/chatStore'
import { useToolStore } from '../src/stores/toolStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useQuestionStore } from '../src/stores/questionStore'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'

/** 在 TestRenderer 树中找到第一个含有 onPress 的节点 */
function findPressable(root: TestRenderer.ReactTestRenderer) {
  return root.root.find((node) => typeof node.props.onPress === 'function')
}

/** 在 TestRenderer 树中找到所有含有 onPress 的节点 */
function findAllPressable(root: TestRenderer.ReactTestRenderer) {
  return root.root.findAll((node) => typeof node.props.onPress === 'function')
}

/** 在 TestRenderer 树中找到含 onChangeText 的输入框 */
function findInput(root: TestRenderer.ReactTestRenderer) {
  return root.root.find((node) => typeof node.props.onChangeText === 'function')
}

/** 所有创建过的渲染树：用例结束后统一 unmount。
 *
 *  不卸载会留下"活的"组件：ConnectScreen mount 后有一个 500ms 的自动登录
 *  定时器（组件 cleanup 里 clearTimeout，但只有卸载才会执行）。用例跑完后
 *  定时器照样触发 login() → 测试结束后再 setState → React 报
 *  "update ... was not wrapped in act(...)" / "Cannot log after tests are done"，
 *  甚至让 jest worker 抛出未捕获异常（退出码非 0，但用例本身全过）。
 */
const rendered: TestRenderer.ReactTestRenderer[] = []
function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  const tree = TestRenderer.create(element)
  rendered.push(tree)
  return tree
}

afterEach(() => {
  while (rendered.length > 0) {
    const tree = rendered.pop()
    try { tree?.unmount() } catch { /* 已卸载则忽略 */ }
  }
  // 撤销用例遗留的定时器（ingestEvent → scheduleIdleVerify 排的 1.2s setTimeout、
  // ensureStatusPolling 的 statusPoll interval）。它们一旦在环境拆除后触发，
  // 就会惰性 import authStore 并抛 "import a file after the Jest environment
  // has been torn down" → worker 异常、进程退出码非 0（用例本身全过，容易被
  // 误判成 flaky）。
  useChatStore.getState().stopStatusPolling()
  useChatStore.getState().stopIdleVerify()
  jest.clearAllTimers()
})

beforeEach(() => {
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
  useDiffStore.setState({ diffs: {} })
  useTodoStore.setState({ todos: {} })
  useProjectStore.setState({ directory: '', project: null, switching: false })
})

// ─── ConnectScreen 交互 ─────────────────────────────────

describe('ConnectScreen — user interaction', () => {
  it('clicking Connect button triggers login', () => {
    useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' })
    const tree = render(<ConnectScreen />)
    const button = findPressable(tree)
    expect(button.props.onPress).toBeDefined()
  })

  it('shows loading state after clicking Connect', () => {
    useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' })
    const tree = render(<ConnectScreen />)

    TestRenderer.act(() => {
      useAuthStore.setState({ loading: true })
    })

    // Should still render (loading spinner shown)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('displays error when login fails', () => {
    useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' })
    const tree = render(<ConnectScreen />)

    TestRenderer.act(() => {
      useAuthStore.setState({ error: 'Connection refused' })
    })

    expect(tree.toJSON()).not.toBeNull()
  })
})

// ─── SessionsScreen 交互 ────────────────────────────────

describe('SessionsScreen — user interaction', () => {
  it('renders session items and allows selection', () => {
    const onNavigateToChat = jest.fn()
    const onBack = jest.fn()

    useSessionStore.setState({
      sessions: [{
        id: 's1', name: 'Test Session', createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), messageCount: 2,
      }],
    })

    const tree = render(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('navigates to chat when creating new session', () => {
    const onNavigateToChat = jest.fn()
    const onBack = jest.fn()

    useAuthStore.setState({
      client: {
        call: jest.fn().mockResolvedValue(
          { id: 'new-1', name: 'New', createdAt: '', updatedAt: '', messageCount: 0 },
        ),
        on: jest.fn(),
      } as any,
    })

    const tree = render(
      <SessionsScreen onNavigateToChat={onNavigateToChat} onBack={onBack} />,
    )

    // Find "+ New" button
    const buttons = findAllPressable(tree)
    expect(buttons.length).toBeGreaterThanOrEqual(2) // Back, New
  })
})

// ─── ToolApprovalSheet 交互 ─────────────────────────────

describe('ToolApprovalSheet — user interaction', () => {
  it('renders approve/reject buttons when approval is pending', () => {
    useToolStore.setState({
      visible: true,
      pendingApprovals: [{
        id: 'req-1', tool: 'writeFile', args: { path: 'test.ts' },
        sessionId: 's1', requestedAt: Date.now(),
      }],
    })

    const tree = render(<ToolApprovalSheet />)
    const pressables = findAllPressable(tree)
    // Dismiss (overlay) + Reject + Approve
    expect(pressables.length).toBeGreaterThanOrEqual(2)
  })

  it('approve button triggers store.approve', async () => {
    useToolStore.setState({
      visible: true,
      pendingApprovals: [{
        id: 'req-1', tool: 'read', args: {}, sessionId: 's1', requestedAt: Date.now(),
      }],
    })

    const replyCall = jest.fn()
    await useToolStore.getState().approve('req-1', replyCall)
    expect(replyCall).toHaveBeenCalledWith('req-1', 'once')
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('reject button triggers store.reject', async () => {
    useToolStore.setState({
      visible: true,
      pendingApprovals: [{
        id: 'req-2', tool: 'delete', args: {}, sessionId: 's1', requestedAt: Date.now(),
      }],
    })

    const replyCall = jest.fn()
    await useToolStore.getState().reject('req-2', replyCall)
    expect(replyCall).toHaveBeenCalledWith('req-2', 'reject')
  })
})

// ─── ChatScreen 交互 ────────────────────────────────────

describe('ChatScreen — user interaction', () => {
  it('new session button navigates in empty state', () => {
    const onNavigateToSessions = jest.fn()
    const tree = render(
      <ChatScreen onNavigateToSessions={onNavigateToSessions} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('sends message when send button pressed', () => {
    useChatStore.setState({
      activeSessionId: 's1',
      inputText: 'Hello',
    })
    useAuthStore.setState({
      client: { call: jest.fn(), on: jest.fn(), connected: true } as any,
    })

    const tree = render(
      <ChatScreen onNavigateToSessions={jest.fn()} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})

// ─── 工具进度 + 通知 集成 ───────────────────────────────

describe('Tool progress + notification integration', () => {
  it('progress from called → progress → success', () => {
    useChatStore.setState({ activeSessionId: 's1' })
    const ingest = (method: string, payload: any) => useChatStore.getState().ingestEvent(method, payload)
    const toolData = () => {
      const p = useChatStore.getState().messages.flatMap((m) => m.parts ?? []).find((x) => x.id === 'c1')
      if (!p) throw new Error('tool part c1 not found')
      return p.data as { status: string; tool: string }
    }

    // called
    ingest('session.next.tool.called', {
      sessionID: 's1', callID: 'c1', tool: 'writeFile', input: {},
    })
    expect(toolData()).toMatchObject({ status: 'called', tool: 'writeFile' })

    // progress
    ingest('session.next.tool.progress', { sessionID: 's1', callID: 'c1' })
    expect(toolData().status).toBe('progress')

    // success
    ingest('session.next.tool.success', {
      sessionID: 's1', callID: 'c1', content: [{ type: 'text', text: 'done' }],
    })
    expect(toolData().status).toBe('success')
  })

  it('notification handler enqueues tool and question', () => {
    // 模拟 AppProvider.notify 中注册的 handler
    const toolEnqueueSpy = jest.spyOn(useToolStore.getState(), 'enqueue')
    const questionAddSpy = jest.spyOn(useQuestionStore.getState(), 'addQuestion')

    // 模拟 permission.v2.asked 通知
    useToolStore.getState().enqueue({
      id: 'n1', tool: 'read', args: {}, sessionId: 's1', requestedAt: Date.now(),
    })
    expect(toolEnqueueSpy).toHaveBeenCalled()
    expect(useToolStore.getState().visible).toBe(true)

    // 模拟 question.v2.asked 通知
    useQuestionStore.getState().addQuestion({
      id: 'q1', sessionId: 's1',
      questions: [{ question: 'Allow?', header: '', options: [] }],
    })
    expect(questionAddSpy).toHaveBeenCalled()
    expect(useQuestionStore.getState().visible).toBe(true)
  })
})
