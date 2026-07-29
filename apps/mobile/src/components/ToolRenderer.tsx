/**
 * ToolRenderer — 工具专用渲染器（注册表模式）
 *
 * 通过 registerToolRenderer() 注册工具渲染器，
 * 与 PartBlock + BasicTool 的 TOOL_RENDERERS 注册表互通。
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { ToolCallProgress } from '../stores/toolProgressStore'
import { getToolInfo, getToolRenderer } from '../types/message'
import { ShellOutput } from './chat/ShellOutput'
import { DiffDisplay } from './chat/DiffDisplay'

function str(input: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = input[key]
    if (typeof v === 'string') return v
  }
  return ''
}

function arr(input: Record<string, unknown>, key: string): unknown[] {
  const v = input[key]
  return Array.isArray(v) ? v : []
}

interface ToolRendererProps {
  call: ToolCallProgress
  expanded?: boolean
  onToggle?: () => void
}

export const ToolRenderer: React.FC<ToolRendererProps> = ({
  call,
  expanded = false,
  onToggle,
}) => {
  const tool = call.tool
  const info = getToolInfo(tool, call.input as Record<string, unknown>)
  const CustomRenderer = getToolRenderer(tool)

  const statusIcon = call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'

  return (
    <View style={styles.container}>
      <View style={styles.toolContent}>
        <View style={styles.toolHeader}>
          <Text style={styles.toolIcon}>{info.icon}</Text>
          <Text style={styles.toolName}>{info.title}</Text>
          <Text style={styles.statusIcon}>{statusIcon}</Text>
        </View>
        {info.subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>{info.subtitle}</Text>
        ) : null}

        {tool === 'shell' || tool === 'bash' ? (
          <ShellOutput result={call.result} input={call.input as Record<string, unknown>} />
        ) : tool === 'edit' ? (
          <DiffDisplay
            oldString={str(call.input, 'oldString')}
            newString={str(call.input, 'newString')}
            filePath={str(call.input, 'path', 'file')}
          />
        ) : call.result ? (
          <Text style={styles.resultPreview} numberOfLines={5}>
            {typeof call.result === 'string' ? call.result.slice(0, 500) : JSON.stringify(call.result).slice(0, 500)}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    marginHorizontal: 12,
    marginVertical: 4,
    overflow: 'hidden',
  },
  toolContent: {
    padding: 12,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  toolIcon: { fontSize: 16, marginRight: 8 },
  toolName: { color: '#eee', fontSize: 14, fontWeight: '600', flex: 1 },
  statusIcon: { fontSize: 14 },
  subtitle: { color: '#888', fontSize: 12, marginBottom: 6 },
  resultPreview: {
    color: '#d4d4d4',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
    marginTop: 6,
  },
})
