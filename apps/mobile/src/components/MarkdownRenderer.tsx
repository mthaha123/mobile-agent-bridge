import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

interface MarkdownRendererProps {
  content: string
  style?: object
}

const makeMarkdownStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    body: { color: colors.markdownText, fontSize: 14, lineHeight: 22 },
    heading1: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    heading2: { color: colors.text, fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    heading3: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    heading4: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 6 },
    heading5: { color: colors.text, fontSize: 14, fontWeight: '700', marginTop: 12, marginBottom: 6 },
    heading6: { color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 12, marginBottom: 6 },
    code_inline: { backgroundColor: colors.markdownCodeBg, color: colors.markdownInlineCodeText, fontFamily: 'monospace', fontSize: 13, paddingHorizontal: 4, borderRadius: 3 },
    fence: { backgroundColor: colors.markdownCodeBg, borderRadius: 8, marginBottom: 12, padding: 12 },
    code_block: { backgroundColor: colors.markdownCodeBg, borderRadius: 8, marginBottom: 12, padding: 12 },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.markdownLink, paddingLeft: 12, marginBottom: 12 },
    link: { color: colors.markdownLink, textDecorationLine: 'underline' },
    list_item: { color: colors.markdownText, fontSize: 14, lineHeight: 20 },
    table: { borderWidth: 1, borderColor: colors.markdownBorder, borderRadius: 4, marginBottom: 12 },
    th: { backgroundColor: colors.surfaceVariant, padding: 8, borderRightWidth: 1, borderRightColor: colors.markdownBorder, fontWeight: '600', color: colors.text, fontSize: 13 },
    td: { padding: 8, borderRightWidth: 1, borderRightColor: colors.markdownBorder, color: colors.markdownText, fontSize: 13 },
    hr: { backgroundColor: colors.markdownBorder, height: 1, marginVertical: 16 },
  })

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  style,
}) => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  return <Text style={[styles.plainText, style as any]}>{content}</Text>
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    plainText: { color: colors.markdownText, fontSize: 14, lineHeight: 22 },
  })

export function renderMarkdown(content: string): React.ReactElement {
  return <MarkdownRenderer content={content} />
}
