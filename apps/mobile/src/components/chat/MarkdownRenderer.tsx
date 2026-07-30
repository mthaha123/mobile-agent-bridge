import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useMarkdown } from 'react-native-marked'

interface MarkdownRendererProps {
  content: string
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  let elements
  try {
    elements = useMarkdown(content)
  } catch {
    return <Text style={styles.fallback}>{content}</Text>
  }

  return <View>{elements}</View>
}

const styles = StyleSheet.create({
  fallback: { color: '#d4d4d4', fontSize: 14, lineHeight: 22 },
})
