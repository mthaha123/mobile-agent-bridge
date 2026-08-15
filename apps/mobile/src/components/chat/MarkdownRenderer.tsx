import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useMarkdown } from 'react-native-marked'
import { useThemeColors, useThemeMode } from '../../theme/ThemeContext'

interface MarkdownRendererProps {
  content: string
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const colors = useThemeColors()
  const mode = useThemeMode()

  const theme = {
    colors: {
      code: colors.markdownCodeBg,
      link: colors.markdownLink,
      text: colors.markdownText,
      border: colors.markdownBorder,
    },
    spacing: {},
  }

  let elements
  try {
    elements = useMarkdown(content, { theme: theme as any, colorScheme: mode as any })
  } catch {
    return <Text style={[styles.fallback, { color: colors.markdownText }]}>{content}</Text>
  }

  return <View>{elements}</View>
}

const styles = StyleSheet.create({
  fallback: { fontSize: 14, lineHeight: 22 },
})
