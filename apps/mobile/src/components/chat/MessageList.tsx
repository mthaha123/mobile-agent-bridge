import React, { useCallback, useRef } from 'react'
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
}

/**
 * inverted FlatList 聊天列表（React Native 标准方案）
 *
 * 核心原理：
 * - 数据按时间正序（最早在前，最新在后）
 * - inverted 用 CSS transform:scaleY(-1) 翻转列表，index 0 自然在视觉底部
 * - 新消息追加到数组末尾 → 天然显示在视觉底部
 * - 上滑加载历史 → prepend 到数组开头 → 显示在视觉顶部
 * - maintainVisibleContentPosition 保持 prepend 时的视口位置
 * - 不需要任何 scrollToEnd / offset 补偿 / followEnd 状态管理
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
  } = props

  const flatListRef = useRef<FlatList<ChatMessage>>(null)

  const maybeLoadMoreHistory = useCallback(() => {
    if (hasMoreHistory && !historyLoading) onLoadMoreHistory()
  }, [hasMoreHistory, historyLoading, onLoadMoreHistory])

  return (
    <FlatList
      ref={flatListRef}
      data={messages}
      inverted
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => renderMessage(item)}
      ListHeaderComponent={ListHeader}
      ListFooterComponent={ListFooter}
      onEndReached={maybeLoadMoreHistory}
      onEndReachedThreshold={0.2}
      refreshing={refreshing}
      onRefresh={onRefresh}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      style={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
})
