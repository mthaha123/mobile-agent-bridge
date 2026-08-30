/**
 * QuestionSheet 测试 — 全局提问弹窗
 *
 * 覆盖"息屏/断线期间对账补回的提问"在任意页面都能被看到并处理：
 *   - 只接管"非当前会话"的提问（与 ChatScreen 内联 QuestionDock 互斥）
 *   - 显示来源会话名 + 一键跳转到该会话
 *   - 关掉某条后不再打扰，但新提问仍会弹出
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Modal } from 'react-native'
import { QuestionSheet } from '../src/screens/QuestionSheet'
import { useQuestionStore } from '../src/stores/questionStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { useUiStore } from '../src/stores/uiStore'
import { useChatStore } from '../src/stores/chatStore'
import { resetAllStores, textOf, findAllPressable } from './test-utils'

const q1 = {
  id: 'que-1',
  sessionId: 'sess-A',
  questions: [
    {
      question: 'Deploy now?',
      header: 'deploy',
      options: [{ label: 'Yes', description: 'go' }, { label: 'No', description: 'stop' }],
      multiple: false,
    },
  ],
}

const q2 = {
  id: 'que-2',
  sessionId: 'sess-B',
  questions: [
    { question: 'Second?', header: 'x', options: [{ label: 'OK', description: '' }], multiple: false },
  ],
}

function findPressableByText(tree: TestRenderer.ReactTestRenderer, label: string) {
  return findAllPressable(tree).find((n) => {
    let text = ''
    function walk(node: any) {
      if (!node) return
      if (typeof node === 'string') { text += node; return }
      if (node.children) {
        if (Array.isArray(node.children)) node.children.forEach(walk)
        else walk(node.children)
      }
    }
    walk(n)
    return text.includes(label)
  })
}

beforeEach(() => {
  resetAllStores()
  useSessionStore.setState({
    sessions: [
      { id: 'sess-A', name: '会话甲', createdAt: '', updatedAt: '', messageCount: 0 },
      { id: 'sess-B', name: '会话乙', createdAt: '', updatedAt: '', messageCount: 0 },
    ],
    loading: false,
    error: null,
  })
  jest.clearAllMocks()
})

describe('QuestionSheet（全局弹窗）', () => {
  it('有待回答提问且不属于当前会话时弹出', () => {
    useQuestionStore.setState({ pending: [q1], visible: true, visibleSessionId: 'sess-B' })
    const tree = TestRenderer.create(<QuestionSheet />)
    const modal = tree.root.findByType(Modal)
    expect(modal.props.visible).toBe(true)
    expect(textOf(tree)).toContain('Deploy now?')
  })

  it('提问属于当前可见会话时不弹（交给内联 Dock，避免双弹）', () => {
    useQuestionStore.setState({ pending: [q1], visible: true, visibleSessionId: 'sess-A' })
    const tree = TestRenderer.create(<QuestionSheet />)
    const modal = tree.root.findByType(Modal)
    expect(modal.props.visible).toBe(false)
  })

  it('没有待回答提问时不弹', () => {
    useQuestionStore.setState({ pending: [], visible: false, visibleSessionId: null })
    const tree = TestRenderer.create(<QuestionSheet />)
    expect(tree.root.findByType(Modal).props.visible).toBe(false)
  })

  it('弹窗标明来源会话名', () => {
    useQuestionStore.setState({ pending: [q1], visible: true, visibleSessionId: null })
    const tree = TestRenderer.create(<QuestionSheet />)
    expect(textOf(tree)).toContain('会话甲')
  })

  it('点「去处理」切到 chat 页并打开该会话', () => {
    useUiStore.setState({ activeTab: 'files', chatSubScreen: 'sessions' })
    useChatStore.setState({ activeSessionId: 'sess-B' })
    useQuestionStore.setState({ pending: [q1], visible: true, visibleSessionId: null })

    const tree = TestRenderer.create(<QuestionSheet />)
    // 用 accessibilityLabel 精确定位（文本匹配会先命中外层遮罩）
    const btn = tree.root.find((n) => n.props?.accessibilityLabel === 'Go to session')
    expect(btn).toBeTruthy()
    act(() => { btn.props.onPress() })

    expect(useChatStore.getState().activeSessionId).toBe('sess-A')
    expect(useUiStore.getState().activeTab).toBe('chat')
    expect(useUiStore.getState().chatSubScreen).toBe('chat')
  })

  it('多条待回答时显示计数', () => {
    useQuestionStore.setState({ pending: [q1, q2], visible: true, visibleSessionId: null })
    const tree = TestRenderer.create(<QuestionSheet />)
    expect(textOf(tree)).toContain('2 条待回答')
  })

  it('关掉某条后不再显示，但新提问仍会弹出', () => {
    useQuestionStore.setState({ pending: [q1], visible: true, visibleSessionId: null })
    const tree = TestRenderer.create(<QuestionSheet />)
    expect(tree.root.findByType(Modal).props.visible).toBe(true)

    // 关闭（点遮罩 / onRequestClose）
    act(() => { tree.root.findByType(Modal).props.onRequestClose() })
    expect(tree.root.findByType(Modal).props.visible).toBe(false)

    // 新的提问（新 id）到达 → 重新弹出，且没有把 store 里的提问删掉
    act(() => {
      useQuestionStore.getState().addQuestion({ ...q2, sessionId: 'sess-B' })
    })
    expect(tree.root.findByType(Modal).props.visible).toBe(true)
    expect(useQuestionStore.getState().pending.map((q) => q.id)).toEqual(['que-1', 'que-2'])
  })
})
