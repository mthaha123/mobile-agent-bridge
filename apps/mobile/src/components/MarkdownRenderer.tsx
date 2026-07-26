import React from 'react'
import { StyleSheet, View, Text } from 'react-native'
import Markdown from 'react-native-markdown-display'

interface MarkdownRendererProps {
  content: string
  style?: object
}

const markdownStyles = StyleSheet.create({
  body: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 22,
  },
  heading1: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  heading2: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  heading3: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  heading4: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  heading5: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  heading6: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 6,
  },
  code_inline: {
    backgroundColor: '#2a2a2a',
    color: '#e06c75',
    fontFamily: 'monospace',
    fontSize: 13,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  fence: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    marginBottom: 12,
    padding: 12,
  },
  code_block: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    marginBottom: 12,
    padding: 12,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
    paddingLeft: 12,
    marginBottom: 12,
  },
  link: {
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  list_item: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 20,
  },
  table: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 4,
    marginBottom: 12,
  },
  th: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: '#333',
    fontWeight: '600',
    color: '#fff',
    fontSize: 13,
  },
  td: {
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: '#333',
    color: '#d4d4d4',
    fontSize: 13,
  },
  hr: {
    backgroundColor: '#333',
    height: 1,
    marginVertical: 16,
  },
})

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  style,
}) => {
  return (
    <Markdown style={{ ...markdownStyles, ...(style as any) }}>
      {content}
    </Markdown>
  )
}

export function renderMarkdown(content: string): React.ReactElement {
  return <MarkdownRenderer content={content} />
}
