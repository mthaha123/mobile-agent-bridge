import React, { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { getToolInfo } from '../../types/message'
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

/**
 * 工具调用聚合卡片。
 * 折叠态：显示标题栏（🔧 + "工具调用（N 个）" + 状态 + 箭头）
 * 展开态：每个 tool 一行 glance（图标 + 标题 + 副标题）
 * 默认折叠，点击展开。
 */
export const ToolGroupCard: React.FC<ToolGroupCardProps> = ({ parts }) => {
  const [expanded, setExpanded] = useState(false)
  const colors = useThemeColors()
  const styles = makeStyles(colors)

  const { count, statusIcon } = useMemo(() => {
    let success = 0
    let failed = 0
    let running = 0
    for (const p of parts) {
      const d = getToolData(p)
      if (d.status === 'success') success++
      else if (d.status === 'failed') failed++
      else running++ // called / progress
    }
    const total = parts.length
    let icon = '✓'
    if (failed > 0) icon = '✗'
    else if (running > 0) icon = '⏳'
    return { count: total, statusIcon: icon }
  }, [parts])

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.headerIcon}>🔧</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>
          工具调用（{count} 个）
        </Text>
        <Text style={styles.statusText}>{statusIcon}</Text>
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.body}>
          {parts.map((p, i) => {
            const d = getToolData(p)
            const info = getToolInfo(d.tool, d.input)
            const toolStatus = d.status === 'success' ? '✓' : d.status === 'failed' ? '✗' : '⏳'
            return (
              <View key={p.id || i} style={styles.glanceRow}>
                <Text style={styles.glanceIcon}>{info.icon}</Text>
                <Text style={styles.glanceTitle} numberOfLines={1}>{info.title}</Text>
                {info.subtitle ? (
                  <Text style={styles.glanceSubtitle} numberOfLines={1}>{info.subtitle}</Text>
                ) : null}
                <Text style={styles.glanceStatus}>{toolStatus}</Text>
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
  })
