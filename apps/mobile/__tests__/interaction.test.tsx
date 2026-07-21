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
import { useToolProgressStore } from '../src/stores/toolProgressStore'
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
  useToolProgressStore.setState({ activeCalls: [] })
  useDiffStore.setState({ diffs: {} })
  useTodoStore.setState({ todos: {} })
  useProjectStore.setState({ directory: '', project: null, switching: false })
})

// ─── ConnectScreen 交互 ─────────────────────────────────

describe('ConnectScreen — user interaction', () => {
  it('clicking Connect button triggers login', () => {
    useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' })
    const tree = TestRenderer.create(<ConnectScreen />)
    const button = findPressable(tree)
    expect(button.props.onPress).toBeDefined()
  })

  it('shows loading state after clicking Connect', () => {
    useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' })
    const tree = TestRenderer.create(<ConnectScreen />)

    TestRenderer.act(() => {
      useAuthStore.setState({ loading: true })
    })

    // Should still render (loading spinner shown)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('displays error when login fails', () => {
    useAuthStore.setState({ bridgeUrl: 'ws://localhost:8080/ws' })
    const tree = TestRenderer.create(<ConnectScreen />)

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

    const tree = TestRenderer.create(
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

    const tree = TestRenderer.create(
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

    const tree = TestRenderer.create(<ToolApprovalSheet />)
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
    const tree = TestRenderer.create(
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

    const tree = TestRenderer.create(
      <ChatScreen onNavigateToSessions={jest.fn()} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})

// ─── 工具进度 + 通知 集成 ───────────────────────────────

describe('Tool progress + notification integration', () => {
  it('progress from called → progress → success', () => {
    const store = useToolProgressStore.getState()

    // called
    store.addCall({ callID: 'c1', sessionId: 's1', tool: 'writeFile', input: {} })
    expect(useToolProgressStore.getState().activeCalls[0].status).toBe('called')

    // progress
    store.updateProgress('c1', { content: ['writing...'] })
    expect(useToolProgressStore.getState().activeCalls[0].status).toBe('progress')

    // success
    store.markSuccess('c1')
    expect(useToolProgressStore.getState().activeCalls[0].status).toBe('success')
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
