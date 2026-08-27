/**
 * @deprecated Use ToolGroupCard + buildSegments for grouped chat display.
 * This component is retained for backward compatibility with flat mode's
 * "Read 2 files" style inline group. New code should use ToolGroupCard.
 */
import React, { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { getToolInfo } from '../../types/message'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'

const CONTEXT_TOOLS = new Set(['read', 'glob', 'grep', 'list'])

export function isContextTool(tool: string): boolean {
  return CONTEXT_TOOLS.has(tool)
}

export function groupContextTools(parts: Array<{ tool?: string; data?: Record<string, unknown> }>) {
  const context: typeof parts = []
  const others: typeof parts = []
  for (const p of parts) {
    if (p.tool && CONTEXT_TOOLS.has(p.tool)) {
      context.push(p)
    } else {
      others.push(p)
    }
  }
  return { context, others }
}

interface ContextToolGroupProps {
  tools: Array<{ tool?: string; data?: Record<string, unknown> }>
}

export const ContextToolGroup: React.FC<ContextToolGroupProps> = ({ tools }) => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [expanded, setExpanded] = useState(false)

  const summary = useMemo(() => {
    const files = tools.filter(t => ['read', 'list'].includes(t.tool ?? '')).length
    const searches = tools.filter(t => ['glob', 'grep'].includes(t.tool ?? '')).length
    const parts: string[] = []
    if (files > 0) parts.push(`${files} 个文件`)
    if (searches > 0) parts.push(`${searches} 次搜索`)
    return `已收集上下文：${parts.join('，')}`
  }, [tools])

  if (tools.length === 0) return null

  return (
    <View style={styles.groupCard}>
      <TouchableOpacity
        style={styles.groupHeader}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.groupIcon}>📂</Text>
        <Text style={styles.groupTitle} numberOfLines={1}>{summary}</Text>
        <Text style={styles.groupCount}>{tools.length}</Text>
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.groupBody}>
          {tools.map((tool, i) => {
            const info = getToolInfo(tool.tool ?? '', (tool.data as Record<string, unknown>) ?? {})
            return (
              <View key={i} style={styles.groupItem}>
                <Text style={styles.itemIcon}>{info.icon}</Text>
                <Text style={styles.itemTitle} numberOfLines={1}>{info.title}</Text>
                {info.subtitle ? (
                  <Text style={styles.itemSubtitle} numberOfLines={1}>{info.subtitle}</Text>
                ) : null}
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginVertical: 4,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  groupIcon: { fontSize: 16, marginRight: 8 },
  groupTitle: { color: colors.text, fontSize: 13, fontWeight: '500', flex: 1 },
  groupCount: {
    color: colors.textTertiary,
    fontSize: 12,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 6,
    overflow: 'hidden',
  },
  chevron: { color: colors.textTertiary, fontSize: 12 },
  groupBody: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    paddingVertical: 4,
  },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  itemIcon: { fontSize: 14, width: 22, textAlign: 'center' },
  itemTitle: { color: colors.text, fontSize: 13, fontWeight: '500', marginRight: 8 },
  itemSubtitle: { color: colors.textTertiary, fontSize: 12, flex: 1 },
})
