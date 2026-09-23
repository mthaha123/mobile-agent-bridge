import { useCallback, useRef } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

/**
 * 普通（非 inverted）FlatList 的聊天底部锚定。
 *
 * - 正序数据：最新消息在数组末尾、视觉底部
 * - 贴底时新内容/流式增长 → scrollToEnd({ animated: false })
 * - 不贴底不打断（用户在看历史）
 * - 历史 prepend 由 maintainVisibleContentPosition 保持视口
 */
export function useBottomAnchor(listRef: React.RefObject<FlatList<any> | null>) {
  const isAtBottomRef = useRef(true)

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent
    const distFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y
    isAtBottomRef.current = distFromBottom <= 24
  }, [])

  const scrollToEndIfPinned = useCallback(() => {
    if (isAtBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: false })
    }
  }, [listRef])

  return { onScroll, scrollToEndIfPinned, isAtBottomRef }
}
