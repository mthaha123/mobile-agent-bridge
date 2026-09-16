import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { useBottomAnchor } from '../src/hooks/useBottomAnchor'

function makeScrollEvent(contentOffsetY: number, contentHeight = 800, layoutHeight = 300) {
  return {
    nativeEvent: {
      contentOffset: { y: contentOffsetY },
      layoutMeasurement: { height: layoutHeight },
      contentSize: { height: contentHeight },
    },
  }
}

/** 桥接 hook：将内部 mock ref 和 hook 返回值都暴露出来 */
function createAnchor() {
  const mockScrollToEnd = jest.fn()
  const listRef = { current: { scrollToEnd: mockScrollToEnd } } as any
  const result: { anchor: any } = { anchor: null }

  function HookBridge() {
    result.anchor = useBottomAnchor(listRef)
    return null
  }

  act(() => { TestRenderer.create(<HookBridge />) })
  return { anchor: result.anchor, mockScrollToEnd }
}

describe('useBottomAnchor', () => {
  it('starts pinned to bottom (isAtBottomRef = true)', () => {
    const { anchor } = createAnchor()
    expect(anchor.isAtBottomRef.current).toBe(true)
  })

  it('isAtBottomRef = true when near bottom (distFromBottom ≤ 24)', () => {
    const { anchor } = createAnchor()
    // distFromBottom = 800 - 300 - 476 = 24 → at bottom
    act(() => { anchor.onScroll(makeScrollEvent(476, 800, 300)) })
    expect(anchor.isAtBottomRef.current).toBe(true)
  })

  it('isAtBottomRef = false when far from bottom (distFromBottom > 24)', () => {
    const { anchor } = createAnchor()
    // distFromBottom = 800 - 300 - 200 = 300 > 24
    act(() => { anchor.onScroll(makeScrollEvent(200, 800, 300)) })
    expect(anchor.isAtBottomRef.current).toBe(false)
  })

  it('scrollToEndIfPinned calls scrollToEnd when pinned', () => {
    const { anchor, mockScrollToEnd } = createAnchor()
    act(() => { anchor.scrollToEndIfPinned() })
    expect(mockScrollToEnd).toHaveBeenCalledWith({ animated: false })
  })

  it('scrollToEndIfPinned does NOT call scrollToEnd when not pinned', () => {
    const { anchor, mockScrollToEnd } = createAnchor()
    act(() => { anchor.onScroll(makeScrollEvent(200, 800, 300)) })
    act(() => { anchor.scrollToEndIfPinned() })
    expect(mockScrollToEnd).not.toHaveBeenCalled()
  })
})
