import { useToolProgressStore, ToolCallProgress } from '../src/stores/toolProgressStore'

const baseCall = {
  callID: 'call-1',
  sessionId: 'sess-1',
  tool: 'read',
  input: { filePath: 'src/index.ts' },
}

function resetStore() {
  useToolProgressStore.setState({ activeCalls: [] })
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  resetStore()
})

describe('addCall', () => {
  it('adds a new call with status "called" and a startedAt timestamp', () => {
    useToolProgressStore.getState().addCall(baseCall)

    const calls = useToolProgressStore.getState().activeCalls
    expect(calls).toHaveLength(1)
    expect(calls[0].callID).toBe('call-1')
    expect(calls[0].sessionId).toBe('sess-1')
    expect(calls[0].tool).toBe('read')
    expect(calls[0].input).toEqual({ filePath: 'src/index.ts' })
    expect(calls[0].status).toBe('called')
    expect(calls[0].startedAt).toBeGreaterThan(0)
  })

  it('appends multiple calls', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().addCall({
      ...baseCall,
      callID: 'call-2',
      tool: 'write',
      input: { filePath: 'out.txt' },
    })

    expect(useToolProgressStore.getState().activeCalls).toHaveLength(2)
  })
})

describe('updateProgress', () => {
  it('updates fields on an existing call by callID', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().updateProgress('call-1', { status: 'progress', content: ['thinking...'] })

    const call = useToolProgressStore.getState().activeCalls[0]
    expect(call.status).toBe('progress')
    expect(call.content).toEqual(['thinking...'])
  })

  it('does nothing for a non-existent callID', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().updateProgress('call-unknown', { status: 'progress' })

    expect(useToolProgressStore.getState().activeCalls).toHaveLength(1)
    expect(useToolProgressStore.getState().activeCalls[0].status).toBe('called')
  })
})

describe('markSuccess', () => {
  it('marks a call as success with content, result, and outputPaths', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().markSuccess('call-1', ['line1'], { path: '/tmp/x' }, ['/tmp/x'])

    const call = useToolProgressStore.getState().activeCalls[0]
    expect(call.status).toBe('success')
    expect(call.content).toEqual(['line1'])
    expect(call.result).toEqual({ path: '/tmp/x' })
    expect(call.outputPaths).toEqual(['/tmp/x'])
  })

  it('updates existing fields when called after progress', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().updateProgress('call-1', { content: ['partial'] })
    useToolProgressStore.getState().markSuccess('call-1', ['final'])

    const call = useToolProgressStore.getState().activeCalls[0]
    expect(call.status).toBe('success')
    expect(call.content).toEqual(['final'])
  })
})

describe('markFailed', () => {
  it('marks a call as failed with an error', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().markFailed('call-1', new Error('permission denied'))

    const call = useToolProgressStore.getState().activeCalls[0]
    expect(call.status).toBe('failed')
    expect(call.error).toEqual(new Error('permission denied'))
  })
})

describe('clearSession', () => {
  it('removes all calls for the given sessionId', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().addCall({ ...baseCall, callID: 'call-2', sessionId: 'sess-1' })
    useToolProgressStore.getState().addCall({ ...baseCall, callID: 'call-3', sessionId: 'sess-2' })

    useToolProgressStore.getState().clearSession('sess-1')

    const calls = useToolProgressStore.getState().activeCalls
    expect(calls).toHaveLength(1)
    expect(calls[0].callID).toBe('call-3')
    expect(calls[0].sessionId).toBe('sess-2')
  })

  it('does nothing when sessionId has no calls', () => {
    useToolProgressStore.getState().addCall(baseCall)
    useToolProgressStore.getState().clearSession('sess-unknown')

    expect(useToolProgressStore.getState().activeCalls).toHaveLength(1)
  })
})
