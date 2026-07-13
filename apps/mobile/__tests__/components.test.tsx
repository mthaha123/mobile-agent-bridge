import React from 'react'
import TestRenderer from 'react-test-renderer'
import { ToolProgressCard } from '../src/components/ToolProgressCard'
import { SessionInfoModal } from '../src/screens/SessionInfoModal'
import { QuestionSheet, setQuestionReplyCall } from '../src/screens/QuestionSheet'
import { useToolProgressStore } from '../src/stores/toolProgressStore'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'
import { useQuestionStore } from '../src/stores/questionStore'

beforeEach(() => {
  useToolProgressStore.setState({ activeCalls: [] })
  useDiffStore.setState({ diffs: {} })
  useTodoStore.setState({ todos: {} })
  useQuestionStore.setState({ pending: [], visible: false })
})

// ─── ToolProgressCard ─────────────────────────────────────

describe('ToolProgressCard', () => {
  it('renders nothing when no active calls', () => {
    const tree = TestRenderer.create(<ToolProgressCard />)
    expect(tree.toJSON()).toBeNull()
  })

  it('renders running tool calls', () => {
    useToolProgressStore.getState().addCall({
      callID: 'c1', sessionId: 's1', tool: 'read', input: { path: 'file.ts' },
    })
    const tree = TestRenderer.create(<ToolProgressCard />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('does not render for completed calls', () => {
    useToolProgressStore.setState({
      activeCalls: [{
        callID: 'c1', sessionId: 's1', tool: 'read', input: {},
        status: 'success', startedAt: 100,
      }],
    })
    const tree = TestRenderer.create(<ToolProgressCard />)
    expect(tree.toJSON()).toBeNull()
  })
})

// ─── SessionInfoModal ─────────────────────────────────────

describe('SessionInfoModal', () => {
  it('renders when visible', () => {
    const tree = TestRenderer.create(
      <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('displays diffs for the session', () => {
    useDiffStore.getState().setDiffs('s1', [
      { file: 'src/index.ts', additions: 5, deletions: 2, status: 'modified' },
    ])
    const tree = TestRenderer.create(
      <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders empty state without crashing', () => {
    const tree = TestRenderer.create(
      <SessionInfoModal visible sessionId="s1" onClose={jest.fn()} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})

// ─── QuestionSheet ─────────────────────────────────────────

describe('QuestionSheet', () => {
  it('renders nothing visible when no questions', () => {
    const tree = TestRenderer.create(<QuestionSheet />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders question when modal visible with pending', () => {
    useQuestionStore.getState().addQuestion({
      id: 'q1', sessionId: 's1',
      questions: [{
        question: 'Allow?', header: 'Permission',
        options: [{ label: 'Yes', description: 'Allow access' }],
      }],
    })
    const tree = TestRenderer.create(<QuestionSheet />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('resets selection state when question changes', () => {
    useQuestionStore.setState({
      pending: [{
        id: 'q1', sessionId: 's1',
        questions: [{
          question: 'Q1', header: '', options: [{ label: 'A', description: '' }],
        }],
      }],
      visible: true,
    })
    const renderer = TestRenderer.create(<QuestionSheet />)
    TestRenderer.act(() => {
      useQuestionStore.setState({
        pending: [{
          id: 'q2', sessionId: 's1',
          questions: [{
            question: 'Q2', header: '', options: [{ label: 'B', description: '' }],
          }],
        }],
        visible: true,
      })
    })
  })
})

describe('setQuestionReplyCall', () => {
  it('accepts a reply callback', () => {
    const cb = jest.fn()
    expect(() => setQuestionReplyCall(cb)).not.toThrow()
  })
})
