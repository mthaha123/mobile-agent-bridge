/**
 * AppProvider tests — project.changed event handler
 */

jest.mock('react-native', () => {
  const mockComponent = (name: string) => {
    const Comp: React.FC<{ children?: React.ReactNode }> = (props) =>
      props.children ?? null
    Comp.displayName = name
    return Comp
  }

  return {
    View: mockComponent('View'),
    Text: mockComponent('Text'),
    TextInput: mockComponent('TextInput'),
    TouchableOpacity: mockComponent('TouchableOpacity'),
    StyleSheet: { create: (s: any) => s },
    ActivityIndicator: mockComponent('ActivityIndicator'),
    Modal: mockComponent('Modal'),
    Alert: { alert: jest.fn() },
    KeyboardAvoidingView: mockComponent('KeyboardAvoidingView'),
    ScrollView: mockComponent('ScrollView'),
    Platform: { OS: 'ios', select: () => {} },
    Dimensions: { get: () => ({ width: 375, height: 812 }) },
  }
})

import React from 'react'
import TestRenderer from 'react-test-renderer'
import { AppProvider } from '../src/components/AppProvider'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useChatStore } from '../src/stores/chatStore'
import { useToolStore } from '../src/stores/toolStore'
import { useToolProgressStore } from '../src/stores/toolProgressStore'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'
import { useQuestionStore } from '../src/stores/questionStore'

function mockClientAndRender(): { notifyHandler: (method: string, payload: any) => void } {
  let notifyHandler: ((method: string, payload: any) => void) | null = null
  const mockClient = {
    on: jest.fn().mockImplementation((event: string, handler: any) => {
      if (event === 'notification') { notifyHandler = handler }
    }),
    call: jest.fn(), connect: jest.fn(), disconnect: jest.fn(),
    destroy: jest.fn(), connected: true, token: 'mock-token',
  }
  TestRenderer.act(() => { TestRenderer.create(<AppProvider>{null}</AppProvider>) })
  TestRenderer.act(() => { useAuthStore.setState({ client: mockClient as any }) })
  return { notifyHandler: notifyHandler! }
}

function resetStores() {
  useAuthStore.setState({
    bridgeUrl: '', token: null, authenticated: false,
    loading: false, error: null, client: null,
  })
  useProjectStore.setState({ directory: '', project: null, switching: false })
  useToolProgressStore.setState({ activeCalls: [] })
  useDiffStore.setState({ diffs: {} })
  useTodoStore.setState({ todos: {} })
  useQuestionStore.setState({ pending: [] })
}

beforeEach(() => {
  resetStores()
})

afterEach(() => {
  resetStores()
})

describe('project.changed handler', () => {
  it('updates project store when project.changed notification arrives', () => {
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('project.changed', {
        directory: '/new/project',
        project: { name: 'new-project' },
      })
    })

    const state = useProjectStore.getState()
    expect(state.directory).toBe('/new/project')
    expect(state.project).toEqual({ name: 'new-project' })
  })

  it('feeds text delta into chat store on session.next.text.delta', () => {
    const { notifyHandler } = mockClientAndRender()
    const updateLastAssistant = jest.spyOn(
      useChatStore.getState(),
      'updateLastAssistant',
    )

    TestRenderer.act(() => {
      notifyHandler!('session.next.text.delta', {
        sessionID: 'sess-1',
        assistantMessageID: 'msg-1',
        textID: 'txt-1',
        delta: 'Hello ',
      })
    })

    expect(updateLastAssistant).toHaveBeenCalledWith('Hello ')
  })

  it('updates waiting status on session.status idle/busy', () => {
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.status', {
        sessionID: 'sess-1',
        status: { type: 'busy' },
      })
    })
    expect(useChatStore.getState().waiting).toBe(true)

    TestRenderer.act(() => {
      notifyHandler!('session.status', {
        sessionID: 'sess-1',
        status: { type: 'idle' },
      })
    })
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('enqueues tool approval on permission.v2.asked', () => {
    const { notifyHandler } = mockClientAndRender()
    const enqueue = jest.spyOn(useToolStore.getState(), 'enqueue')

    TestRenderer.act(() => {
      notifyHandler!('permission.v2.asked', {
        id: 'req-1',
        sessionID: 'sess-1',
        action: 'read',
        resources: ['src/**', 'config.ts'],
      })
    })

    expect(enqueue).toHaveBeenCalledWith({
      id: 'req-1',
      tool: 'read',
      args: { resources: ['src/**', 'config.ts'] },
      sessionId: 'sess-1',
      requestedAt: expect.any(Number),
    })
  })

  it('handles project.changed without optional project field', () => {
    const { notifyHandler } = mockClientAndRender()
    TestRenderer.act(() => {
      notifyHandler!('project.changed', { directory: '/minimal' })
    })
    const state = useProjectStore.getState()
    expect(state.directory).toBe('/minimal')
    expect(state.project).toBeNull()
  })
})

describe('tool progress notification handlers', () => {
  it('adds call on session.next.tool.called', () => {
    const { notifyHandler } = mockClientAndRender()
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.called', {
        callID: 'call-1', sessionID: 'sess-1',
        tool: 'read', input: { path: 'file.ts' },
      })
    })
    const state = useToolProgressStore.getState()
    expect(state.activeCalls).toHaveLength(1)
    expect(state.activeCalls[0].callID).toBe('call-1')
    expect(state.activeCalls[0].tool).toBe('read')
  })

  it('updates progress on session.next.tool.progress', () => {
    const { notifyHandler } = mockClientAndRender()
    useToolProgressStore.getState().addCall({
      callID: 'call-1', sessionID: 'sess-1', tool: 'read', input: {},
    })
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.progress', {
        callID: 'call-1', content: 'reading...',
      })
    })
    const call = useToolProgressStore.getState().activeCalls.find(c => c.callID === 'call-1')
    expect(call?.status).toBe('progress')
    expect(call?.content).toBe('reading...')
  })

  it('marks success on session.next.tool.success', () => {
    const { notifyHandler } = mockClientAndRender()
    useToolProgressStore.getState().addCall({
      callID: 'call-1', sessionID: 'sess-1', tool: 'read', input: {},
    })
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.success', {
        callID: 'call-1', content: 'done', outputPaths: ['/tmp/out'],
      })
    })
    const call = useToolProgressStore.getState().activeCalls.find(c => c.callID === 'call-1')
    expect(call?.status).toBe('success')
    expect(call?.outputPaths).toEqual(['/tmp/out'])
  })

  it('marks failed on session.next.tool.failed', () => {
    const { notifyHandler } = mockClientAndRender()
    useToolProgressStore.getState().addCall({
      callID: 'call-1', sessionID: 'sess-1', tool: 'read', input: {},
    })
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.failed', {
        callID: 'call-1', error: 'permission denied',
      })
    })
    const call = useToolProgressStore.getState().activeCalls.find(c => c.callID === 'call-1')
    expect(call?.status).toBe('failed')
    expect(call?.error).toBe('permission denied')
  })
})

describe('session.diff handler', () => {
  it('sets diffs on session.diff notification', () => {
    const { notifyHandler } = mockClientAndRender()
    const diffs = [{ path: 'file.ts', type: 'modified' }]
    TestRenderer.act(() => {
      notifyHandler('session.diff', { sessionID: 'sess-1', diff: diffs })
    })
    expect(useDiffStore.getState().diffs['sess-1']).toEqual(diffs)
  })
})

describe('todo.updated handler', () => {
  it('sets todos on todo.updated notification', () => {
    const { notifyHandler } = mockClientAndRender()
    const todos = [{ text: 'Add tests' }]
    TestRenderer.act(() => {
      notifyHandler('todo.updated', { sessionID: 'sess-1', todos })
    })
    expect(useTodoStore.getState().todos['sess-1']).toEqual(todos)
  })
})

describe('question.v2.asked handler', () => {
  it('adds question on question.v2.asked notification', () => {
    const { notifyHandler } = mockClientAndRender()
    TestRenderer.act(() => {
      notifyHandler('question.v2.asked', {
        id: 'q-1',
        sessionID: 'sess-1',
        questions: [{
          question: 'Allow?',
          header: 'Permission Required',
          options: [{ label: 'Yes', description: 'Allow' }],
        }],
      })
    })
    const pending = useQuestionStore.getState().pending
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe('q-1')
    expect(pending[0].questions).toHaveLength(1)
    expect(pending[0].questions[0].question).toBe('Allow?')
    expect(pending[0].questions[0].header).toBe('Permission Required')
    expect(pending[0].questions[0].options).toHaveLength(1)
  })
})
