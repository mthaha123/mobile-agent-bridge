/**
 * 流式文本增量合并器（transport 层）
 *
 * 问题：SDK 每秒可推送数百条 `session.next.text.delta`。若每条都直接写入
 * chatStore，每条都会触发一次整棵消息树重渲染 —— 流式 markdown 全文重新
 * lex+parse 并整树重挂载。实测（Android 模拟器 / 30k 字符长回复）：
 *   99.66% 掉帧、主线程单次阻塞 30s（Choreographer "Skipped 1857 frames"）、
 *   应用 CPU 171% —— 用户可见症状是「流式期间点击无响应，只能滚动」。
 *
 * 方案：把增量在 transport 层入队，按 `flushMs` 合并成一次批量投递。
 * 渲染次数从「每 delta 一次」降到「每 flushMs 一次」（80ms ≈ 12.5 次/秒，
 * 约 16 倍削减）。事件顺序语义不变：出队后仍按到达顺序逐条投递给 sink。
 *
 * 为什么放在 transport 层而不是 chatStore 内部：`chatStore.ingestEvent` 保持
 * 同步纯 reducer 语义（单测无需处理定时器），合并只影响「投递频率」这一个
 * 关注点，且可独立单测。
 */

/** 合并窗口：80ms ≈ 12.5 次渲染/秒（视觉上仍是流畅的逐字出现） */
export const STREAM_DELTA_FLUSH_MS = 80

/**
 * 需要合并投递的高频流式事件。
 * 文本增量是唯一可能达到每秒数百条的事件（reasoning/tool 增量频率低得多，
 * 且它们的重渲染成本远低于 markdown 全文解析）。
 */
export function isStreamDeltaMethod(method: string): boolean {
  return method === 'session.next.text.delta' || method === 'message.part.delta'
}

export interface StreamDeltaCoalescer {
  /** 入队一条流式增量；按 flushMs 合并投递（flushMs<=0 时同步投递） */
  push(method: string, payload: unknown): void
  /**
   * 立即投递挂起增量。
   * ⚠️ 非增量事件到达前必须调用：`session.next.text.ended` 会用权威全文覆盖
   * content，若此时仍有挂起 delta，覆盖后补写会污染正文。
   */
  flush(): void
  /** 丢弃挂起增量（断开连接 / 会话切换） */
  discard(): void
}

export function createStreamDeltaCoalescer(
  sink: (method: string, payload: unknown) => void,
  flushMs: number = STREAM_DELTA_FLUSH_MS,
): StreamDeltaCoalescer {
  let queue: Array<{ method: string; payload: unknown }> = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flush = () => {
    clearTimer()
    if (queue.length === 0) return
    const batch = queue
    queue = []
    // 按到达顺序逐条投递：乱序 eventId 的缓冲/去重语义仍由 store 负责
    for (const item of batch) sink(item.method, item.payload)
  }

  const push = (method: string, payload: unknown) => {
    queue.push({ method, payload })
    if (flushMs <= 0) {
      flush()
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, flushMs)
  }

  return {
    push,
    flush,
    discard: () => {
      clearTimer()
      queue = []
    },
  }
}
