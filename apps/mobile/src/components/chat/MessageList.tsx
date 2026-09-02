import React, { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ChatMessage } from '../../stores/chatStore'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'
import { buildChatListItems, ChatListItem } from './dateSeparators'

export interface MessageListProps {
  /** chatStore 原始正序消息（旧→新），组件内部负责反转为展示序 */
  messages: ChatMessage[]
  renderMessage: (item: ChatMessage) => React.ReactElement
  /** 视觉底部附件（最新消息下方），如 ThinkingShimmer */
  thinkingIndicator?: React.ReactElement
  /** 视觉顶部附件（最旧消息上方），如"上滑加载更早"提示 */
  historyHint?: React.ReactElement
  hasMoreHistory: boolean
  historyLoading: boolean
  onLoadMoreHistory: () => void
}

/** 距底部超过该像素视为"离开底部"，显示回底按钮 */
const SCROLL_BACK_THRESHOLD = 200

/**
 * inverted FlatList 聊天列表（gifted-chat 标准方案）
 *
 * - 展示数据倒序（最新在 index 0）+ inverted 镜像 → 最新消息天然在视觉底部
 * - 新消息追加到 store 数组末尾 = 展示数组 index 0 → 自动出现在底部，零滚动代码
 * - 流式更新就地改 index 0，offset≈0 时内容自然入视口
 * - 上滑加载历史：append 到展示数组末尾 = 视觉顶部，索引无位移不跳动
 * - maintainVisibleContentPosition 兜住新消息插入时的视口锚定
 */
export const MessageList: React.FC<MessageListProps> = (props) => {
  const {
    messages,
    renderMessage,
    thinkingIndicator,
    historyHint,
    hasMoreHistory,
    historyLoading,
    onLoadMoreHistory,
  } = props

  const colors = useThemeColors()
  const styles = makeStyles(colors)

  const flatListRef = useRef<FlatList<ChatListItem>>(null)
  const [showBackToBottom, setShowBackToBottom] = useState(false)

  const listData = useMemo(() => buildChatListItems(messages), [messages])

  const maybeLoadMoreHistory = useCallback(() => {
    console.log(`[DEBUG onEndReached] hasMore=${hasMoreHistory} loading=${historyLoading}`)
    if (hasMoreHistory && !historyLoading) onLoadMoreHistory()
  }, [hasMoreHistory, historyLoading, onLoadMoreHistory])

  const handleScroll = useCallback((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y
    setShowBackToBottom(y > SCROLL_BACK_THRESHOLD)
  }, [])

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])

  const renderItem = useCallback(
    ({ item }: { item: ChatListItem }) => {
      if (item.kind === 'separator') {
        return (
          <View style={styles.separatorRow}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>{item.label}</Text>
            <View style={styles.separatorLine} />
          </View>
        )
      }
      return renderMessage(item.message)
    },
    [renderMessage, styles],
  )

  const keyExtractor = useCallback((item: ChatListItem) => item.key, [])

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={flatListRef}
        data={listData}
        inverted
        // A/B 验证：临时移除 nestedScrollEnabled，排查 onEndReached 不触发问题
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={thinkingIndicator}
        ListFooterComponent={historyHint}
        onEndReached={maybeLoadMoreHistory}
        onEndReachedThreshold={0.2}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={handleScroll}
        scrollEventThrottle={100}
        style={styles.list}
      />
      {showBackToBottom && (
        <TouchableOpacity
          style={styles.fab}
          onPress={scrollToBottom}
          accessibilityLabel="Scroll to latest"
        >
          <Text style={styles.fabText}>↓</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
    },
    list: {
      flex: 1,
    },
    separatorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    separatorLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    separatorText: {
      color: colors.textTertiary,
      fontSize: 11,
      marginHorizontal: 8,
    },
    fab: {
      position: 'absolute',
      right: 16,
      bottom: 16,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceVariant,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fabText: {
      color: colors.text,
      fontSize: 18,
    },
  })
