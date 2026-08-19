import React, { useCallback, useEffect, useRef } from 'react'
import { FlatList, StyleSheet } from 'react-native'
import type { ChatMessage } from '../../stores/chatStore'
import { computeFollow, computePrependAdjustment, detectPrepend } from '../../stores/scrollLogic'

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

// jest 测试环境（node）无 requestAnimationFrame → 退回 setTimeout，
// 与 jest.setup 里 cancelAnimationFrame→clearTimeout 的 mock 对应。
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
 * - 末尾追加 / 流式追加跟随（pinnedToBottomRef + computeFollow）
 * - 历史 prepend 偏移补偿（detectPrepend + computePrependAdjustment，scrollToOffset 保持视口）
 * - 上滑到顶/onEndReached 触底加载更早历史（hasMoreHistory && !historyLoading 防抖）
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
  // 用户是否停留在最新消息（底部）：false=正在上滑回看历史，不打扰跟随
  const pinnedToBottomRef = useRef(true)
  // onScroll 最近一次 y，供 prepend 补偿取当前视口偏移
  const scrollYRef = useRef(0)
  const prevHeightRef = useRef<number | null>(null)
  const prevLastRef = useRef<ChatMessage | null>(null)
  const prevFirstIdRef = useRef<string | undefined>(undefined)
  // messages effect 判定出 prepend 后，标记给 onContentSizeChange 消费（防止布局回调先于 effect）
  const prependFlagRef = useRef(false)
  const frameIdsRef = useRef<number[]>([])

  const runFrame = useCallback((cb: () => void) => {
    const id = scheduleFrame(cb)
    frameIdsRef.current.push(id)
    return id
  }, [])

  // 卸载时取消未执行的帧回调，避免 onPendingScrollDone 等在卸载后触发
  useEffect(() => {
    return () => {
      frameIdsRef.current.forEach(cancelFrame)
      frameIdsRef.current = []
    }
  }, [])

  // 末尾跟随 + prepend 判定（数据驱动，非 onContentSizeChange 触发）
  useEffect(() => {
    const last = messages.length > 0 ? messages[messages.length - 1] : undefined
    const prevLast = prevLastRef.current
    // prepend 补偿已由 handleContentSizeChange 处理，不再 scrollToEnd（避免抖动）
    if (!prependFlagRef.current && computeFollow(
      pinnedToBottomRef.current,
      prevLast?.id ?? '',
      prevLast?.content ?? '',
      last?.id ?? '',
      last?.content ?? '',
    )) {
      runFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: false })
      })
    }
    if (detectPrepend(
      prevFirstIdRef.current,
      prevLast?.id,
      messages.length > 0 ? messages[0]?.id : undefined,
      last?.id,
    )) {
      prependFlagRef.current = true
    }
    prevLastRef.current = last ?? null
    prevFirstIdRef.current = messages.length > 0 ? messages[0]?.id : undefined
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
    scrollYRef.current = y
    pinnedToBottomRef.current = contentSize.height - (y + layoutMeasurement.height) < 60
    // 上滑到顶（正向列表）加载更早历史
    if (y < 60) maybeLoadMoreHistory()
  }, [maybeLoadMoreHistory])

  const handleContentSizeChange = useCallback((_w: number, newHeight: number) => {
    const firstId = messages.length > 0 ? messages[0]?.id : undefined
    const lastId = messages.length > 0 ? messages[messages.length - 1]?.id : undefined
    const prepended = prependFlagRef.current || detectPrepend(
      prevFirstIdRef.current,
      prevLastRef.current?.id,
      firstId,
      lastId,
    )
    const prevHeight = prevHeightRef.current
    // 该帧发生了历史 prepend → 高度差来自顶部增长 → 滚动补偿保持视口
    if (prepended && prevHeight != null && prevHeight > 0 && newHeight > prevHeight) {
      const target = computePrependAdjustment(
        { prevContentHeight: prevHeight, newContentHeight: newHeight, y: scrollYRef.current },
        true,
      )
      flatListRef.current?.scrollToOffset({ offset: target, animated: false })
    }
    // 非 prepend 帧（流式/尾部/交互高度）不在这里强滚，跟随由 messages effect + pinned 判定负责
    prependFlagRef.current = false
    prevFirstIdRef.current = firstId
    prevHeightRef.current = newHeight
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