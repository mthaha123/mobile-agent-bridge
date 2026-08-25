/**
 * test-utils — UI 层独立测试共享工具
 *
 * 提供 mock client factory、store reset、TestRenderer 树查找工具。
 * 所有 UI 测试通过这些工具模拟服务器回复，保证 UI 层独立验证。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useAuthStore } from '../src/stores/authStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useChatStore } from '../src/stores/chatStore'
import { useToolStore } from '../src/stores/toolStore'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'
import { useQuestionStore } from '../src/stores/questionStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useUiStore } from '../src/stores/uiStore'
import { useFileStore } from '../src/stores/fileStore'

// ─── Mock Client Factory ──────────────────────────────────

export interface MockClient {
  call: jest.Mock
  on: jest.Mock
  connect: jest.Mock
  disconnect: jest.Mock
  destroy: jest.Mock
  connected: boolean
  token: string | null
  listFiles: jest.Mock
  readFile: jest.Mock
  searchFiles: jest.Mock
}

/**
 * 创建 mock BridgeClient。
 * handlers 是 RPC 方法名 → 返回值函数的映射表。
 * 未在 handlers 中声明的方法调用会抛出错误，便于发现意外调用。
 */
export function mockClient(
  handlers: Record<string, (params?: any) => any> = {},
): MockClient {
  const call = jest.fn(async (method: string, params?: any) => {
    const h = handlers[method]
    if (h) return h(params)
    throw new Error(`Unhandled method: ${method}`)
  })
  return {
    call,
    on: jest.fn(() => jest.fn()), // returns unsubscribe fn
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    destroy: jest.fn(),
    connected: true,
    token: 'mock-token',
    listFiles: jest.fn().mockResolvedValue([]),
    readFile: jest.fn().mockResolvedValue({
      path: '', content: '', encoding: 'utf-8', size: 0,
    }),
    searchFiles: jest.fn().mockResolvedValue([]),
  }
}

// ─── Store Reset ──────────────────────────────────────────

/** 重置所有 store 到初始状态，确保测试隔离 */
export function resetAllStores() {
  useAuthStore.setState({
    bridgeUrl: '',
    token: null,
    authenticated: false,
    loading: false,
    error: null,
    client: null,
  })
  useSessionStore.setState({ sessions: [], loading: false, error: null })
  useChatStore.setState({
    activeSessionId: null,
    messages: [],
    inputText: '',
    waiting: false,
    sessionRunStatus: {},
  })
  useToolStore.setState({ pendingApprovals: [], visible: false })
  useDiffStore.setState({ diffs: {} })
  useTodoStore.setState({ todos: {} })
  useQuestionStore.setState({ pending: [], visible: false })
  useProjectStore.setState({ directory: '', project: null, switching: false })
  useUiStore.setState({
    screen: 'connect',
    activeTab: 'chat',
    chatSubScreen: 'sessions',
    filesSubScreen: 'browser',
  })
  useFileStore.getState().reset()
}

// ─── TestRenderer Tree Helpers ────────────────────────────

/** 提取 TestRenderer 树中的所有文本内容 */
export function textOf(tree: TestRenderer.ReactTestRenderer): string {
  let s = ''
  function walk(node: any) {
    if (!node) return
    if (typeof node === 'string') {
      s += node
      return
    }
    if (node.children) node.children.forEach(walk)
  }
  walk(tree.toJSON())
  return s
}

/** 找到所有含有 onPress 的节点 */
export function findAllPressable(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (node: any) => typeof node.props?.onPress === 'function',
  )
}

/** 找到第一个含有 onPress 的节点 */
export function findPressable(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.find(
    (node: any) => typeof node.props?.onPress === 'function',
  )
}

/** 找到所有含有 onChangeText 的输入框节点 */
export function findAllInputs(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAll(
    (node: any) => typeof node.props?.onChangeText === 'function',
  )
}

/** 找到第一个含有 onChangeText 的输入框节点 */
export function findInput(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.find(
    (node: any) => typeof node.props?.onChangeText === 'function',
  )
}
