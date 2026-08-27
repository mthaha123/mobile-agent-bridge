import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'

interface ThinkingBlockProps {
  content: string
  streaming?: boolean
}

/**
 * 思考内容折叠块。
 * 折叠态：🧠 思考过程 + 箭头
 * 展开态：MarkdownRenderer 渲染思考文本
 * 默认折叠。
 */
export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content, streaming }) => {
  const [expanded, setExpanded] = useState(false)
  const colors = useThemeColors()
  const styles = makeStyles(colors)

  return (
    <View style={styles.block}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.icon}>🧠</Text>
        <Text style={styles.label} numberOfLines={1}>
          {streaming ? '思考中...' : '思考过程'}
        </Text>
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {expanded && content ? (
        <View style={styles.body}>
          <MarkdownRenderer content={content} />
        </View>
      ) : null}
    </View>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    block: {
      backgroundColor: colors.surface,
      borderRadius: 8,
      marginVertical: 4,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 10,
    },
    icon: { fontSize: 14, marginRight: 8 },
    label: { color: colors.textTertiary, fontSize: 13, flex: 1 },
    chevron: { color: colors.textTertiary, fontSize: 12 },
    body: {
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
      padding: 10,
    },
  })
