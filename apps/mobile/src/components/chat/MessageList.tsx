import React, { useCallback, useMemo, useRef, useState } from 'react'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ChatMessage } from '../../stores/chatStore'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'
import { buildChatListItems, ChatListItem } from './dateSeparators'
import { useBottomAnchor } from '../../hooks/useBottomAnchor'

export interface MessageListProps {
  /** chatStore 原始正序消息（旧→新），正序 FlatList 直接使用 */
  messages: ChatMessage[]
  renderMessage: (item: ChatMessage) => React.ReactElement
  /** 视觉底部附件（最新消息下方，如 ThinkingShimmer）→ ListFooterComponent */
  thinkingIndicator?: React.ReactElement
  /** 视觉顶部附件（最旧消息上方，如"上滑加载更早"提示）→ ListHeaderComponent */
  historyHint?: React.ReactElement
  hasMoreHistory: boolean
  historyLoading: boolean
  onLoadMoreHistory: () => void
}

/**
 * 正序 FlatList 聊天列表（非 inverted）。
 *
 * - 数据正序（旧→新），最新消息在数组末尾 = 视觉底部
 * - useBottomAnchor 负责贴底跟随：贴底时新内容自动 scrollToEnd
 * - maintainVisibleContentPosition 兜住历史 prepend 时的视口锚定
 * - 上滑加载历史：onScroll 检测到达顶部附近触发
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
  // styles 必须跨渲染稳定：否则 renderItem（useCallback 依赖 styles）每次父级重渲染
  // 都换新引用 → FlatList 认为 renderItem 变了 → 全量 cell 重渲染（VirtualizedList
  // 会打出 "large list that is slow to update" 警告）。
  const styles = useMemo(() => makeStyles(colors), [colors])

  const flatListRef = useRef<FlatList<ChatListItem>>(null)
  const [showBackToBottom, setShowBackToBottom] = useState(false)

  const listData = useMemo(() => buildChatListItems(messages), [messages])

  // ── 底部锚定：贴底时 scrollToEnd 跟随，不贴底不打断 ──
  const { onScroll: anchorOnScroll, scrollToEndIfPinned } = useBottomAnchor(flatListRef)

  // ── 滚动事件：合并锚定检测 + 回底按钮显隐 + 历史加载触发 ──
  const handleScroll = useCallback((e: any) => {
    anchorOnScroll(e)
    const y = e.nativeEvent.contentOffset.y
    // 正序列表：y ≈ 0 在顶部（最旧消息），y 增大向底部（最新消息）
    // 回底按钮：距底部超过阈值时显示
    const { layoutMeasurement, contentSize } = e.nativeEvent
    const distFromBottom = contentSize.height - layoutMeasurement.height - y
    setShowBackToBottom(distFromBottom > 200)
    // 历史加载：到达顶部附近时触发（非 inverted，顶部 = 最旧消息）
    if (hasMoreHistory && !historyLoading && y < 50) {
      onLoadMoreHistory()
    }
  }, [anchorOnScroll, hasMoreHistory, historyLoading, onLoadMoreHistory])

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true })
  }, [])

  // ── 流式更新/新消息到达时，若贴底则自动跟随 ──
  // 两条触发路径缺一不可：
  //   1) listData.length 变化 —— 新增消息（条数变）
  //   2) onContentSizeChange —— 流式文本增长（条数不变、仅内容变高）
  // 去掉 inverted 后不再天然贴底，必须靠 (2) 兜住长回复的流式跟随。
  React.useEffect(() => {
    scrollToEndIfPinned()
  }, [listData.length, scrollToEndIfPinned])

  const handleContentSizeChange = useCallback(() => {
    scrollToEndIfPinned()
  }, [scrollToEndIfPinned])

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
        // 父级必须参与嵌套滚动，否则 cell 内横向 ScrollView（代码块/表格/diff）
        // 的横向拖拽会被本列表吞掉（Android 要求父子都启用 nested scrolling）。
        nestedScrollEnabled
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // 正序：header = 视觉顶部（最旧消息 + 历史提示），footer = 视觉底部（最新消息 + 思考指示）
        ListHeaderComponent={historyHint}
        ListFooterComponent={thinkingIndicator}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
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
