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
 * - followEndRef + onContentSizeChange→scrollToEnd：进入会话/流式时持续跟随绝对底部
 *   （不用 maintainVisibleContentPosition——它与 scrollToEnd 死循环拉扯，是抖动与"停不到底"的根因）
 * - followEndRef 仅在用户松手/惯性结束时计算，程序滚动不污染跟随意图
 * - prepend 历史时（用户上滑加载，follow=false）用 offset 差值补偿保持视口
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
  // 跟随到底意图：仅在用户交互结束（松手/惯性停止）时由数学差值计算；
  // 程序滚动（scrollToEnd）与内容变化（onContentSizeChange 先于 onScroll 的时序）不得污染它，
  // 否则虚拟化补渲染导致 contentSize 增大时 pinned 被误判为 false，无法钉在绝对底部。
  const followEndRef = useRef(true)
  const userTouchRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const prevLastRef = useRef<ChatMessage | null>(null)
  const frameIdsRef = useRef<number[]>([])
  // prepend 视口保持：记录上次内容高度、上次滚动偏移、上次首条消息 id（判断 prepend）
  const prevContentHeightRef = useRef(0)
  const lastOffsetYRef = useRef(0)
  const prevFirstIdRef = useRef<string | undefined>(undefined)
  const initializedRef = useRef(false)
  const sizeChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runFrame = useCallback((cb: () => void) => {
    const id = scheduleFrame(cb)
    frameIdsRef.current.push(id)
    return id
  }, [])

  // 程序滚动统一入口：打标志，让随后（Android 上 scrollTo 会触发的）onMomentumScrollEnd 被识别为程序行为
  const scrollToEndProgrammatic = useCallback(() => {
    programmaticScrollRef.current = true
    flatListRef.current?.scrollToEnd({ animated: false })
  }, [])

  useEffect(() => {
    return () => {
      frameIdsRef.current.forEach(cancelFrame)
      frameIdsRef.current = []
      if (sizeChangeTimerRef.current) clearTimeout(sizeChangeTimerRef.current)
    }
  }, [])

  // 末尾跟随：用户在底部（followEnd）时末尾消息 id/content 变化 → scrollToEnd
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

  // 新会话首帧强制到底：置跟随意图后等待布局（双 rAF）再 scrollToEnd；
  // 剩余的虚拟化补渲染由 onContentSizeChange 持续跟随兜底
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

  // onScroll 仅负责"到顶加载历史"与记录偏移；不在此计算跟随意图（时序敏感，见 followEndRef 注释）
  const handleScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y
    lastOffsetYRef.current = y
    if (y < 60) maybeLoadMoreHistory()
  }, [maybeLoadMoreHistory])

  // 用户交互识别：onScrollBeginDrag 仅由真实用户拖拽触发（程序 scrollToEnd 不触发）
  const handleScrollBeginDrag = useCallback(() => {
    userTouchRef.current = true
    followEndRef.current = false
  }, [])

  const handleUserScrollEnd = useCallback((e: any) => {
    if (programmaticScrollRef.current) {
      programmaticScrollRef.current = false
      return
    }
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    const diff = contentSize.height - (contentOffset.y + layoutMeasurement.height)
    followEndRef.current = diff < 80
    userTouchRef.current = false
  }, [])

  // 内容尺寸变化——按场景分离处理（替代 maintainVisibleContentPosition，避免与 scrollToEnd 死循环拉扯）：
  // 1. 跟随意图在底部（follow=true）：debounce 后 scrollToEnd，避免虚拟化逐项渲染 contentSize 多步增长导致的跳动
  // 2. 已有列表上 prepend 更早历史（首条消息 id 变化，follow=false）：offset 补偿保持视口
  // 3. 其余（流式增量/用户浏览中）：不干预
  const handleContentSizeChange = useCallback((_w: number, h: number) => {
    const prevH = prevContentHeightRef.current
    const diff = h - prevH
    const firstId = messages.length > 0 ? messages[0].id : undefined
    const isPrepend = initializedRef.current && prevFirstIdRef.current !== firstId
    prevContentHeightRef.current = h
    prevFirstIdRef.current = firstId
    if (!initializedRef.current) {
      initializedRef.current = true
      return
    }
    if (followEndRef.current) {
      if (sizeChangeTimerRef.current) clearTimeout(sizeChangeTimerRef.current)
      sizeChangeTimerRef.current = setTimeout(() => {
        sizeChangeTimerRef.current = null
        scrollToEndProgrammatic()
      }, 80)
      return
    }
    if (isPrepend && h > prevH) {
      flatListRef.current?.scrollToOffset({
        offset: lastOffsetYRef.current + (h - prevH),
        animated: false,
      })
    }
  }, [messages, scrollToEndProgrammatic])

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
    flexGrow: 1,
  },
})
