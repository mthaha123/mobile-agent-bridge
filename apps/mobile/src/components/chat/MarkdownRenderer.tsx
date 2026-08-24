import React, { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Renderer, useMarkdown } from 'react-native-marked'
import { MarkdownTable } from './MarkdownTable'
import { useThemeColors, useThemeMode } from '../../theme/ThemeContext'

interface MarkdownRendererProps {
  content: string
}

/**
 * 覆写默认 Renderer 的 table()：
 * 内置 MDTable 列宽固定为 43% 屏宽/列且横向滚动在 inverted FlatList +
 * TouchableOpacity 手势协商下经常失效（表格溢出屏幕又滑不动）。
 * 改用 MarkdownTable：自适应列宽 + 可靠横向滚动 + 全屏查看兜底。
 */
class TableAwareRenderer extends Renderer {
  table(header: React.ReactNode[][], rows: React.ReactNode[][][]): React.ReactNode {
    return <MarkdownTable key={this.getKey()} header={header} rows={rows} />
  }
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const colors = useThemeColors()
  const mode = useThemeMode()

  // renderer 实例需跨渲染稳定（useMarkdown 以其为 memo 依赖；slugger 也依赖实例状态）
  const renderer = useMemo(() => new TableAwareRenderer(), [])

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
    elements = useMarkdown(content, {
      theme: theme as any,
      colorScheme: mode as any,
      renderer,
    })
  } catch {
    return <Text style={[styles.fallback, { color: colors.markdownText }]}>{content}</Text>
  }

  return <View>{elements}</View>
}

const styles = StyleSheet.create({
  fallback: { fontSize: 14, lineHeight: 22 },
})
