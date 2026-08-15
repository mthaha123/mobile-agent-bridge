import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useMarkdown } from 'react-native-marked'

interface MarkdownRendererProps {
  content: string
}

// 固定高对比深色主题：不依赖系统 colorScheme，确保在深色背景上清晰可读
const MARKDOWN_THEME = {
  colors: {
    code: '#0d1117',
    link: '#58a6ff',
    text: '#e6edf3',
    border: '#30363d',
  },
  spacing: {},
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  let elements
  try {
    elements = useMarkdown(content, { theme: MARKDOWN_THEME as any, colorScheme: 'dark' as any })
  } catch {
    return <Text style={styles.fallback}>{content}</Text>
  }

  return <View>{elements}</View>
}

const styles = StyleSheet.create({
  fallback: { color: '#e6edf3', fontSize: 14, lineHeight: 22 },
})
