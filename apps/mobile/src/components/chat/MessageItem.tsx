import React, { memo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { ChatMessage } from '../../stores/chatStore'
import { MessageWrapperForFallback, PartBlock } from './PartBlock'
import { MarkdownRenderer } from './MarkdownRenderer'
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
  return (
    <View style={isUser ? styles.userBubble : styles.nonUserBlock}>
      {item.agent ? <Text style={styles.messageMeta}>{item.agent}</Text> : null}
      {item.content ? (
        <MessageWrapperForFallback content={item.content} message={item as any} onRevert={onRevert}>
          <MarkdownRenderer content={item.content} />
        </MessageWrapperForFallback>
      ) : null}
      {item.parts?.map((p) => (
        <PartBlock key={p.id} part={p} message={item as any} onRevert={onRevert} />
      ))}
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