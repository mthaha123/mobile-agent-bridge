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
 * 数据驱动滚动列表：
 * - pendingScrollToEnd：进入会话首帧强制到底（双 rAF）
 * - 末尾跟随 effect：最后一条消息变化时 scrollToEnd（流式/新消息跟随）
 * - onContentSizeChange：仅做 prepend 历史的 offset 补偿（不 scrollToEnd，避免 flexGrow:1 高度振荡死循环）
 * - onScrollBeginDrag / onMomentumScrollEnd：检测用户是否在底部（设置 followEnd）
 * - 不用 maintainVisibleContentPosition（与 scrollToEnd 死循环拉扯）
 * - 不用 flexGrow:1（导致内容容器反复拉伸/收缩，onContentSizeChange 无限振荡）
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
  const followEndRef = useRef(true)
  const isUserScrollRef = useRef(false)
  const prevLastRef = useRef<ChatMessage | null>(null)
  const frameIdsRef = useRef<number[]>([])
  const prevContentHeightRef = useRef(0)
  const lastOffsetYRef = useRef(0)
  const prevFirstIdRef = useRef<string | undefined>(undefined)
  const initializedRef = useRef(false)

  const runFrame = useCallback((cb: () => void) => {
    const id = scheduleFrame(cb)
    frameIdsRef.current.push(id)
    return id
  }, [])

  // 程序滚动：无标志位，不污染 followEnd。由 onContentSizeChange debounce 唯一调用。
  const scrollToEndProgrammatic = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: false })
  }, [])

  useEffect(() => {
    return () => {
      frameIdsRef.current.forEach(cancelFrame)
      frameIdsRef.current = []
      if (sizeChangeTimerRef.current) clearTimeout(sizeChangeTimerRef.current)
    }
  }, [])

  // 新会话首帧强制到底
  useEffect(() => {
    if (!pendingScrollToEnd) return
    followEndRef.current = true
    runFrame(() => {
      runFrame(() => {
        scrollToEndProgrammatic()
        onPendingScrollDone()
      })
    })
  }, [pendingScrollToEnd, onPendingScrollDone, runFrame, scrollToEndProgrammatic])

  const maybeLoadMoreHistory = useCallback(() => {
    if (hasMoreHistory && !historyLoading) onLoadMoreHistory()
  }, [hasMoreHistory, historyLoading, onLoadMoreHistory])

  // 末尾跟随：最后一条消息 id 或 content 变化 → scrollToEnd（流式/新消息时跟随）
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : undefined
    const prevLast = prevLastRef.current
    if (
      followEndRef.current &&
      prevLast &&
      (prevLast.id !== last?.id || prevLast.content !== last?.content)
    ) {
      runFrame(() => {
        if (followEndRef.current) {
          scrollToEndProgrammatic()
        }
      })
    }
    prevLastRef.current = last ?? null
  }, [messages, runFrame, scrollToEndProgrammatic])
  const handleScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y
    lastOffsetYRef.current = y
    if (y < 60) maybeLoadMoreHistory()
  }, [maybeLoadMoreHistory])

  // 用户交互识别：onScrollBeginDrag 仅由真实用户拖拽触发（程序 scrollToEnd 不触发）
  // 用户拖拽开始：标记为用户操作，此时设置 followEnd=false（用户离开底部）
  const handleScrollBeginDrag = useCallback(() => {
    isUserScrollRef.current = true
    followEndRef.current = false
  }, [])

  // 滚动结束：仅处理用户拖拽产生的 momentumEnd，程序滚动产生的直接跳过
  const handleUserScrollEnd = useCallback((e: any) => {
    if (!isUserScrollRef.current) return
    isUserScrollRef.current = false
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    const diff = contentSize.height - (contentOffset.y + layoutMeasurement.height)
    followEndRef.current = diff < 80
  }, [])

  // 内容尺寸变化——仅做 prepend 历史的偏移补偿，不做 scrollToEnd（避免 flexGrow:1 导致的高度振荡死循环）
  const handleContentSizeChange = useCallback((_w: number, h: number) => {
    const prevH = prevContentHeightRef.current
    const firstId = messages.length > 0 ? messages[0].id : undefined
    const isPrepend = initializedRef.current && prevFirstIdRef.current !== firstId
    prevContentHeightRef.current = h
    prevFirstIdRef.current = firstId
    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }
    if (isPrepend && h > prevH) {
      flatListRef.current?.scrollToOffset({
        offset: lastOffsetYRef.current + (h - prevH),
        animated: false,
      })
    }
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
      onScrollEndDragged={handleUserScrollEnd}
      onMomentumScrollEnd={handleUserScrollEnd}
      onScrollBeginDrag={handleScrollBeginDrag}
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
    // 不用 flexGrow:1 —— 它会在内容高度接近 viewport 时导致容器反复拉伸/收缩，
    // 触发 onContentSizeChange 无限振荡，造成页面上下跳动
  },
})
