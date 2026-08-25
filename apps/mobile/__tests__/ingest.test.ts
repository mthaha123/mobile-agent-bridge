/**
 * ingest tests — chatStore 新数据模型 + ingest reducer（文本/工具）+ waiting 状态机 + 工具终结态
 */

import { useChatStore, type ToolPartData } from '../src/stores/chatStore'

function resetStore() {
  useChatStore.setState({
    activeSessionId: null,
    messages: [],
    inputText: '',
    waiting: false,
    runError: null,
    pendingSteps: 0,
    lastActivityAt: 0,
    sessionRunStatus: {},
  })
}

beforeEach(() => resetStore())
afterEach(() => resetStore())

function ingest(method: string, payload: any) {
  useChatStore.getState().ingestEvent(method, payload)
}

function parts() {
  return useChatStore.getState().messages.flatMap((m) => m.parts ?? [])
}

function partData(id: string): ToolPartData {
  const p = parts().find((x) => x.id === id)
  if (!p) throw new Error(`part ${id} not found`)
  return p.data as ToolPartData
}

// ---------------------------------------------------------------------------
// 文本流
// ---------------------------------------------------------------------------

describe('text ingest', () => {
  it('text.started → delta → ended 全链路', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    const msgs = () => useChatStore.getState().messages

    ingest('session.next.text.started', { sessionID: 's-1', assistantMessageID: 'ams-1', textID: 'txt-1' })
    expect(msgs()[0]).toMatchObject({ role: 'assistant', messageID: 'ams-1', content: '', status: 'streaming' })

    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'Hel', eventId: 1 })
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'lo', eventId: 2 })
    expect(msgs()[0].content).toBe('Hello')

    ingest('session.next.text.ended', { sessionID: 's-1', assistantMessageID: 'ams-1', text: 'Hello world' })
    expect(msgs()[0].content).toBe('Hello world')
    expect(msgs()[0].status).toBe('complete')
    expect(msgs()[0].lastAppliedDeltaId).toBeUndefined()
    expect(msgs()[0].deltaBuffer).toBeUndefined()
  })

  it('乱序数字 eventId 缓冲重排后按序 flush', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'A', eventId: 0 })
    expect(useChatStore.getState().messages[0].content).toBe('A')
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'C', eventId: 2 })
    expect(useChatStore.getState().messages[0].content).toBe('A')
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'B', eventId: 1 })
    expect(useChatStore.getState().messages[0].content).toBe('ABC')
  })

  it('字符串 eventId（SDK v3 evt_）按到达顺序追加', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'Hello ', eventId: 'evt_a' })
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'world', eventId: 'evt_b' })
    expect(useChatStore.getState().messages[0].content).toBe('Hello world')
  })

  it('message.part.delta（SDK part 增量通道）追加文本', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.text.started', { assistantMessageID: 'ams-1' })
    ingest('message.part.delta', { assistantMessageID: 'ams-1', data: { delta: 'AB', textID: 'x' } })
    expect(useChatStore.getState().messages[0].content).toBe('AB')
  })

  it('text.ended 权威全文覆盖累积（乱序/未拼完）', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'A', eventId: 0 })
    ingest('session.next.text.delta', { sessionID: 's-1', assistantMessageID: 'ams-1', delta: 'C', eventId: 2 })
    expect(useChatStore.getState().messages[0].content).toBe('A')
    ingest('session.next.text.ended', { sessionID: 's-1', assistantMessageID: 'ams-1', text: 'AUTHORITATIVE' })
    expect(useChatStore.getState().messages[0].content).toBe('AUTHORITATIVE')
  })

  it('message.updated 权威全文不短于当前累积才覆盖（防打断流式）', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.text.started', { assistantMessageID: 'ams-1' })
    ingest('session.next.text.delta', { assistantMessageID: 'ams-1', delta: 'partial longer text', eventId: 1 })
    expect(useChatStore.getState().messages[0].content).toBe('partial longer text')
    // 短于当前累积 → 不覆盖
    ingest('message.updated', { sessionID: 's-1', info: { id: 'ams-1', role: 'assistant', content: 'short' } })
    expect(useChatStore.getState().messages[0].content).toBe('partial longer text')
    // 不短于当前累积 → 覆盖为权威全文
    ingest('message.updated', { sessionID: 's-1', info: { id: 'ams-1', role: 'assistant', content: 'partial longer text FULL' } })
    expect(useChatStore.getState().messages[0].content).toBe('partial longer text FULL')
  })

  it('非活动会话事件被忽略', () => {
    useChatStore.setState({ activeSessionId: 's-A' })
    ingest('session.next.text.delta', { sessionID: 's-B', assistantMessageID: 'm1', delta: 'intruder', eventId: 1 })
    expect(useChatStore.getState().messages).toHaveLength(0)
    // 活动会话事件正常处理
    ingest('session.next.text.delta', { sessionID: 's-A', assistantMessageID: 'm1', delta: 'ok', eventId: 1 })
    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0].content).toBe('ok')
  })

  it('无 sessionID 的事件不受会话过滤影响', () => {
    useChatStore.setState({ activeSessionId: 's-A' })
    ingest('session.next.text.delta', { assistantMessageID: 'm1', delta: 'ok', eventId: 1 })
    expect(useChatStore.getState().messages).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 工具流
// ---------------------------------------------------------------------------

describe('tool ingest', () => {
  it('tool.called 建 part（key=callID），归属 assistant 消息', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.text.started', { assistantMessageID: 'ams-1' })
    ingest('session.next.tool.called', {
      sessionID: 's-1', callID: 'call-1', tool: 'read', input: { path: '/a.txt' }, assistantMessageID: 'ams-1',
    })
    const m = useChatStore.getState().messages[0]
    expect(m.parts).toHaveLength(1)
    expect(m.parts![0].id).toBe('call-1')
    expect(m.parts![0].type).toBe('tool')
    expect(partData('call-1')).toMatchObject({ tool: 'read', input: { path: '/a.txt' }, status: 'called' })
  })

  it('input.started → called 只产生一个 part（去重合并）', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.input.started', { sessionID: 's-1', callID: 'call-2', tool: 'bash', input: { command: 'ls' } })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-2', tool: 'bash', input: { command: 'ls' } })
    expect(parts()).toHaveLength(1)
    expect(parts()[0].id).toBe('call-2')
  })

  it('progress 更新为 progress', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'bash', input: {} })
    ingest('session.next.tool.progress', { sessionID: 's-1', callID: 'call-1', content: 'running...' })
    expect(partData('call-1').status).toBe('progress')
  })

  it('success 从 structured 提取 result 并透传 outputPaths', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'read', input: {} })
    ingest('session.next.tool.success', {
      sessionID: 's-1', callID: 'call-1', structured: { ok: true }, outputPaths: ['/tmp/out'],
    })
    expect(partData('call-1').status).toBe('success')
    expect(partData('call-1').result).toBe(JSON.stringify({ ok: true }))
    expect(partData('call-1').outputPaths).toEqual(['/tmp/out'])
  })

  it('success 从 content[] 数组取拼接 text', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'bash', input: {} })
    ingest('session.next.tool.success', {
      sessionID: 's-1', callID: 'call-1', content: [{ type: 'text', text: 'done' }, { type: 'text', text: '!' }],
    })
    expect(partData('call-1').status).toBe('success')
    expect(partData('call-1').result).toBe('done!')
  })

  it('success 从 result 字符串提取', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'bash', input: {} })
    ingest('session.next.tool.success', { sessionID: 's-1', callID: 'call-1', result: 'plain result' })
    expect(partData('call-1').result).toBe('plain result')
  })

  it('failed 更新 status + error', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'read', input: {} })
    ingest('session.next.tool.failed', { sessionID: 's-1', callID: 'call-1', error: 'permission denied' })
    expect(partData('call-1').status).toBe('failed')
    expect(partData('call-1').error).toBe('permission denied')
  })

  it('未知 callID 的工具事件不崩溃', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.success', { sessionID: 's-1', callID: 'ghost', result: 'x' })
    ingest('session.next.tool.failed', { sessionID: 's-1', callID: 'ghost', error: 'x' })
    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// waiting 状态机
// ---------------------------------------------------------------------------

describe('waiting state machine', () => {
  it('step.started 期间 text.ended 后 waiting 仍 true，step.ended 归 false', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.step.started', { sessionID: 's-1' })
    expect(useChatStore.getState().waiting).toBe(true)
    expect(useChatStore.getState().pendingSteps).toBe(1)

    ingest('session.next.text.started', { assistantMessageID: 'ams-1' })
    ingest('session.next.text.ended', { assistantMessageID: 'ams-1', text: 'reply' })
    expect(useChatStore.getState().waiting).toBe(true)
    expect(useChatStore.getState().pendingSteps).toBe(1)

    ingest('session.next.step.ended', { sessionID: 's-1' })
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().pendingSteps).toBe(0)
  })

  it('pendingSteps 不会落到负数', () => {
    ingest('session.next.step.ended', {})
    expect(useChatStore.getState().pendingSteps).toBe(0)
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('text.started（无 step 事件）置 waiting=true，text.ended 归 false', () => {
    ingest('session.next.text.started', { assistantMessageID: 'ams-1' })
    expect(useChatStore.getState().waiting).toBe(true)
    ingest('session.next.text.ended', { assistantMessageID: 'ams-1', text: 'x' })
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('prompt.admitted → waiting=true、清 runError、upsert user 消息', () => {
    useChatStore.setState({ activeSessionId: 's-1', runError: 'old error' })
    ingest('session.next.prompt.admitted', { sessionID: 's-1', messageID: 'um-1', prompt: { text: 'hi' } })
    expect(useChatStore.getState().waiting).toBe(true)
    expect(useChatStore.getState().runError).toBeNull()
    const m = useChatStore.getState().messages[0]
    expect(m).toMatchObject({ role: 'user', content: 'hi', messageID: 'um-1' })
  })

  it('session.status idle 清空 pendingSteps 并 waiting=false', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.step.started', { sessionID: 's-1' })
    expect(useChatStore.getState().waiting).toBe(true)
    ingest('session.status', { sessionID: 's-1', status: { type: 'idle' } })
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().pendingSteps).toBe(0)
  })

  it('session.status busy 权威覆盖：text.ended 后 waiting 仍 true（红方块持续）', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.status', { sessionID: 's-1', status: { type: 'busy' } })
    expect(useChatStore.getState().waiting).toBe(true)
    expect(useChatStore.getState().sessionRunStatus['s-1']).toBe('busy')

    // 无 step 事件的文本流：text.ended 原本会让 waiting=false，
    // 但权威 busy 覆盖后必须保持 true —— 红方块不应闪烁熄灭
    ingest('session.next.text.started', { sessionID: 's-1', assistantMessageID: 'ams-1' })
    ingest('session.next.text.ended', { sessionID: 's-1', assistantMessageID: 'ams-1', text: 'partial' })
    expect(useChatStore.getState().waiting).toBe(true)

    // 工具执行间隙（无任何文本/步骤事件）同样保持
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'bash', input: {} })
    expect(useChatStore.getState().waiting).toBe(true)

    // 服务端广播 idle 后才熄灭
    ingest('session.idle', { sessionID: 's-1' })
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().sessionRunStatus['s-1']).toBe('idle')
  })

  it('session.status retry 视为运行中（waiting=true）', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.status', { sessionID: 's-1', status: { type: 'retry', attempt: 1, message: 'retry', next: 1 } })
    expect(useChatStore.getState().waiting).toBe(true)
    expect(useChatStore.getState().sessionRunStatus['s-1']).toBe('retry')
    ingest('session.status', { sessionID: 's-1', status: { type: 'idle' } })
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('session.status 非 active 会话：只更新全局状态，不影响 waiting', () => {
    useChatStore.setState({ activeSessionId: 's-active' })
    ingest('session.next.step.started', { sessionID: 's-active' })
    expect(useChatStore.getState().waiting).toBe(true)

    ingest('session.status', { sessionID: 's-other', status: { type: 'busy' } })
    // 其它会话 busy → sessionRunStatus 记录，但不驱动当前会话 waiting
    expect(useChatStore.getState().sessionRunStatus['s-other']).toBe('busy')
    expect(useChatStore.getState().sessionRunStatus['s-active']).toBeUndefined()
    expect(useChatStore.getState().waiting).toBe(true)

    ingest('session.status', { sessionID: 's-other', status: { type: 'idle' } })
    expect(useChatStore.getState().sessionRunStatus['s-other']).toBe('idle')
    expect(useChatStore.getState().waiting).toBe(true)
  })

  it('session.idle 非 active 会话：只更新全局状态，不影响 waiting', () => {
    useChatStore.setState({ activeSessionId: 's-active', sessionRunStatus: { 's-other': 'busy' } })
    ingest('session.idle', { sessionID: 's-other' })
    expect(useChatStore.getState().sessionRunStatus['s-other']).toBe('idle')
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('session.error 清掉权威 busy 状态并 waiting=false（红方块不残留）', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.status', { sessionID: 's-1', status: { type: 'busy' } })
    expect(useChatStore.getState().waiting).toBe(true)
    ingest('session.error', { sessionID: 's-1', error: 'Connection lost' })
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().sessionRunStatus['s-1']).toBe('idle')
    expect(useChatStore.getState().runError).toContain('Connection lost')
  })

  it('abortMessage 本地乐观清掉会话运行状态', async () => {
    useChatStore.setState({ activeSessionId: 's-1', sessionRunStatus: { 's-1': 'busy' } })
    const clientCall = jest.fn().mockResolvedValue(undefined)
    await useChatStore.getState().abortMessage('s-1', clientCall)
    expect(useChatStore.getState().sessionRunStatus['s-1']).toBe('idle')
    expect(useChatStore.getState().waiting).toBe(false)
  })

  it('session.error 归零并记录 runError', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.step.started', { sessionID: 's-1' })
    ingest('session.error', { sessionID: 's-1', error: 'Connection lost' })
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().pendingSteps).toBe(0)
    expect(useChatStore.getState().runError).toContain('Connection lost')
  })

  it('setRunError 时强制 waiting=false；空串归一为 null', () => {
    useChatStore.getState().setWaiting(true)
    useChatStore.getState().setRunError('boom')
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().runError).toBe('boom')
    useChatStore.getState().setRunError('')
    expect(useChatStore.getState().runError).toBeNull()
    useChatStore.getState().setRunError(null)
    expect(useChatStore.getState().runError).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 工具终结态
// ---------------------------------------------------------------------------

describe('tool terminal states', () => {
  it('abortMessage → waiting=false + 未终结工具标 cancelled', async () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'bash', input: {} })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-2', tool: 'read', input: {} })
    ingest('session.next.tool.success', { sessionID: 's-1', callID: 'call-2', result: 'ok' })
    const clientCall = jest.fn().mockResolvedValue(undefined)

    await useChatStore.getState().abortMessage('s-1', clientCall)

    expect(clientCall).toHaveBeenCalledWith('message.abort', { sessionId: 's-1' })
    expect(useChatStore.getState().waiting).toBe(false)
    expect(partData('call-1').status).toBe('cancelled')
    expect(partData('call-2').status).toBe('success')
  })

  it('permission.v2.replied reject → 该 callID 工具 part rejected', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'read', input: {} })
    ingest('permission.v2.replied', { sessionID: 's-1', requestID: 'req-1', sourceCallID: 'call-1', reply: 'reject' })
    expect(partData('call-1').status).toBe('rejected')
    expect(partData('call-1').error).toBe('rejected')
  })

  it('permission.v2.replied 非 reject 不改变工具状态', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'read', input: {} })
    ingest('permission.v2.replied', { sessionID: 's-1', requestID: 'req-1', sourceCallID: 'call-1', reply: 'once' })
    expect(partData('call-1').status).toBe('called')
  })

  it('step.failed → 该 assistantMessageID 下未终结工具标 failed', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.text.started', { assistantMessageID: 'ams-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'bash', input: {}, assistantMessageID: 'ams-1' })
    ingest('session.next.step.failed', {
      sessionID: 's-1', assistantMessageID: 'ams-1', error: { type: 'unknown', message: 'Provider request failed with HTTP 401' },
    })
    expect(partData('call-1').status).toBe('failed')
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().pendingSteps).toBe(0)
    expect(useChatStore.getState().runError).toContain('HTTP 401')
  })

  it('markToolsCancelled 只标未终结工具', () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-1', tool: 'bash', input: {} })
    ingest('session.next.tool.called', { sessionID: 's-1', callID: 'call-2', tool: 'read', input: {} })
    ingest('session.next.tool.success', { sessionID: 's-1', callID: 'call-2', result: 'ok' })
    useChatStore.getState().markToolsCancelled()
    expect(partData('call-1').status).toBe('cancelled')
    expect(partData('call-2').status).toBe('success')
  })
})

// ---------------------------------------------------------------------------
// sendMessage / syncSessionMessages
// ---------------------------------------------------------------------------

describe('sendMessage / syncSessionMessages', () => {
  it('sendMessage 乐观插入 user + 调用 message.send', async () => {
    const clientCall = jest.fn().mockResolvedValue({})
    await useChatStore.getState().sendMessage('s-1', 'hello', clientCall)

    expect(clientCall).toHaveBeenCalledWith('message.send', { sessionId: 's-1', message: 'hello' })
    expect(useChatStore.getState().messages[0]).toMatchObject({ role: 'user', content: 'hello' })
    expect(useChatStore.getState().waiting).toBe(true)
    // inputText 由调用方清理，sendMessage 不动它
    expect(useChatStore.getState().inputText).toBe('')
  })

  it('sendMessage 失败 → system 错误消息 + 状态机复位', async () => {
    const clientCall = jest.fn().mockRejectedValue(new Error('connection lost'))
    await useChatStore.getState().sendMessage('s-1', 'hello', clientCall)

    const sys = useChatStore.getState().messages.find((m) => m.role === 'system')
    expect(sys?.content).toContain('发送失败')
    expect(sys?.content).toContain('connection lost')
    expect(useChatStore.getState().waiting).toBe(false)
    expect(useChatStore.getState().pendingSteps).toBe(0)
  })

  it('syncSessionMessages 兼容 {messages, cursor} 响应，反转升序后幂等合入', async () => {
    const raw = [
      { info: { id: 'm2', role: 'assistant', time: { created: 2000 } }, parts: [{ type: 'text', text: 'answer' }] },
      { info: { id: 'm1', role: 'user', time: { created: 1000 } }, parts: [{ type: 'text', text: 'question' }] },
    ]
    const clientCall = jest.fn().mockResolvedValue({ messages: raw, cursor: 'c' })

    await useChatStore.getState().syncSessionMessages('s-1', clientCall)
    // bridge 契约：恒定升序输出、order 参数已废弃不传（服务端忽略）
    expect(clientCall).toHaveBeenCalledWith('session.messages', { sessionId: 's-1', limit: 50 })
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(['question', 'answer'])

    // 幂等：重复同步不产生重复消息
    await useChatStore.getState().syncSessionMessages('s-1', clientCall)
    expect(useChatStore.getState().messages).toHaveLength(2)
  })

  it('syncSessionMessages 兼容裸数组响应', async () => {
    const raw = [
      { id: 'm1', role: 'user', content: 'q', time: { created: 100 } },
      { id: 'm2', role: 'assistant', content: 'a', time: { created: 200 } },
    ]
    const clientCall = jest.fn().mockResolvedValue(raw)

    await useChatStore.getState().syncSessionMessages('s-1', clientCall)
    expect(useChatStore.getState().messages.map((m) => m.content)).toEqual(['q', 'a'])
  })

  it('syncSessionMessages 把 parts 合并进已存在但无 parts 的消息', async () => {
    useChatStore.setState({ activeSessionId: 's-1' })
    useChatStore.getState().applyLoadedMessages([
      { role: 'assistant', messageID: 'm1', content: 'x', timestamp: 100 },
    ])
    const raw = [
      {
        info: { id: 'm1', role: 'assistant', time: { created: 100 } },
        parts: [
          { type: 'tool', id: 'p1', callID: 'c1', tool: 'bash', state: { input: { command: 'ls' }, status: 'completed' } },
          { type: 'text', text: 'x' },
        ],
      },
    ]
    const clientCall = jest.fn().mockResolvedValue(raw)

    await useChatStore.getState().syncSessionMessages('s-1', clientCall)
    expect(useChatStore.getState().messages).toHaveLength(1)
    const toolPart = useChatStore.getState().messages[0].parts?.find((p) => p.type === 'tool')
    expect(toolPart).toBeTruthy()
    expect((toolPart!.data as ToolPartData).tool).toBe('bash')
  })
})