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
  const prevContentHeightRef = useRef<number>(0)
  const lastOffsetYRef = useRef<number>(0)
  const firstMsgIdRef = useRef<string | undefined>(undefined)

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
  // 仅当用户真正钉在底部（pinnedToBottom=true）时才跟随，避免在用户上滑浏览时被强制跳回底部造成抖动
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : undefined
    const prevLast = prevLastRef.current
    if (
      pinnedToBottomRef.current &&
      prevLast &&
      (prevLast.id !== last?.id || prevLast.content !== last?.content)
    ) {
      runFrame(() => {
        // 帧回调中再确认一次 pinned，避免用户在该帧内开始上滑浏览时被强制跳回底部
        if (pinnedToBottomRef.current) {
          flatListRef.current?.scrollToEnd({ animated: false })
        }
      })
    }
    prevLastRef.current = last ?? null
  }, [messages, runFrame])

  // 新会话首帧强制到底：多次 requestAnimationFrame 确保 FlatList 完成布局
  useEffect(() => {
    if (!pendingScrollToEnd) return
    // 第一帧：设置 pinned 状态
    runFrame(() => {
      pinnedToBottomRef.current = true
      // 第二帧：等待布局完成后再 scrollToEnd
      runFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: false })
        onPendingScrollDone()
      })
    })
  }, [pendingScrollToEnd, onPendingScrollDone, runFrame])

  const maybeLoadMoreHistory = useCallback(() => {
    if (hasMoreHistory && !historyLoading) onLoadMoreHistory()
  }, [hasMoreHistory, historyLoading, onLoadMoreHistory])

  const handleScroll = useCallback((e: any) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    const y = contentOffset.y
    lastOffsetYRef.current = y
    pinnedToBottomRef.current = contentSize.height - (y + layoutMeasurement.height) < 60
    if (y < 60) maybeLoadMoreHistory()
  }, [maybeLoadMoreHistory])

  // prepend（加载更早历史）偏移补偿：仅在"第一条消息 id 变化（顶部插入了新历史）"且高度增加时
  // 保持当前视口，避免列表在上滑加载历史时跳动。末尾追加 / 中间消息高度变化不补偿（不扰动用户位置）。
  const handleContentSizeChange = useCallback((_w: number, h: number) => {
    const prev = prevContentHeightRef.current
    prevContentHeightRef.current = h
    if (prev <= 0) return
    // 只对"首条消息变化（prepend）"做补偿：新历史插入顶部，视口下移 diff 要保持用户所见内容不动
    const firstMsg = messages.length > 0 ? messages[0].id : undefined
    const firstChanged = firstMsgIdRef.current !== firstMsg
    if (!firstChanged) return
    firstMsgIdRef.current = firstMsg
    const diff = h - prev
    if (diff <= 0) return
    // 已在底部（pinned）时不补偿，交由末尾跟随 / pendingScrollToEnd 处理
    if (pinnedToBottomRef.current) return
    const newOffset = lastOffsetYRef.current + diff
    flatListRef.current?.scrollToOffset({ offset: newOffset, animated: false })
  }, [messages])

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
      onContentSizeChange={handleContentSizeChange}
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
