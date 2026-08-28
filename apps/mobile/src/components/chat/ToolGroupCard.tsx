import React, { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { getToolInfo } from '../../types/message'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'
import type { Part } from '../../types/message'
import type { ToolPartData } from '../../stores/chatStore'

interface ToolGroupCardProps {
  parts: Part[]
}

function getToolData(p: Part): ToolPartData {
  return p.data as unknown as ToolPartData
}

function getReasoningContent(p: Part): string {
  return (p.data as { content?: string })?.content ?? ''
}

/**
 * 操作块聚合卡片（reasoning + tool 混合）。
 *
 * 折叠态：标题栏显示操作摘要
 *   - 有思考+工具：🧠🔧 操作（思考 + N 个工具）✓/✗/⏳
 *   - 仅工具：🔧 工具调用（N 个）✓/✗/⏳
 *   - 仅思考：🧠 思考过程
 *
 * 展开态：
 *   - 思考部分：可折叠的 Markdown 文本
 *   - 工具部分：每个 tool 一行 glance（图标 + 标题 + 副标题）
 *   - 短文本：直接显示
 *
 * 默认折叠，点击展开。
 */
export const ToolGroupCard: React.FC<ToolGroupCardProps> = ({ parts }) => {
  const [expanded, setExpanded] = useState(false)
  const colors = useThemeColors()
  const styles = makeStyles(colors)

  const { toolParts, reasoningParts, textParts, count, statusIcon } = useMemo(() => {
    const tools: Part[] = []
    const reasoning: Part[] = []
    const texts: Part[] = []
    for (const p of parts) {
      if (p.type === 'tool') tools.push(p)
      else if (p.type === 'reasoning') reasoning.push(p)
      else if (p.type === 'text') texts.push(p)
    }
    // 计算工具状态
    let success = 0
    let failed = 0
    let running = 0
    for (const p of tools) {
      const d = getToolData(p)
      if (d.status === 'success') success++
      else if (d.status === 'failed') failed++
      else running++
    }
    let icon = '✓'
    if (failed > 0) icon = '✗'
    else if (running > 0) icon = '⏳'
    return { toolParts: tools, reasoningParts: reasoning, textParts: texts, count: tools.length, statusIcon: icon }
  }, [parts])

  const hasReasoning = reasoningParts.length > 0
  const hasTools = toolParts.length > 0

  // 标题文本
  let headerLabel = ''
  if (hasReasoning && hasTools) {
    headerLabel = `操作（思考 + ${count} 个工具）`
  } else if (hasTools) {
    headerLabel = `工具调用（${count} 个）`
  } else if (hasReasoning) {
    headerLabel = '思考过程'
  }

  // 图标
  const headerIcon = hasReasoning && hasTools ? '🧠🔧' : hasTools ? '🔧' : '🧠'

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.headerIcon}>{headerIcon}</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {headerLabel}
        </Text>
        {hasTools ? <Text style={styles.statusText}>{statusIcon}</Text> : null}
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.body}>
          {/* 思考部分 */}
          {reasoningParts.map((p, i) => {
            const content = getReasoningContent(p)
            return content ? (
              <View key={p.id || `r-${i}`} style={styles.reasoningBlock}>
                <MarkdownRenderer content={content} />
              </View>
            ) : null
          })}
          {/* 工具部分 */}
          {toolParts.map((p, i) => {
            const d = getToolData(p)
            const info = getToolInfo(d.tool, d.input)
            const toolStatus = d.status === 'success' ? '✓' : d.status === 'failed' ? '✗' : '⏳'
            return (
              <View key={p.id || `t-${i}`} style={styles.glanceRow}>
                <Text style={styles.glanceIcon}>{info.icon}</Text>
                <Text style={styles.glanceTitle} numberOfLines={1}>{info.title}</Text>
                {info.subtitle ? (
                  <Text style={styles.glanceSubtitle} numberOfLines={1}>{info.subtitle}</Text>
                ) : null}
                <Text style={styles.glanceStatus}>{toolStatus}</Text>
              </View>
            )
          })}
          {/* 短文本部分 */}
          {textParts.map((p, i) => {
            const content = (p.data as { content?: string })?.content ?? ''
            return content ? (
              <View key={p.id || `txt-${i}`} style={styles.textBlock}>
                <MarkdownRenderer content={content} />
              </View>
            ) : null
          })}
        </View>
      ) : null}
    </View>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
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
    headerIcon: { fontSize: 14, marginRight: 8 },
    headerTitle: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
    statusText: {
      color: colors.textTertiary,
      fontSize: 13,
      marginRight: 6,
    },
    chevron: { color: colors.textTertiary, fontSize: 12 },
    body: {
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
      paddingVertical: 4,
    },
    reasoningBlock: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceVariant,
    },
    glanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 12,
    },
    glanceIcon: { fontSize: 12, width: 20, textAlign: 'center' },
    glanceTitle: { color: colors.text, fontSize: 12, fontWeight: '500', marginRight: 6 },
    glanceSubtitle: { color: colors.textTertiary, fontSize: 11, flex: 1 },
    glanceStatus: { color: colors.textTertiary, fontSize: 11, marginLeft: 4 },
    textBlock: {
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
  })
