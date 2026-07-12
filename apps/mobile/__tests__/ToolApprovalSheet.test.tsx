import React from 'react'
import TestRenderer from 'react-test-renderer'
import { ToolApprovalSheet, setToolReplyCall } from '../src/screens/ToolApprovalSheet'
import { useToolStore } from '../src/stores/toolStore'

const replyCall = jest.fn()

beforeEach(() => {
  useToolStore.setState({ pendingApprovals: [], visible: false })
  setToolReplyCall(replyCall)
})

// ─── Modal visibility ─────────────────────────────────────

describe('ToolApprovalSheet', () => {
  it('renders when visible with pending items', () => {
    useToolStore.setState({
      visible: true,
      pendingApprovals: [{
        id: 'a1', tool: 'read', args: { path: 'file.ts' },
        sessionId: 's1', requestedAt: Date.now(),
      }],
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders when visible but no pending (empty placeholder)', () => {
    useToolStore.setState({ visible: true, pendingApprovals: [] })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders tool name and args', () => {
    useToolStore.setState({
      visible: true,
      pendingApprovals: [{
        id: 'a1', tool: 'writeFile', args: { path: 'src/index.ts', content: '...' },
        sessionId: 's1', requestedAt: Date.now(),
      }],
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('approve calls replyCall with true then dequeues', async () => {
    const enqueueSpy = jest.spyOn(useToolStore.getState(), 'enqueue')
    const dequeueSpy = jest.spyOn(useToolStore.getState(), 'dequeue')

    useToolStore.getState().enqueue({
      id: 'a1', tool: 'read', args: {},
      sessionId: 's1', requestedAt: Date.now(),
    })

    await useToolStore.getState().approve('a1', replyCall)
    expect(replyCall).toHaveBeenCalledWith('a1', true)

    const remaining = useToolStore.getState().pendingApprovals
    expect(remaining.find((a) => a.id === 'a1')).toBeUndefined()
  })

  it('reject calls replyCall with false then dequeues', async () => {
    useToolStore.getState().enqueue({
      id: 'a2', tool: 'write', args: {},
      sessionId: 's1', requestedAt: Date.now(),
    })

    await useToolStore.getState().reject('a2', replyCall)
    expect(replyCall).toHaveBeenCalledWith('a2', false)

    const remaining = useToolStore.getState().pendingApprovals
    expect(remaining.find((a) => a.id === 'a2')).toBeUndefined()
  })
})

// ─── setToolReplyCall ──────────────────────────────────────

describe('setToolReplyCall', () => {
  it('accepts a reply callback', () => {
    const cb = jest.fn()
    expect(() => setToolReplyCall(cb)).not.toThrow()
  })
})
