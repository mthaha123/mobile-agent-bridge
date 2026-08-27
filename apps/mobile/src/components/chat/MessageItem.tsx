import React, { memo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { ChatMessage } from '../../stores/chatStore'
import { MessageWrapperForFallback, PartBlock } from './PartBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolGroupCard } from './ToolGroupCard'
import { ThinkingBlock } from './ThinkingBlock'
import { buildSegments } from './segmentParts'
import { useSettingsStore } from '../../stores/settingsStore'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'

export interface MessageItemProps {
  item: ChatMessage
  onRevert: (messageID: string, partID?: string) => void
}

export const MessageItem: React.FC<MessageItemProps> = memo(({ item, onRevert }) => {
  const isUser = item.role === 'user'
  const isSystem = item.role === 'system'
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const chatDisplayMode = useSettingsStore((s) => s.chatDisplayMode)
  // 若 parts 中已含 text part（历史加载的有序文本流），则不重复渲染 content——
  // 否则同一文本会经 content 与 parts.text 渲染两遍。流式消息文本在 content（parts 无 text），仍走 content。
  const hasTextPart = Array.isArray(item.parts) && item.parts.some((p) => p.type === 'text')

  // Grouped mode: build segments, then render ToolGroupCard / ThinkingBlock / PartBlock
  const groupedSegments = chatDisplayMode === 'grouped' && Array.isArray(item.parts) && item.parts.length > 0
    ? buildSegments(item.parts)
    : null

  return (
    <View style={isUser ? styles.userBubble : styles.nonUserBlock}>
      {item.agent ? <Text style={styles.messageMeta}>{item.agent}</Text> : null}
      {item.content && !hasTextPart ? (
        <MessageWrapperForFallback content={item.content} message={item as any} onRevert={onRevert}>
          <MarkdownRenderer content={item.content} />
        </MessageWrapperForFallback>
      ) : null}
      {groupedSegments ? (
        groupedSegments.map((seg, i) => {
          if (seg.type === 'tool-group') {
            const key = `tg-${seg.parts[0]?.id ?? i}`
            return <ToolGroupCard key={key} parts={seg.parts} />
          }
          if (seg.type === 'reasoning') {
            const rp = seg.parts[0]
            const content = rp && rp.type === 'reasoning' ? (rp.data as { content?: string })?.content ?? '' : ''
            const streaming = rp ? !!(rp.data as { streaming?: boolean })?.streaming : false
            return <ThinkingBlock key={`rb-${rp?.id ?? i}`} content={content} streaming={streaming} />
          }
          // text / error / file / compaction — render as PartBlock
          const p = seg.parts[0]
          return <PartBlock key={p?.id ?? `s-${i}`} part={p!} message={item as any} onRevert={onRevert} />
        })
      ) : (
        item.parts?.map((p) => (
          <PartBlock key={p.id} part={p} message={item as any} onRevert={onRevert} />
        ))
      )}
    </View>
  )
})

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    userBubble: {
      maxWidth: '80%',
      backgroundColor: colors.surfaceVariant,
      borderRadius: 12,
      borderBottomRightRadius: 4,
      paddingVertical: 8,
      paddingHorizontal: 14,
      marginVertical: 4,
      alignSelf: 'flex-end',
    },
    nonUserBlock: {
      paddingVertical: 6,
      paddingHorizontal: 4,
      marginVertical: 2,
    },
    messageMeta: {
      color: colors.textTertiary,
      fontSize: 11,
      marginBottom: 4,
    },
  })