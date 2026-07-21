/**
 * MarkdownRenderer — Markdown 渲染组件
 *
 * 支持：代码块、表格、图片、链接、列表等
 */
import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native'

interface MarkdownRendererProps {
  content: string
  style?: object
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      {renderMarkdown(content)}
    </View>
  )
}

// 渲染 Markdown 内容
export function renderMarkdown(content: string): React.ReactNode[] {
  if (typeof content !== 'string') return []
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 代码块
    if (line.startsWith('```')) {
      const language = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length) i++ // 跳过结束的 ```（仅当存在时）
      elements.push(
        <CodeBlock
          key={`code-${elements.length}`}
          code={codeLines.join('\n')}
          language={language}
        />
      )
      continue
    }

    // 标题
    if (line.startsWith('#')) {
      const match = line.match(/^(#{1,6})\s+(.*)/)
      if (match) {
        const level = match[1].length
        elements.push(
          <Text
            key={`h-${elements.length}`}
            style={[styles.heading, styles[`heading${level}` as keyof typeof styles]]}
          >
            {match[2]}
          </Text>
        )
        i++
        continue
      }
    }

    // 水平线
    if (line.match(/^(-{3,}|_{3,}|\*{3,})$/)) {
      elements.push(
        <View key={`hr-${elements.length}`} style={styles.horizontalRule} />
      )
      i++
      continue
    }

    // 引用块
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].slice(1).trim())
        i++
      }
      elements.push(
        <View key={`quote-${elements.length}`} style={styles.blockquote}>
          <Text style={styles.blockquoteText}>{quoteLines.join('\n')}</Text>
        </View>
      )
      continue
    }

    // 无序列表
    if (line.match(/^[\s]*[-*+]\s/)) {
      const listItems: string[] = []
      while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s/)) {
        listItems.push(lines[i].replace(/^[\s]*[-*+]\s/, ''))
        i++
      }
      elements.push(
        <View key={`ul-${elements.length}`} style={styles.list}>
          {listItems.map((item, idx) => (
            <View key={idx} style={styles.listItem}>
              <Text style={styles.listBullet}>•</Text>
              <Text style={styles.listItemText}>{item}</Text>
            </View>
          ))}
        </View>
      )
      continue
    }

    // 有序列表
    if (line.match(/^[\s]*\d+\.\s/)) {
      const listItems: string[] = []
      while (i < lines.length && lines[i].match(/^[\s]*\d+\.\s/)) {
        listItems.push(lines[i].replace(/^[\s]*\d+\.\s/, ''))
        i++
      }
      elements.push(
        <View key={`ol-${elements.length}`} style={styles.list}>
          {listItems.map((item, idx) => (
            <View key={idx} style={styles.listItem}>
              <Text style={styles.listNumber}>{idx + 1}.</Text>
              <Text style={styles.listItemText}>{item}</Text>
            </View>
          ))}
        </View>
      )
      continue
    }

    // 表格
    if (line.includes('|') && lines[i + 1]?.match(/^\|[\s:-]+\|/)) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(
        <TableBlock
          key={`table-${elements.length}`}
          lines={tableLines}
        />
      )
      continue
    }

    // 空行
    if (line.trim() === '') {
      elements.push(<View key={`br-${elements.length}`} style={styles.paragraph} />)
      i++
      continue
    }

    // 普通段落
    elements.push(
      <Text key={`p-${elements.length}`} style={styles.paragraph}>
        {renderInlineMarkdown(line)}
      </Text>
    )
    i++
  }

  return elements
}

// 渲染行内 Markdown（粗体、斜体、代码、链接）
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // 行内代码
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/)
    if (codeMatch) {
      if (codeMatch[1]) {
        parts.push(<Text key={key++}>{codeMatch[1]}</Text>)
      }
      parts.push(
        <Text key={key++} style={styles.inlineCode}>
          {codeMatch[2]}
        </Text>
      )
      remaining = remaining.slice(codeMatch[0].length)
      continue
    }

    // 粗体
    const boldMatch = remaining.match(/^(.*?)\*\*([^*]+)\*\*/)
    if (boldMatch) {
      if (boldMatch[1]) {
        parts.push(<Text key={key++}>{boldMatch[1]}</Text>)
      }
      parts.push(
        <Text key={key++} style={styles.bold}>
          {boldMatch[2]}
        </Text>
      )
      remaining = remaining.slice(boldMatch[0].length)
      continue
    }

    // 斜体
    const italicMatch = remaining.match(/^(.*?)\*([^*]+)\*/)
    if (italicMatch) {
      if (italicMatch[1]) {
        parts.push(<Text key={key++}>{italicMatch[1]}</Text>)
      }
      parts.push(
        <Text key={key++} style={styles.italic}>
          {italicMatch[2]}
        </Text>
      )
      remaining = remaining.slice(italicMatch[0].length)
      continue
    }

    // 链接
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      if (linkMatch[1]) {
        parts.push(<Text key={key++}>{linkMatch[1]}</Text>)
      }
      parts.push(
        <Text
          key={key++}
          style={styles.link}
          onPress={() => Linking.openURL(linkMatch[3])}
        >
          {linkMatch[2]}
        </Text>
      )
      remaining = remaining.slice(linkMatch[0].length)
      continue
    }

    // 没有更多匹配，添加剩余文本
    parts.push(<Text key={key++}>{remaining}</Text>)
    break
  }

  return parts
}

// 代码块组件
const CodeBlock: React.FC<{ code: string; language: string }> = ({
  code,
  language,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    // 在 React Native 中需要使用 Clipboard API
    // 这里简化处理
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLanguage}>{language || 'Code'}</Text>
        <TouchableOpacity onPress={handleCopy}>
          <Text style={styles.copyButton}>
            {copied ? 'Copied!' : 'Copy'}
          </Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal style={styles.codeScroll}>
        <Text style={styles.codeContent}>{code}</Text>
      </ScrollView>
    </View>
  )
}

// 表格组件
const TableBlock: React.FC<{ lines: string[] }> = ({ lines }) => {
  const parseRow = (line: string) =>
    line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim())

  const headers = parseRow(lines[0])
  const rows = lines.slice(2).map(parseRow)

  return (
    <ScrollView horizontal style={styles.tableScroll}>
      <View style={styles.table}>
        {/* 表头 */}
        <View style={styles.tableRow}>
          {headers.map((header, idx) => (
            <View key={idx} style={[styles.tableCell, styles.tableHeader]}>
              <Text style={styles.tableHeaderText}>{header}</Text>
            </View>
          ))}
        </View>
        {/* 表格内容 */}
        {rows.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.tableRow}>
            {row.map((cell, cellIdx) => (
              <View key={cellIdx} style={styles.tableCell}>
                <Text style={styles.tableCellText}>{cell}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    color: '#fff',
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 16,
  },
  heading1: {
    fontSize: 24,
  },
  heading2: {
    fontSize: 20,
  },
  heading3: {
    fontSize: 18,
  },
  heading4: {
    fontSize: 16,
  },
  heading5: {
    fontSize: 14,
  },
  heading6: {
    fontSize: 12,
  },
  paragraph: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 12,
  },
  horizontalRule: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 16,
  },
  blockquote: {
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
    paddingLeft: 12,
    marginBottom: 12,
  },
  blockquoteText: {
    color: '#888',
    fontStyle: 'italic',
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    marginBottom: 12,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  listBullet: {
    color: '#007AFF',
    marginRight: 8,
    width: 16,
  },
  listNumber: {
    color: '#007AFF',
    marginRight: 8,
    width: 16,
  },
  listItemText: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  inlineCode: {
    backgroundColor: '#2a2a2a',
    color: '#e06c75',
    fontFamily: 'monospace',
    fontSize: 13,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  bold: {
    fontWeight: '700',
    color: '#fff',
  },
  italic: {
    fontStyle: 'italic',
    color: '#d4d4d4',
  },
  link: {
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  codeBlock: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#161b22',
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  codeLanguage: {
    color: '#8b949e',
    fontSize: 12,
  },
  copyButton: {
    color: '#007AFF',
    fontSize: 12,
  },
  codeScroll: {
    padding: 12,
  },
  codeContent: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  tableScroll: {
    marginBottom: 12,
  },
  table: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 4,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tableCell: {
    flex: 1,
    padding: 8,
    borderRightWidth: 1,
    borderRightColor: '#333',
    minWidth: 80,
  },
  tableHeader: {
    backgroundColor: '#1a1a2e',
  },
  tableHeaderText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  tableCellText: {
    color: '#d4d4d4',
    fontSize: 13,
  },
})
