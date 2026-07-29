import React, { useState, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Clipboard,
} from 'react-native'

interface MarkdownRendererProps {
  content: string
}

// ─── 纯文本降级渲染器（无第三方依赖） ────────────────────
// 支持: 代码块 ```、行内代码 `、粗体 **、换行

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const blocks = useMemo(() => parseBlocks(content), [content])

  return (
    <View>
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          return <CodeBlock key={i} code={block.content} />
        }
        if (block.type === 'inline') {
          return <InlineCode key={i} code={block.content} />
        }
        return <TextBlock key={i} text={block.content} />
      })}
    </View>
  )
}

// ─── 块解析 ──────────────────────────────────────────────

interface Block {
  type: 'text' | 'code' | 'inline'
  content: string
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  // Split by code blocks ```...```
  const parts = text.split(/(```[\s\S]*?```)/)
  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      blocks.push({ type: 'code', content: part.slice(3, -3).trim() })
    } else {
      // Split by inline code `...`
      const inlineParts = part.split(/(`[^`]+`)/)
      for (const ip of inlineParts) {
        if (ip.startsWith('`') && ip.endsWith('`')) {
          blocks.push({ type: 'inline', content: ip.slice(1, -1) })
        } else if (ip.trim()) {
          blocks.push({ type: 'text', content: ip })
        }
      }
    }
  }
  return blocks
}

// ─── 代码块 ──────────────────────────────────────────────

const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
  const [showAll, setShowAll] = useState(false)
  const lines = code.split('\n')
  const displayLines = showAll ? lines : lines.slice(0, 15)

  return (
    <View style={styles.codeBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.codeHeader}>
            <Text style={styles.codeLang}>code</Text>
            <TouchableOpacity onPress={() => Clipboard.setString(code)}>
              <Text style={styles.copyIcon}>📋</Text>
            </TouchableOpacity>
          </View>
          {displayLines.map((line, i) => (
            <View key={i} style={styles.codeLine}>
              <Text style={styles.lineNum}>{i + 1}</Text>
              <Text style={styles.codeText}>{line || ' '}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      {lines.length > 15 && (
        <TouchableOpacity onPress={() => setShowAll(v => !v)} style={styles.showMore}>
          <Text style={styles.showMoreText}>
            {showAll ? '收起' : `显示全部 ${lines.length} 行`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ─── 行内代码 ────────────────────────────────────────────

const InlineCode: React.FC<{ code: string }> = ({ code }) => (
  <Text style={styles.inlineCode}>{code}</Text>
)

// ─── 文本块 ──────────────────────────────────────────────

const TextBlock: React.FC<{ text: string }> = ({ text }) => {
  // 处理粗体 **text**
  const segments = text.split(/(\*\*[^*]+\*\*)/)
  return (
    <Text style={styles.text}>
      {segments.map((seg, i) => {
        if (seg.startsWith('**') && seg.endsWith('**')) {
          return <Text key={i} style={styles.bold}>{seg.slice(2, -2)}</Text>
        }
        return <Text key={i}>{seg}</Text>
      })}
    </Text>
  )
}

const styles = StyleSheet.create({
  text: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '700',
    color: '#eee',
  },
  inlineCode: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#e06c75',
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  codeBlock: {
    backgroundColor: '#0d1117',
    borderRadius: 8,
    marginVertical: 6,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#1a1a2e',
  },
  codeLang: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  copyIcon: {
    fontSize: 14,
  },
  codeLine: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  lineNum: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
    width: 28,
    textAlign: 'right',
    marginRight: 8,
  },
  codeText: {
    color: '#d4d4d4',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
    flexShrink: 0,
  },
  showMore: {
    paddingVertical: 6,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  showMoreText: {
    color: '#4a9eff',
    fontSize: 12,
  },
})
