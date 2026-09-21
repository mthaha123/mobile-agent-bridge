/**
 * streamDeltaCoalescer — 流式文本增量合并投递单测
 *
 * 覆盖：窗口内合并 / 定时器去重 / flush 立即投递与顺序保证 /
 * discard 丢弃 / flushMs<=0 同步模式 / 方法判定。
 */
import {
  createStreamDeltaCoalescer,
  isStreamDeltaMethod,
  STREAM_DELTA_FLUSH_MS,
} from '../src/services/streamDeltaCoalescer'

describe('createStreamDeltaCoalescer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('窗口内的多条增量合并成一批，按到达顺序投递', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 80)

    c.push('session.next.text.delta', { delta: 'A' })
    c.push('session.next.text.delta', { delta: 'B' })
    c.push('session.next.text.delta', { delta: 'C' })

    // 窗口未到 → 一条都不投递（这正是"每 delta 一次重渲染"被消除的地方）
    expect(sink).not.toHaveBeenCalled()

    jest.advanceTimersByTime(80)

    expect(sink).toHaveBeenCalledTimes(3)
    expect(sink.mock.calls.map((call) => (call[1] as { delta: string }).delta)).toEqual([
      'A',
      'B',
      'C',
    ])
  })

  it('窗口内多次 push 只挂一个定时器（渲染次数与 push 次数解耦）', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 80)

    c.push('session.next.text.delta', { delta: 'A' })
    c.push('session.next.text.delta', { delta: 'B' })
    c.push('session.next.text.delta', { delta: 'C' })

    expect(jest.getTimerCount()).toBe(1)
  })

  it('持续流式期间按窗口周期投递，不累积', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 80)

    c.push('session.next.text.delta', { delta: 'A' })
    jest.advanceTimersByTime(80)
    expect(sink).toHaveBeenCalledTimes(1)

    c.push('session.next.text.delta', { delta: 'B' })
    jest.advanceTimersByTime(80)
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('flush() 立即投递挂起增量，且不重复投递', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 80)

    c.push('session.next.text.delta', { delta: 'A' })
    c.push('session.next.text.delta', { delta: 'B' })
    c.flush()

    expect(sink).toHaveBeenCalledTimes(2)
    expect(jest.getTimerCount()).toBe(0)

    // 原定时器已被清掉 → 再推进时间不得重复投递
    jest.advanceTimersByTime(500)
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('flush() 保证 text.ended 之前所有 delta 已按序落地', () => {
    const delivered: string[] = []
    const c = createStreamDeltaCoalescer((method, payload) => {
      delivered.push(method === 'session.next.text.delta' ? `delta:${(payload as any).delta}` : method)
    }, 80)

    c.push('session.next.text.delta', { delta: 'A' })
    c.push('session.next.text.delta', { delta: 'B' })
    c.flush()
    // 调用方在非增量事件前 flush，然后才投递 text.ended
    delivered.push('session.next.text.ended')

    expect(delivered).toEqual(['delta:A', 'delta:B', 'session.next.text.ended'])
  })

  it('flush() 无挂起内容时不调用 sink', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 80)
    c.flush()
    expect(sink).not.toHaveBeenCalled()
  })

  it('discard() 丢弃挂起增量且不再投递', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 80)

    c.push('session.next.text.delta', { delta: 'A' })
    c.discard()

    jest.advanceTimersByTime(500)
    expect(sink).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('flushMs<=0 时同步投递（无节流模式）', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 0)

    c.push('session.next.text.delta', { delta: 'A' })
    expect(sink).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('默认窗口为 STREAM_DELTA_FLUSH_MS', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink)

    c.push('session.next.text.delta', { delta: 'A' })
    jest.advanceTimersByTime(STREAM_DELTA_FLUSH_MS - 1)
    expect(sink).not.toHaveBeenCalled()
    jest.advanceTimersByTime(1)
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('保留原方法名与 payload（reasoning/tool 增量语义不受影响）', () => {
    const sink = jest.fn()
    const c = createStreamDeltaCoalescer(sink, 0)
    const payload = { sessionID: 's1', assistantMessageID: 'm1', delta: 'x' }

    c.push('session.next.reasoning.delta', payload)
    expect(sink).toHaveBeenCalledWith('session.next.reasoning.delta', payload)
  })
})

describe('isStreamDeltaMethod', () => {
  it('只把文本增量视为高频可合并事件', () => {
    expect(isStreamDeltaMethod('session.next.text.delta')).toBe(true)
    expect(isStreamDeltaMethod('message.part.delta')).toBe(true)
  })

  it('终结/结构化事件不参与合并（必须即时按序处理）', () => {
    for (const m of [
      'session.next.text.ended',
      'session.next.reasoning.delta',
      'session.next.tool.success',
      'session.idle',
      'session.status',
      'question.v2.asked',
    ]) {
      expect(isStreamDeltaMethod(m)).toBe(false)
    }
  })
})
