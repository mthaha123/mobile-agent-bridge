import React, { useCallback, useEffect, useRef } from 'react'
import { FlatList, StyleSheet } from 'react-native'
import type { ChatMessage } from '../../stores/chatStore'

export interface MessageListProps {
  messages: ChatMessage[]
  renderMessage: (item: ChatMessage) => React.ReactElement
  ListHeader?: React.ReactElement
  ListFooter?: React.ReactElement
  hasMoreHistory: boolean
  historyLoading: boolean
  onLoadMoreHistory: () => void
  onRefresh: () => void
  refreshing: boolean
  pendingScrollToEnd: boolean
  onPendingScrollDone: () => void
}

function scheduleFrame(cb: () => void): number {
  const g = globalThis as any
  if (typeof g.requestAnimationFrame === 'function') return g.requestAnimationFrame(cb)
  return setTimeout(cb, 0) as any as number
}

function cancelFrame(id: number): void {
  const g = globalThis as any
  if (typeof g.cancelAnimationFrame === 'function') g.cancelAnimationFrame(id)
  else clearTimeout(id as any)
}

/**
 * 数据驱动滚动列表（标准方案）：
 * - maintainVisibleContentPosition：顶部插入历史时自动保持视口
 * - pinnedToBottomRef + scrollToEnd：流式追加/新消息时跟随到底部
 * - 上滑到顶/onEndReached 加载更早历史
 * - pendingScrollToEnd 首帧强制到底
 * - 下拉刷新（FlatList refreshing/onRefresh）
 */
export const MessageList: React.FC<MessageListProps> = (props) => {
  const {
    messages,
    renderMessage,
    ListHeader,
    ListFooter,
    hasMoreHistory,
    historyLoading,
    onLoadMoreHistory,
    onRefresh,
    refreshing,
    pendingScrollToEnd,
    onPendingScrollDone,
  } = props

  const flatListRef = useRef<FlatList<ChatMessage>>(null)
  const pinnedToBottomRef = useRef(true)
  const prevLastRef = useRef<ChatMessage | null>(null)
  const frameIdsRef = useRef<number[]>([])

  const runFrame = useCallback((cb: () => void) => {
    const id = scheduleFrame(cb)
    frameIdsRef.current.push(id)
    return id
  }, [])

  useEffect(() => {
    return () => {
      frameIdsRef.current.forEach(cancelFrame)
      frameIdsRef.current = []
    }
  }, [])

  // 末尾跟随：pinned 时末尾消息 id/content 变化 → scrollToEnd
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : undefined
    const prevLast = prevLastRef.current
    if (
      pinnedToBottomRef.current &&
      prevLast &&
      (prevLast.id !== last?.id || prevLast.content !== last?.content)
    ) {
      runFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: false })
      })
    }
    prevLastRef.current = last ?? null
  }, [messages, runFrame])

  // 新会话首帧强制到底
  useEffect(() => {
    if (!pendingScrollToEnd) return
    runFrame(() => {
      pinnedToBottomRef.current = true
      flatListRef.current?.scrollToEnd({ animated: false })
      onPendingScrollDone()
    })
  }, [pendingScrollToEnd, onPendingScrollDone, runFrame])

  const maybeLoadMoreHistory = useCallback(() => {
    if (hasMoreHistory && !historyLoading) onLoadMoreHistory()
  }, [hasMoreHistory, historyLoading, onLoadMoreHistory])

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    const y = contentOffset.y
    pinnedToBottomRef.current = contentSize.height - (y + layoutMeasurement.height) < 60
    if (y < 60) maybeLoadMoreHistory()
  }, [maybeLoadMoreHistory])

  return (
    <FlatList
      ref={flatListRef}
      data={messages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => renderMessage(item)}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onEndReached={maybeLoadMoreHistory}
      onEndReachedThreshold={0.2}
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={styles.listContent}
      style={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    flexGrow: 1,
  },
})
