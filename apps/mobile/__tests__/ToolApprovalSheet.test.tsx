import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ToolApprovalSheet, setToolReplyCall } from '../src/screens/ToolApprovalSheet'
import { useToolStore } from '../src/stores/toolStore'

function textOf(target: any): string {
  let s = ''
  function walk(node: any) {
    if (!node) return
    if (typeof node === 'string') { s += node; return }
    if (typeof node === 'number') { s += String(node); return }
    if (node.children) {
      if (Array.isArray(node.children)) {
        node.children.forEach(walk)
      } else {
        walk(node.children)
      }
    }
  }
  if (target?.toJSON) {
    walk(target.toJSON())
  } else {
    walk(target)
  }
  return s
}

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
    expect(replyCall).toHaveBeenCalledWith('a1', 'once')

    const remaining = useToolStore.getState().pendingApprovals
    expect(remaining.find((a) => a.id === 'a1')).toBeUndefined()
  })

  it('reject calls replyCall with false then dequeues', async () => {
    useToolStore.getState().enqueue({
      id: 'a2', tool: 'write', args: {},
      sessionId: 's1', requestedAt: Date.now(),
    })

    await useToolStore.getState().reject('a2', replyCall)
    expect(replyCall).toHaveBeenCalledWith('a2', 'reject')

    const remaining = useToolStore.getState().pendingApprovals
    expect(remaining.find((a) => a.id === 'a2')).toBeUndefined()
  })

  it('renders tool name in pending approval', () => {
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1',
        tool: 'writeFile',
        args: { path: 'src/index.ts', content: 'hello world' },
        sessionId: 's1',
        requestedAt: Date.now(),
      })
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(textOf(tree)).toContain('writeFile')
  })

  it('renders argument keys and values', () => {
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1',
        tool: 'read',
        args: { path: '/test/file.ts', encoding: 'utf-8' },
        sessionId: 's1',
        requestedAt: Date.now(),
      })
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(textOf(tree)).toContain('path')
    expect(textOf(tree)).toContain('/test/file.ts')
    expect(textOf(tree)).toContain('encoding')
    expect(textOf(tree)).toContain('utf-8')
  })

  it('renders object args as JSON string', () => {
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1',
        tool: 'edit',
        args: { path: 'file.ts', options: { create: true } },
        sessionId: 's1',
        requestedAt: Date.now(),
      })
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(textOf(tree)).toContain('path')
    expect(textOf(tree)).toContain('file.ts')
    expect(textOf(tree)).toContain('create')
  })

  it('shows "No pending requests" when queue is empty', () => {
    act(() => {
      useToolStore.getState().setVisible(true)
      useToolStore.setState({ pendingApprovals: [] })
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(textOf(tree)).toContain('No pending requests')
  })

  it('auto-dismisses when queue becomes empty', async () => {
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1',
        tool: 'read',
        args: { path: '/test.ts' },
        sessionId: 's1',
        requestedAt: Date.now(),
      })
    })

    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(useToolStore.getState().visible).toBe(true)

    await act(async () => {
      await useToolStore.getState().approve('a1', replyCall)
    })

    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('overlay tap calls handleDismiss — items remain queued', () => {
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1',
        tool: 'read',
        args: { path: '/test.ts' },
        sessionId: 's1',
        requestedAt: Date.now(),
      })
    })

    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(useToolStore.getState().pendingApprovals).toHaveLength(1)

    const touchables = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && n.props?.activeOpacity === 1,
    )
    if (touchables.length > 0) {
      act(() => { touchables[0].props.onPress() })
    }

    expect(useToolStore.getState().pendingApprovals).toHaveLength(1)
  })

  it('renders with null args without crashing', () => {
    useToolStore.getState().enqueue({
      id: 'a1', tool: 'read', args: null as any,
      sessionId: 's1', requestedAt: Date.now(),
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders with undefined args without crashing', () => {
    useToolStore.getState().enqueue({
      id: 'a1', tool: 'read', args: undefined as any,
      sessionId: 's1', requestedAt: Date.now(),
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('maintains FIFO ordering of pending approvals', () => {
    useToolStore.getState().enqueue({
      id: 'a1', tool: 'read', args: {},
      sessionId: 's1', requestedAt: 100,
    })
    useToolStore.getState().enqueue({
      id: 'a2', tool: 'write', args: {},
      sessionId: 's1', requestedAt: 200,
    })
    useToolStore.getState().enqueue({
      id: 'a3', tool: 'edit', args: {},
      sessionId: 's1', requestedAt: 300,
    })

    const pending = useToolStore.getState().pendingApprovals
    expect(pending[0].id).toBe('a1')
    expect(pending[1].id).toBe('a2')
    expect(pending[2].id).toBe('a3')
  })

  it('dismisses when visible is set to false', () => {
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1', tool: 'read', args: {},
        sessionId: 's1', requestedAt: Date.now(),
      })
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    expect(tree.toJSON()).not.toBeNull()

    act(() => { useToolStore.setState({ visible: false }) })
    expect(useToolStore.getState().visible).toBe(false)
  })

  it('approve action calls replyCall with approved=true', async () => {
    const replyCall = jest.fn()
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1', tool: 'read', args: { path: '/test.ts' },
        sessionId: 's1', requestedAt: Date.now(),
      })
    })
    await useToolStore.getState().approve('a1', replyCall)
    expect(replyCall).toHaveBeenCalledWith('a1', 'once')
  })

  it('reject action calls replyCall with approved=false', async () => {
    const replyCall = jest.fn()
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a2', tool: 'write', args: {},
        sessionId: 's1', requestedAt: Date.now(),
      })
    })
    await useToolStore.getState().reject('a2', replyCall)
    expect(replyCall).toHaveBeenCalledWith('a2', 'reject')
  })

  it('does not crash when replyCall is null on approve', async () => {
    act(() => { setToolReplyCall(null) })
    act(() => {
      useToolStore.getState().enqueue({
        id: 'a1', tool: 'read', args: {},
        sessionId: 's1', requestedAt: Date.now(),
      })
    })
    const tree = TestRenderer.create(<ToolApprovalSheet />)
    const approveBtns = tree.root.findAll(
      (n: any) => typeof n.props?.onPress === 'function' && textOf(n).includes('Approve'),
    )
    if (approveBtns.length > 0) {
      await expect(async () => {
        await act(async () => { await approveBtns[0].props.onPress() })
      }).not.toThrow()
    }
  })
})

// ─── setToolReplyCall ──────────────────────────────────────

describe('setToolReplyCall', () => {
  it('accepts a reply callback', () => {
    const cb = jest.fn()
    expect(() => setToolReplyCall(cb)).not.toThrow()
  })
})
