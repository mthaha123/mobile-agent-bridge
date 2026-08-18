import { computeFollow, computePrependAdjustment, detectPrepend } from '../src/stores/scrollLogic'

describe('computeFollow', () => {
  it('computes follow=on when pinned and last message id/content changes', () => {
    expect(computeFollow(true, 'm1', 'Hello', 'm2', 'World')).toBe(true)
    expect(computeFollow(true, 'm1', 'Hello', 'm1', 'Hello!')).toBe(true)
    expect(computeFollow(false, 'm1', 'Hello', 'm2', 'World')).toBe(false)  // 用户上滑不跟
    expect(computeFollow(true, 'm1', 'Hello', 'm1', 'Hello')).toBe(false)   // 无变化不跟
  })

  it('never follows when not pinned even if id/content changed', () => {
    expect(computeFollow(false, 'm1', 'a', 'm2', 'b')).toBe(false)
    expect(computeFollow(false, 'm1', 'a', 'm1', 'a')).toBe(false)
  })
})

describe('computePrependAdjustment', () => {
  it('adjusts offset upward when content prepended (header grew)', () => {
    // prev height 大 diff：diff 来自 header/顶部增长 → offset += diff
    expect(computePrependAdjustment({ prevContentHeight: 1000, newContentHeight: 1200, y: 500 }, true)).toBe(700)
  })

  it('keeps offset unchanged when nothing was prepended', () => {
    expect(computePrependAdjustment({ prevContentHeight: 1000, newContentHeight: 1200, y: 500 }, false)).toBe(500)
  })

  it('uses the raw height diff, not a fixed amount', () => {
    expect(computePrependAdjustment({ prevContentHeight: 800, newContentHeight: 1100, y: 300 }, true)).toBe(600)
  })
})

describe('detectPrepend', () => {
  it('detects prepend when head changed but tail stayed', () => {
    expect(detectPrepend('m1', 'm9', 'm0', 'm9')).toBe(true)
  })

  it('does not flag plain append (head stays, tail moves)', () => {
    expect(detectPrepend('m1', 'm9', 'm1', 'm10')).toBe(false)
  })

  it('does not flag initial load (no previous tail)', () => {
    expect(detectPrepend(undefined, undefined, 'm1', 'm50')).toBe(false)
    expect(detectPrepend('', '', 'm1', 'm50')).toBe(false)
  })

  it('does not flag empty -> empty', () => {
    expect(detectPrepend(undefined, undefined, undefined, undefined)).toBe(false)
  })

  it('does not flag head change that also replaced the tail (session reset)', () => {
    expect(detectPrepend('m1', 'm9', 'p1', 'p9')).toBe(false)
  })
})