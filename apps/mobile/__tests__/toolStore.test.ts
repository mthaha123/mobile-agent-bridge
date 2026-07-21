import { useToolStore, ToolApproval } from '../src/stores/toolStore'

const createApproval = (overrides: Partial<ToolApproval> = {}): ToolApproval => ({
  id: 'a1',
  tool: 'read',
  args: { path: '/test.ts' },
  sessionId: 's1',
  requestedAt: Date.now(),
  ...overrides,
})

const replyCall = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  useToolStore.setState({ pendingApprovals: [], visible: false })
})

describe('toolStore', () => {
  it('has correct initial state', () => {
    const s = useToolStore.getState()
    expect(s.pendingApprovals).toEqual([])
    expect(s.visible).toBe(false)
  })

  it('enqueue adds approval and sets visible', () => {
    const approval = createApproval()
    useToolStore.getState().enqueue(approval)
    const s = useToolStore.getState()
    expect(s.pendingApprovals).toHaveLength(1)
    expect(s.pendingApprovals[0].id).toBe('a1')
    expect(s.visible).toBe(true)
  })

  it('enqueue maintains FIFO order', () => {
    useToolStore.getState().enqueue(createApproval({ id: 'a1', requestedAt: 100 }))
    useToolStore.getState().enqueue(createApproval({ id: 'a2', requestedAt: 200 }))
    useToolStore.getState().enqueue(createApproval({ id: 'a3', requestedAt: 300 }))
    const ids = useToolStore.getState().pendingApprovals.map(a => a.id)
    expect(ids).toEqual(['a1', 'a2', 'a3'])
  })

  it('dequeue removes by id', () => {
    useToolStore.getState().enqueue(createApproval({ id: 'a1' }))
    useToolStore.getState().enqueue(createApproval({ id: 'a2' }))
    useToolStore.getState().dequeue('a1')
    const remaining = useToolStore.getState().pendingApprovals
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('a2')
  })

  it('dequeue auto-hides when queue becomes empty', () => {
    useToolStore.getState().enqueue(createApproval({ id: 'a1' }))
    expect(useToolStore.getState().visible).toBe(true)
    useToolStore.getState().dequeue('a1')
    expect(useToolStore.getState().visible).toBe(false)
  })

  it('dequeue keeps visible when items remain', () => {
    useToolStore.getState().enqueue(createApproval({ id: 'a1' }))
    useToolStore.getState().enqueue(createApproval({ id: 'a2' }))
    useToolStore.getState().dequeue('a1')
    expect(useToolStore.getState().visible).toBe(true)
  })

  it('approve calls replyCall with true then dequeues', async () => {
    useToolStore.getState().enqueue(createApproval({ id: 'a1' }))
    await useToolStore.getState().approve('a1', replyCall)
    expect(replyCall).toHaveBeenCalledWith('a1', 'once')
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('reject calls replyCall with false then dequeues', async () => {
    useToolStore.getState().enqueue(createApproval({ id: 'a1' }))
    await useToolStore.getState().reject('a1', replyCall)
    expect(replyCall).toHaveBeenCalledWith('a1', 'reject')
    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('setVisible toggles visibility', () => {
    useToolStore.getState().setVisible(true)
    expect(useToolStore.getState().visible).toBe(true)
    useToolStore.getState().setVisible(false)
    expect(useToolStore.getState().visible).toBe(false)
  })

  it('reject on non-existent id does not throw', async () => {
    await expect(
      useToolStore.getState().reject('non-existent', replyCall),
    ).resolves.not.toThrow()
  })

  it('approve on non-existent id does not throw', async () => {
    await expect(
      useToolStore.getState().approve('non-existent', replyCall),
    ).resolves.not.toThrow()
  })
})
