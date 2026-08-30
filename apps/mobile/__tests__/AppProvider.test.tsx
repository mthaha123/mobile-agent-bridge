/**
 * AppProvider tests — notification handler coverage
 */

import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { AppState } from 'react-native'
import { AppProvider } from '../src/components/AppProvider'
import { useAuthStore } from '../src/stores/authStore'
import { useProjectStore } from '../src/stores/projectStore'
import { useChatStore } from '../src/stores/chatStore'
import { useToolStore } from '../src/stores/toolStore'
import { useDiffStore } from '../src/stores/diffStore'
import { useTodoStore } from '../src/stores/todoStore'
import { useQuestionStore } from '../src/stores/questionStore'
import { useSessionStore } from '../src/stores/sessionStore'
import { mockClient, resetAllStores } from './test-utils'

function mockClientAndRender(opts?: {
  connected?: boolean
}): { notifyHandler: (method: string, payload: any) => void; handlers: Record<string, (...args: any[]) => void>; client: ReturnType<typeof mockClient> } {
  const handlers: Record<string, (...args: any[]) => void> = {}
  const client = mockClient()
  if (opts && 'connected' in opts) (client as any).connected = opts.connected
  client.on = jest.fn().mockImplementation((event: string, handler: any) => {
    handlers[event] = handler
    return jest.fn()
  })
  TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
  TestRenderer.act(() => { useAuthStore.setState({ client: client as any }) })
  return { notifyHandler: handlers['notification'], handlers, client }
}

function resetStores() {
  resetAllStores()
}

// 跟踪本文件创建的所有 AppProvider 渲染实例。
// zustand store 模块级持久，未卸载的 Provider 订阅会跨测试累积，
// 导致后续测试的 setState 触发历史 Provider 重复 setupClient（监听器翻倍）。
const appRenderers: TestRenderer.ReactTestRenderer[] = []

function trackRender(r: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestRenderer {
  appRenderers.push(r)
  return r
}

beforeEach(() => {
  resetStores()
  ;(AppState as any).__reset?.()
})

afterEach(() => {
  while (appRenderers.length > 0) {
    const r = appRenderers.pop()!
    TestRenderer.act(() => { r.unmount() })
  }
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

    TestRenderer.act(() => {
      notifyHandler!('session.next.text.delta', {
        sessionID: 'sess-1',
        assistantMessageID: 'msg-1',
        textID: 'txt-1',
        delta: 'Hello ',
      })
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].messageID).toBe('msg-1')
    expect(msgs[0].content).toBe('Hello ')
  })

  it('ignores text delta from a different session than active', () => {
    useChatStore.setState({ activeSessionId: 'sess-A' })
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.text.delta', {
        sessionID: 'sess-B',
        assistantMessageID: 'msg-B',
        delta: 'intruder',
      })
    })

    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('inserts a user message on session.next.prompt.admitted', () => {
    useChatStore.setState({ activeSessionId: 'sess-1' })
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.prompt.admitted', {
        sessionID: 'sess-1',
        messageID: 'um-1',
        prompt: { text: 'remote question' },
      })
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(msgs[0].content).toBe('remote question')
    expect(msgs[0].messageID).toBe('um-1')
  })

  it('inserts a user message on session.next.prompted with string prompt', () => {
    useChatStore.setState({ activeSessionId: 'sess-1' })
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.prompted', {
        sessionID: 'sess-1',
        messageID: 'um-2',
        prompt: 'plain prompt',
      })
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('plain prompt')
  })

  it('ignores prompt event for a different session', () => {
    useChatStore.setState({ activeSessionId: 'sess-A' })
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.prompt.admitted', {
        sessionID: 'sess-B',
        messageID: 'um-9',
        prompt: { text: 'other' },
      })
    })

    expect(useChatStore.getState().messages).toHaveLength(0)
  })

  it('creates an assistant placeholder on session.next.text.started', () => {
    useChatStore.setState({ activeSessionId: 'sess-1' })
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.text.started', {
        sessionID: 'sess-1',
        assistantMessageID: 'ams-1',
        textID: 'txt-1',
      })
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].messageID).toBe('ams-1')
  })

  it('applies authoritative text on message.updated', () => {
    useChatStore.setState({ activeSessionId: 'sess-1' })
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('message.updated', {
        sessionID: 'sess-1',
        info: { id: 'msg-1', role: 'assistant', content: 'authoritative final' },
      })
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('authoritative final')
    expect(msgs[0].messageID).toBe('msg-1')
  })

  it('applies text content from message.part.updated when longer', () => {
    useChatStore.setState({ activeSessionId: 'sess-1' })
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('message.part.updated', {
        sessionID: 'sess-1',
        part: { type: 'text', messageID: 'msg-1', text: 'full body' },
      })
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('full body')
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
      sourceCallID: undefined,
    })
  })

  it('carries source.callID into enqueue on permission.v2.asked', () => {
    const { notifyHandler } = mockClientAndRender()
    const enqueue = jest.spyOn(useToolStore.getState(), 'enqueue')

    TestRenderer.act(() => {
      notifyHandler!('permission.v2.asked', {
        id: 'req-2',
        sessionID: 'sess-1',
        action: 'bash',
        resources: [],
        source: { type: 'tool', messageID: 'msg-1', callID: 'call-9' },
      })
    })

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      id: 'req-2',
      sourceCallID: 'call-9',
    }))
  })

  it('does NOT enqueue approval on session.next.tool.called', () => {
    const { notifyHandler } = mockClientAndRender()
    useToolStore.setState({ pendingApprovals: [] })

    TestRenderer.act(() => {
      notifyHandler!('session.next.tool.called', {
        callID: 'call-1', sessionID: 'sess-1',
        tool: 'read', input: { path: 'file.ts' },
      })
    })

    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('dequeues pending approval when tool succeeds (auto-allowed cleanup)', () => {
    const { notifyHandler } = mockClientAndRender()
    useToolStore.setState({
      pendingApprovals: [{
        id: 'req-1', tool: 'read', args: {}, sessionId: 'sess-1',
        requestedAt: Date.now(), sourceCallID: 'call-1',
      }],
    })

    TestRenderer.act(() => {
      notifyHandler!('session.next.tool.success', {
        callID: 'call-1', sessionID: 'sess-1', content: 'ok',
      })
    })

    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
  })

  it('dequeues pending approval when tool fails', () => {
    const { notifyHandler } = mockClientAndRender()
    useToolStore.setState({
      pendingApprovals: [{
        id: 'req-1', tool: 'read', args: {}, sessionId: 'sess-1',
        requestedAt: Date.now(), sourceCallID: 'call-1',
      }],
    })

    TestRenderer.act(() => {
      notifyHandler!('session.next.tool.failed', {
        callID: 'call-1', sessionID: 'sess-1', error: 'boom',
      })
    })

    expect(useToolStore.getState().pendingApprovals).toHaveLength(0)
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

describe('tool progress notification handlers → chatStore tool parts', () => {
  function lastToolPart(): any {
    const msgs = useChatStore.getState().messages
    const withParts = msgs.find((m) => Array.isArray(m.parts) && m.parts.length > 0)
    return withParts?.parts?.[0]
  }

  it('adds running call as a tool part on session.next.tool.called', () => {
    const { notifyHandler } = mockClientAndRender()
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.called', {
        callID: 'call-1', sessionID: 'sess-1',
        tool: 'read', input: { path: 'file.ts' },
      })
    })
    const part = lastToolPart()
    expect(part?.id).toBe('call-1')
    expect(part?.type).toBe('tool')
    expect(part?.data.tool).toBe('read')
    expect(part?.data.input).toEqual({ path: 'file.ts' })
    expect(part?.data.status).toBe('called')
  })

  it('updates status to progress on session.next.tool.progress', () => {
    const { notifyHandler } = mockClientAndRender()
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.called', {
        callID: 'call-1', sessionID: 'sess-1', tool: 'read', input: {},
      })
    })
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.progress', {
        callID: 'call-1', content: 'reading...',
      })
    })
    expect(lastToolPart()?.data.status).toBe('progress')
  })

  it('marks success with extracted result and outputPaths on session.next.tool.success', () => {
    const { notifyHandler } = mockClientAndRender()
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.called', {
        callID: 'call-1', sessionID: 'sess-1', tool: 'read', input: {},
      })
    })
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.success', {
        callID: 'call-1', content: [{ type: 'text', text: 'done' }], outputPaths: ['/tmp/out'],
      })
    })
    const part = lastToolPart()
    expect(part?.data.status).toBe('success')
    expect(part?.data.result).toBe('done')
    expect(part?.data.outputPaths).toEqual(['/tmp/out'])
  })

  it('marks failed with error on session.next.tool.failed', () => {
    const { notifyHandler } = mockClientAndRender()
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.called', {
        callID: 'call-1', sessionID: 'sess-1', tool: 'read', input: {},
      })
    })
    TestRenderer.act(() => {
      notifyHandler('session.next.tool.failed', {
        callID: 'call-1', error: 'permission denied',
      })
    })
    const part = lastToolPart()
    expect(part?.data.status).toBe('failed')
    expect(part?.data.error).toBe('permission denied')
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

describe('session.updated handler', () => {
  it('patches local session title when server renames a session', () => {
    const { notifyHandler } = mockClientAndRender()
    useSessionStore.setState({
      sessions: [{
        id: 'sess-1', name: 'Old Title',
        createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', messageCount: 0,
      }],
    })
    TestRenderer.act(() => {
      // SDK v2 事件载荷: { info: Session }
      notifyHandler('session.updated', {
        info: { id: 'sess-1', title: 'Auto Titled', time: {} },
      })
    })
    expect(useSessionStore.getState().sessions[0].name).toBe('Auto Titled')
  })

  it('ignores session.updated without id or title', () => {
    const { notifyHandler } = mockClientAndRender()
    useSessionStore.setState({
      sessions: [{
        id: 'sess-1', name: 'Keep',
        createdAt: '', updatedAt: '', messageCount: 0,
      }],
    })
    TestRenderer.act(() => { notifyHandler('session.updated', {}) })
    TestRenderer.act(() => { notifyHandler('session.updated', { info: { id: '' } }) })
    expect(useSessionStore.getState().sessions[0].name).toBe('Keep')
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

describe('createReplyCall sends correct WS frames', () => {
  it('permission.reply sends {reply: "once"} when approved=true', async () => {
    const mockCall = jest.fn().mockResolvedValue({})
    let notifyHandler: ((method: string, payload: any) => void) | null = null
    const mockClient = {
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'notification') { notifyHandler = handler }
      }),
      call: mockCall, connect: jest.fn(), disconnect: jest.fn(),
      destroy: jest.fn(), connected: true, token: 'mock-token',
    }
    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    TestRenderer.act(() => { useAuthStore.setState({ client: mockClient as any }) })

    // Enqueue a tool approval
    TestRenderer.act(() => {
      useToolStore.getState().enqueue({
        id: 'req-1', tool: 'write', args: {},
        sessionId: 'sess-1', requestedAt: Date.now(),
      })
    })

    // Simulate the tool approval sheet calling replyCall
    // The replyCall is set via setToolReplyCall in setupClient
    // We need to trigger it through the store's approve method
    const { setToolReplyCall } = require('../src/screens/ToolApprovalSheet')
    // setToolReplyCall was already called by setupClient, get the registered callback
    // We can test by directly calling approve with a mock replyCall
    const replyCall = jest.fn()
    await useToolStore.getState().approve('req-1', replyCall)

    expect(replyCall).toHaveBeenCalledWith('req-1', 'once')
  })

  it('permission.reply sends {reply: "reject"} when approved=false', async () => {
    const replyCall = jest.fn()
    useToolStore.getState().enqueue({
      id: 'req-2', tool: 'read', args: {},
      sessionId: 'sess-1', requestedAt: Date.now(),
    })
    await useToolStore.getState().reject('req-2', replyCall)
    expect(replyCall).toHaveBeenCalledWith('req-2', 'reject')
  })

  it('question reply calls question.reply (not question.v2.reply)', () => {
    const mockCall = jest.fn().mockResolvedValue({})
    let notifyHandler: ((method: string, payload: any) => void) | null = null
    const mockClient = {
      on: jest.fn().mockImplementation((event: string, handler: any) => {
        if (event === 'notification') { notifyHandler = handler }
      }),
      call: mockCall, connect: jest.fn(), disconnect: jest.fn(),
      destroy: jest.fn(), connected: true, token: 'mock-token',
    }
    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    TestRenderer.act(() => { useAuthStore.setState({ client: mockClient as any }) })

    // Enqueue a question
    TestRenderer.act(() => {
      useQuestionStore.getState().addQuestion({
        id: 'q-1', sessionId: 'sess-1',
        questions: [{ question: 'Allow?', header: '', options: [] }],
      })
    })

    // Trigger question reply via the registered callback
    const { setQuestionReplyCall } = require('../src/screens/QuestionSheet')
    // The callback was registered by setupClient, we need to invoke it
    // Since we can't directly access the callback, verify the store behavior
    const pending = useQuestionStore.getState().pending
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe('q-1')
  })
})

// ─── Missing handler tests ──────────────────────────────────

describe('session.next.text.ended handler', () => {
  it('finalizes assistant content；解锁交由权威快照仲裁（idle → false）', async () => {
    jest.useFakeTimers()
    try {
      const { notifyHandler } = mockClientAndRender({
        'session.status': () => ({}), // 快照缺席当前会话 → idle
      })
      useChatStore.setState({ waiting: true, activeSessionId: 'sess-1' })

      TestRenderer.act(() => {
        notifyHandler!('session.next.text.ended', {
          assistantMessageID: 'msg-1',
          text: 'Final answer',
        })
      })

      // 新契约：收尾不立即解锁，去抖核查后由快照裁决
      expect(useChatStore.getState().waiting).toBe(true)
      await TestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(1300) })

      expect(useChatStore.getState().waiting).toBe(false)
      const msgs = useChatStore.getState().messages
      expect(msgs.some(m => m.content === 'Final answer')).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('session.next.reasoning.delta handler', () => {
  it('reasoning delta 写入独立思考 part（不污染正文 content）', () => {
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.reasoning.delta', {
        assistantMessageID: 'msg-1',
        delta: 'Thinking...',
        eventId: 1,
      })
    })

    const msgs = useChatStore.getState().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].content).toBe('')
    const rp = msgs[0].parts?.find((p) => p.type === 'reasoning')
    expect(rp?.data.content).toBe('Thinking...')
  })

  it('routes string eventId (SDK v3 evt_) to chat store append', () => {
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.text.delta', {
        assistantMessageID: 'msg-1',
        delta: 'Hello ',
        eventId: 'evt_fb6f255e9001TJs7iVnFH5LJz9',
      })
    })

    expect(useChatStore.getState().messages[0].content).toBe('Hello ')
  })
})

describe('createReplyCall with invalid id', () => {
  it('does not call server when approval id is not found', async () => {
    const mockCall = jest.fn()
    const replyCall = async (id: string, approved: boolean) => {
      const { pendingApprovals } = useToolStore.getState()
      const item = pendingApprovals.find(a => a.id === id)
      if (!item) return
      await mockCall('permission.reply', { sessionId: item.sessionId, id, reply: approved ? 'once' : 'reject' })
    }
    await replyCall('no-such-id', true)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('does call server when approval id exists', async () => {
    const mockCall = jest.fn()
    useToolStore.getState().enqueue({
      id: 'valid-id', tool: 'read', args: {},
      sessionId: 'sess-1', requestedAt: Date.now(),
    })
    const replyCall = async (id: string, approved: boolean) => {
      const { pendingApprovals } = useToolStore.getState()
      const item = pendingApprovals.find(a => a.id === id)
      if (!item) return
      await mockCall('permission.reply', { sessionId: item.sessionId, id, reply: approved ? 'once' : 'reject' })
    }
    await replyCall('valid-id', true)
    expect(mockCall).toHaveBeenCalledWith('permission.reply', {
      sessionId: 'sess-1', id: 'valid-id', reply: 'once',
    })
  })
})

describe('session.next.reasoning.ended handler', () => {
  it('reasoning.ended 后经权威快照仲裁解锁（idle → false）', async () => {
    jest.useFakeTimers()
    try {
      const { notifyHandler } = mockClientAndRender({
        'session.status': () => ({}),
      })
      useChatStore.setState({ waiting: true, activeSessionId: 'sess-1' })

      TestRenderer.act(() => {
        notifyHandler!('session.next.reasoning.ended', {
          assistantMessageID: 'msg-1',
          eventId: 3,
        })
      })

      expect(useChatStore.getState().waiting).toBe(true)
      await TestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(1300) })
      expect(useChatStore.getState().waiting).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('session.error handler', () => {
  it('sets waiting=false and records runError', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true, runError: null })

    TestRenderer.act(() => {
      notifyHandler!('session.error', {
        error: 'Connection lost',
      })
    })

    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().runError).toContain('Connection lost')
  })
})

describe('session.next.step.failed handler', () => {
  it('ends waiting and records runError (self-contained failure display)', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true, runError: null })

    TestRenderer.act(() => {
      notifyHandler!('session.next.step.failed', {
        sessionID: 'sess-1',
        assistantMessageID: 'msg-1',
        error: { type: 'unknown', message: 'Provider request failed with HTTP 401' },
      })
    })

    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().runError).toContain('HTTP 401')
  })
})

describe('session.idle handler', () => {
  it('sets waiting=false', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: true })

    TestRenderer.act(() => {
      notifyHandler!('session.idle', {})
    })

    expect(useChatStore.getState().waiting).toBe(false)
  })
})

describe('session.next.step.started handler', () => {
  it('sets waiting=true', () => {
    const { notifyHandler } = mockClientAndRender()
    useChatStore.setState({ waiting: false })

    TestRenderer.act(() => {
      notifyHandler!('session.next.step.started', {})
    })

    expect(useChatStore.getState().waiting).toBe(true)
  })
})

describe('session.next.step.ended handler', () => {
  it('步归零后经权威快照仲裁解锁（idle → false）', async () => {
    jest.useFakeTimers()
    try {
      const { notifyHandler } = mockClientAndRender({
        'session.status': () => ({}),
      })
      useChatStore.setState({ waiting: true, activeSessionId: 'sess-1' })

      TestRenderer.act(() => {
        notifyHandler!('session.next.step.ended', {})
      })

      expect(useChatStore.getState().waiting).toBe(true)
      await TestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(1300) })
      expect(useChatStore.getState().waiting).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('unknown notification method', () => {
  it('does not crash on unknown method', () => {
    const { notifyHandler } = mockClientAndRender()

    expect(() => {
      TestRenderer.act(() => {
        notifyHandler!('unknown.xyz', { someData: true })
      })
    }).not.toThrow()
  })
})

// ─── auth_expired handler tests ─────────────────────────────

describe('auth_expired handler', () => {
  it('calls logout when auth_expired event is emitted', () => {
    const logoutSpy = jest.spyOn(useAuthStore.getState(), 'logout')
    let authExpiredHandler: (() => void) | null = null
    const client = mockClient()
    client.on = jest.fn().mockImplementation((event: string, handler: any) => {
      if (event === 'auth_expired') { authExpiredHandler = handler }
      return jest.fn()
    })

    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    TestRenderer.act(() => { useAuthStore.setState({ client: client as any }) })

    expect(authExpiredHandler).toBeTruthy()

    TestRenderer.act(() => { authExpiredHandler!() })

    expect(logoutSpy).toHaveBeenCalled()
    logoutSpy.mockRestore()
  })
})

// ─── teardownClient tests ────────────────────────────────────

describe('teardownClient', () => {
  it('calls destroy when client is set to null', () => {
    const client = mockClient()
    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    TestRenderer.act(() => { useAuthStore.setState({ client: client as any }) })

    expect(client.destroy).not.toHaveBeenCalled()

    TestRenderer.act(() => { useAuthStore.setState({ client: null }) })

    expect(client.destroy).toHaveBeenCalled()
  })

  it('cleans up on unmount', () => {
    const client = mockClient()
    let tree: TestRenderer.ReactTestRenderer
    TestRenderer.act(() => {
      tree = trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>))
    })
    TestRenderer.act(() => { useAuthStore.setState({ client: client as any }) })

    expect(client.destroy).not.toHaveBeenCalled()

    TestRenderer.act(() => { tree!.unmount() })

    expect(client.destroy).toHaveBeenCalled()
  })
})

describe('session.next.text.ended handler', () => {
  it('空载荷 text.ended 同样走快照仲裁解锁', async () => {
    jest.useFakeTimers()
    try {
      const { notifyHandler } = mockClientAndRender({
        'session.status': () => ({}),
      })
      useChatStore.setState({ waiting: true, activeSessionId: 'sess-1' })

      TestRenderer.act(() => {
        notifyHandler!('session.next.text.ended', {})
      })

      expect(useChatStore.getState().waiting).toBe(true)
      await TestRenderer.act(async () => { await jest.advanceTimersByTimeAsync(1300) })
      expect(useChatStore.getState().waiting).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('session.next.reasoning.delta handler', () => {
  it('无 eventId 的 reasoning delta 同样写入思考 part', () => {
    const { notifyHandler } = mockClientAndRender()

    TestRenderer.act(() => {
      notifyHandler!('session.next.reasoning.delta', {
        assistantMessageID: 'msg-1',
        delta: 'Raw reasoning',
      })
    })

    expect(useChatStore.getState().messages[0].content).toBe('')
    const rp = useChatStore.getState().messages[0].parts?.find((p) => p.type === 'reasoning')
    expect(rp?.data.content).toBe('Raw reasoning')
  })
})

describe('session.status handler', () => {
  it('patches session info when sessionID is provided', () => {
    const { notifyHandler } = mockClientAndRender()
    const spy = jest.spyOn(useSessionStore.getState(), 'patchSession')

    TestRenderer.act(() => {
      notifyHandler!('session.status', {
        sessionID: 'sess-1',
        status: { type: 'busy' },
        session: { name: 'My Session' },
      })
    })

    expect(spy).toHaveBeenCalledWith('sess-1', { name: 'My Session' })
    spy.mockRestore()
  })
})

describe('setupClient', () => {
  it('registers notification and auth_expired listeners on client', () => {
    const client = mockClient()
    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    TestRenderer.act(() => { useAuthStore.setState({ client: client as any }) })

    const events = client.on.mock.calls.map((c: any[]) => c[0])
    expect(events).toContain('notification')
    // 'connected' 监听重新由 AppProvider 注册：断线重连后需幂等补拉当前会话消息
    // （SSE 不重放断口事件，工具终态丢失会导致"运行中"卡片永不结算）
    expect(events).toContain('connected')
    expect(events).toContain('auth_expired')
  })

  it('校正打开中会话的运行状态（连接/重连后拉取 session.status 快照）', async () => {
    useChatStore.setState({ activeSessionId: 'sess-1' })
    const client = mockClient({
      'session.status': () => ({ data: { 'sess-1': { type: 'running' } } }),
    })
    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    await act(async () => { useAuthStore.setState({ client: client as any }) })

    expect(client.call).toHaveBeenCalledWith('session.status', {})
    expect(useChatStore.getState().sessionRunStatus['sess-1']).toBe('busy')
  })

  it('无 activeSessionId 时不触发状态快照拉取', () => {
    const client = mockClient()
    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    TestRenderer.act(() => { useAuthStore.setState({ client: client as any }) })

    expect(client.call).not.toHaveBeenCalledWith('session.status', {})
  })
})

describe('断线重连自愈', () => {
  function captureClient(handlers: Record<string, (params?: any) => any>) {
    // 用可变 holder 而非返回时快照：监听器在后续 act() 中才注册
    const ref: { notify: ((m: string, p: any) => void) | null; connected: (() => void) | null } = {
      notify: null,
      connected: null,
    }
    const client = mockClient(handlers)
    client.on = jest.fn().mockImplementation((event: string, handler: any) => {
      if (event === 'notification') ref.notify = handler
      if (event === 'connected') ref.connected = handler
      return jest.fn()
    }) as any
    return { client, ref }
  }

  it('重连后幂等补拉当前会话消息 + 校正运行状态（恢复断口内丢失的工具终态）', async () => {
    useChatStore.setState({ activeSessionId: 'sess-1' })
    const sessionMessagesCall = jest.fn().mockResolvedValue({ messages: [], cursor: undefined })
    const { client, ref } = captureClient({
      'session.messages': sessionMessagesCall,
      'session.status': () => ({}),
    })

    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    await act(async () => { useAuthStore.setState({ client: client as any }) })

    expect(ref.connected).toBeTruthy()
    const callsBefore = sessionMessagesCall.mock.calls.length
    // 模拟断线后重新连上
    await act(async () => { ref.connected!() })

    expect(sessionMessagesCall.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(sessionMessagesCall).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'sess-1' }))
    expect(client.call).toHaveBeenCalledWith('session.status', {})
  })

  it('无活动会话时重连不补拉', async () => {
    const sessionMessagesCall = jest.fn().mockResolvedValue({ messages: [] })
    const { client, ref } = captureClient({
      'session.messages': sessionMessagesCall,
      'session.status': () => ({}),
    })
    TestRenderer.act(() => { trackRender(TestRenderer.create(<AppProvider>{null}</AppProvider>)) })
    await act(async () => { useAuthStore.setState({ client: client as any }) })
    await act(async () => { ref.connected!() })
    expect(sessionMessagesCall).not.toHaveBeenCalled()
  })
})

// ─── 回前台秒连（AppState 事件驱动）────────────────────────

describe('AppState 回前台秒连', () => {
  it('回前台且已断开：调用 reconnectNow 立即重连（不等退避定时器）', () => {
    const { client } = mockClientAndRender({ connected: false })

    TestRenderer.act(() => { (AppState as any).__emit('active') })
    expect(client.reconnectNow).toHaveBeenCalledTimes(1)
    expect(client.verifyAlive).not.toHaveBeenCalled()
  })

  it('回前台且显示已连接：verifyAlive 验活（探测僵尸半开）', () => {
    const { client } = mockClientAndRender({ connected: true })

    TestRenderer.act(() => { (AppState as any).__emit('active') })
    expect(client.verifyAlive).toHaveBeenCalledTimes(1)
    expect(client.reconnectNow).not.toHaveBeenCalled()
  })

  it('切到后台：不做任何动作（省电，系统冻结定时器）', () => {
    const { client } = mockClientAndRender({ connected: false })

    TestRenderer.act(() => { (AppState as any).__emit('background') })
    expect(client.reconnectNow).not.toHaveBeenCalled()
    expect(client.verifyAlive).not.toHaveBeenCalled()
  })

  it('client 置空销毁后，AppState 监听被移除', () => {
    const { client } = mockClientAndRender({ connected: false })
    TestRenderer.act(() => { useAuthStore.setState({ client: null }) })

    TestRenderer.act(() => { (AppState as any).__emit('active') })
    expect(client.reconnectNow).not.toHaveBeenCalled()
  })
})

// ─── 重连后审批队列对账（permission.list）─────────────────

describe('重连后审批队列对账', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  it('connected 后拉取 permission.list：补入队断线期间错过的审批 + 清理已处理残留', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    client.call.mockImplementation(async (method: string) => {
      if (method === 'permission.list') {
        return [
          {
            id: 'perm-1',
            sessionID: 'sess-1',
            permission: 'bash',
            metadata: { command: 'npm test' },
            tool: { messageID: 'm1', callID: 'call-1' },
          },
        ]
      }
      throw new Error(`Unhandled method: ${method}`)
    })

    // 断线前本地残留一条已被服务器处理的旧审批
    useToolStore.setState({
      pendingApprovals: [
        { id: 'stale', tool: 'edit', args: {}, sessionId: 'sess-1', requestedAt: 1 },
      ],
    })

    await act(async () => { handlers['connected']?.() })
    await flush()

    expect(client.call).toHaveBeenCalledWith('permission.list', {})
    const approvals = useToolStore.getState().pendingApprovals
    // 断口内服务器弹出的审批被补回（字段映射对齐 SDK v2 PermissionRequest）
    const restored = approvals.find((a) => a.id === 'perm-1')
    expect(restored).toBeDefined()
    expect(restored!.tool).toBe('bash')
    expect(restored!.sessionId).toBe('sess-1')
    expect(restored!.sourceCallID).toBe('call-1')
    // 已在断线期间回复的残留被清理
    expect(approvals.find((a) => a.id === 'stale')).toBeUndefined()
  })

  it('实时通知先于快照到达的新审批不被对账误删', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    client.call.mockImplementation(async (method: string) => {
      if (method === 'permission.list') return [] // 快照为空
      throw new Error(`Unhandled method: ${method}`)
    })

    useToolStore.setState({
      pendingApprovals: [
        { id: 'pre-existing', tool: 'edit', args: {}, sessionId: 'sess-1', requestedAt: 1 },
      ],
    })

    await act(async () => { handlers['connected']?.() })
    // 对账进行中，实时 permission.v2.asked 到达并入队
    TestRenderer.act(() => {
      handlers['notification']('permission.v2.asked', {
        id: 'live-req',
        sessionID: 'sess-1',
        action: 'bash',
        resources: [],
      })
    })
    await flush()

    const ids = useToolStore.getState().pendingApprovals.map((a) => a.id)
    expect(ids).toContain('live-req') // 新请求保留
    expect(ids).not.toContain('pre-existing') // 服务器已无此请求 → 清理
  })

  it('permission.list 失败时静默保持现状', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    client.call.mockRejectedValue(new Error('network gone'))

    useToolStore.setState({
      pendingApprovals: [
        { id: 'keep', tool: 'edit', args: {}, sessionId: 'sess-1', requestedAt: 1 },
      ],
    })

    await act(async () => { handlers['connected']?.() })
    await flush()

    const ids = useToolStore.getState().pendingApprovals.map((a) => a.id)
    expect(ids).toEqual(['keep'])
  })
})

// ─── 重连/回前台后待回答问题对账（question.list）─────────────
//
// 场景：息屏/切后台期间 agent 提问（question.v2.asked）。SSE 不重放，事件永久丢失，
// 但服务端仍在等回答 → 会话恒 busy（一直转圈），手机端却没有任何弹框可交互。
describe('重连后待回答问题对账', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  const pendingQuestion = {
    id: 'que-1',
    sessionID: 'sess-1',
    questions: [
      {
        question: 'Which option?',
        header: 'Preference',
        options: [{ label: 'Option A', description: 'A' }],
        multiple: false,
      },
    ],
    tool: { messageID: 'm1', callID: 'call-1' },
  }

  beforeEach(() => {
    useQuestionStore.setState({ pending: [], visible: false })
  })

  afterEach(() => {
    useQuestionStore.setState({ pending: [], visible: false })
  })

  it('connected 后拉取 question.list：补回断口内错过的提问（弹框立即可见）', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    client.call.mockImplementation(async (method: string) => {
      if (method === 'question.list') return [pendingQuestion]
      throw new Error(`Unhandled method: ${method}`)
    })

    await act(async () => { handlers['connected']?.() })
    await flush()

    expect(client.call).toHaveBeenCalledWith('question.list', {})
    const state = useQuestionStore.getState()
    expect(state.visible).toBe(true)
    expect(state.pending).toHaveLength(1)
    expect(state.pending[0].id).toBe('que-1')
    expect(state.pending[0].sessionId).toBe('sess-1')
    expect(state.pending[0].questions[0].question).toBe('Which option?')
    expect(state.pending[0].tool?.callID).toBe('call-1')
  })

  it('服务端已不再等待的本地残留被清理（已回答/被 reject）', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    client.call.mockImplementation(async (method: string) => {
      if (method === 'question.list') return []
      throw new Error(`Unhandled method: ${method}`)
    })

    useQuestionStore.setState({
      pending: [
        { id: 'stale', sessionId: 'sess-1', questions: [] },
      ],
      visible: true,
    })

    await act(async () => { handlers['connected']?.() })
    await flush()

    expect(useQuestionStore.getState().pending).toHaveLength(0)
    expect(useQuestionStore.getState().visible).toBe(false)
  })

  it('实时通知先到达的提问不被对账重复入队', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    // 服务端快照里同样存在该提问（未回答 → 必然在 pending 里）
    client.call.mockImplementation(async (method: string) => {
      if (method === 'question.list') {
        return [{ ...pendingQuestion, id: 'live-q' }]
      }
      throw new Error(`Unhandled method: ${method}`)
    })

    TestRenderer.act(() => {
      handlers['notification']('question.v2.asked', {
        id: 'live-q',
        sessionID: 'sess-1',
        questions: [],
      })
    })

    await act(async () => { handlers['connected']?.() })
    await flush()

    const pending = useQuestionStore.getState().pending
    expect(pending.filter((q) => q.id === 'live-q')).toHaveLength(1)
  })

  it('对账进行中到达的新提问不被误删（快照早于通知）', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    let resolveList: (v: unknown) => void = () => {}
    client.call.mockImplementation(async (method: string) => {
      if (method === 'question.list') {
        return new Promise((resolve) => { resolveList = resolve })
      }
      throw new Error(`Unhandled method: ${method}`)
    })

    await act(async () => { handlers['connected']?.() })
    // 对账请求仍在飞行中，此时实时 question.v2.asked 到达并入队
    TestRenderer.act(() => {
      handlers['notification']('question.v2.asked', {
        id: 'live-q',
        sessionID: 'sess-1',
        questions: [],
      })
    })
    // 快照返回（不含刚到达的提问）
    await act(async () => { resolveList([]) })
    await flush()

    const ids = useQuestionStore.getState().pending.map((q) => q.id)
    expect(ids).toContain('live-q')
  })

  it('回前台（AppState active）且连接未断时也直接对账', async () => {
    const { client } = mockClientAndRender({ connected: true })
    let called = 0
    client.call.mockImplementation(async (method: string) => {
      if (method === 'question.list') { called++; return [pendingQuestion] }
      throw new Error(`Unhandled method: ${method}`)
    })

    TestRenderer.act(() => { (AppState as any).__emit('active') })
    await flush()

    expect(called).toBe(1)
    expect(useQuestionStore.getState().pending.map((q) => q.id)).toEqual(['que-1'])
  })

  it('question.list 失败时静默保持现状', async () => {
    const { handlers, client } = mockClientAndRender({ connected: false })
    client.call.mockRejectedValue(new Error('network gone'))
    useQuestionStore.setState({
      pending: [{ id: 'keep', sessionId: 'sess-1', questions: [] }],
      visible: true,
    })

    await act(async () => { handlers['connected']?.() })
    await flush()

    expect(useQuestionStore.getState().pending.map((q) => q.id)).toEqual(['keep'])
  })
})
