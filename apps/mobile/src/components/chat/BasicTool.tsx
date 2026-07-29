import React, { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { getToolInfo, getToolRenderer, registerToolRenderer } from '../../types/message'
import { ShellOutput } from './ShellOutput'
import { DiffDisplay } from './DiffDisplay'

// ─── 工具 Part 渲染器 ────────────────────────────────────

export const ToolPart: React.FC<{ data: Record<string, unknown>; messageRole: string }> = ({ data, messageRole }) => {
  const tool = String(data.tool ?? '')
  const info = getToolInfo(tool, (data.input ?? {}) as Record<string, unknown>)
  const [expanded, setExpanded] = useState(false)
  const status = String(data.status ?? '')
  const isUserTool = messageRole === 'user'

  const CustomRenderer = getToolRenderer(tool)
  const StatusIcon = status === 'success' ? '✅' : status === 'failed' ? '❌' : status === 'progress' || status === 'called' ? '⏳' : ''

  const content = useMemo(() => {
    if (CustomRenderer) return <CustomRenderer data={data} />
    const result = data.result
    const error = data.error
    if (error) return <Text style={styles.errorPreview}>Error: {String(error).slice(0, 200)}</Text>
    if (result) return <Text style={styles.resultPreview} numberOfLines={10}>{String(result)}</Text>
    return null
  }, [CustomRenderer, data])

  return (
    <View style={styles.toolCard}>
      <TouchableOpacity
        style={styles.toolTrigger}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.toolIcon}>{info.icon}</Text>
        <View style={styles.toolInfo}>
          <Text style={styles.toolTitle} numberOfLines={1}>{info.title}</Text>
          {info.subtitle ? (
            <Text style={styles.toolSubtitle} numberOfLines={1}>{info.subtitle}</Text>
          ) : null}
        </View>
        {status === 'success' && !isUserTool ? <Text style={styles.statusSuccess}>✓</Text> : null}
        {status === 'failed' ? <Text style={styles.statusError}>✗</Text> : null}
        {(status === 'progress' || status === 'called') && !isUserTool ? (
          <Text style={styles.statusRunning}>⏳</Text>
        ) : null}
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {expanded && content ? (
        <View style={styles.toolBody}>
          {content}
        </View>
      ) : null}
    </View>
  )
}

// ─── 注册内置工具渲染器 ────────────────────────────────────

registerToolRenderer('bash', ({ data }) => (
  <ShellOutput result={data.result} input={data.input as Record<string, unknown>} />
))
registerToolRenderer('shell', ({ data }) => (
  <ShellOutput result={data.result} input={data.input as Record<string, unknown>} />
))
registerToolRenderer('edit', ({ data }) => (
  <DiffDisplay
    oldString={String((data.input as Record<string, unknown>)?.oldString ?? '')}
    newString={String((data.input as Record<string, unknown>)?.newString ?? '')}
  />
))

const styles = StyleSheet.create({
  toolCard: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    overflow: 'hidden',
  },
  toolTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  toolIcon: { fontSize: 16, marginRight: 8, width: 24, textAlign: 'center' },
  toolInfo: { flex: 1, marginRight: 8 },
  toolTitle: { color: '#eee', fontSize: 14, fontWeight: '600' },
  toolSubtitle: { color: '#888', fontSize: 12, marginTop: 1 },
  statusSuccess: { color: '#51cf66', fontSize: 14, marginRight: 6 },
  statusError: { color: '#ff6b6b', fontSize: 14, marginRight: 6 },
  statusRunning: { fontSize: 14, marginRight: 6 },
  chevron: { color: '#666', fontSize: 12 },
  toolBody: {
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
    padding: 10,
  },
  errorPreview: {
    color: '#ff6b6b',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  resultPreview: {
    color: '#d4d4d4',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
})
