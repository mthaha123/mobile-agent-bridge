/**
 * ToolRenderer — 工具专用渲染器
 *
 * 根据工具类型渲染不同的UI：
 * - Shell: 命令+输出折叠+状态
 * - Read/Write/Edit: 文件路径+diff预览
 * - Glob/Grep: 搜索模式+结果列表
 * - WebFetch/WebSearch: URL+摘要
 * - Task/Question/Skill/TodoWrite: 专用渲染器
 */
import React, { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { ToolCallProgress } from '../stores/toolProgressStore'

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
  const renderContent = () => {
    switch (call.tool) {
      case 'bash':
      case 'shell':
        return <ShellRenderer call={call} />
      case 'read':
        return <ReadRenderer call={call} />
      case 'write':
        return <WriteRenderer call={call} />
      case 'edit':
        return <EditRenderer call={call} />
      case 'glob':
        return <GlobRenderer call={call} />
      case 'grep':
        return <GrepRenderer call={call} />
      case 'webfetch':
        return <WebFetchRenderer call={call} />
      case 'websearch':
        return <WebSearchRenderer call={call} />
      case 'task':
        return <TaskRenderer call={call} />
      case 'question':
        return <QuestionRenderer call={call} />
      case 'skill':
        return <SkillRenderer call={call} />
      case 'todowrite':
        return <TodoWriteRenderer call={call} />
      default:
        return <DefaultRenderer call={call} />
    }
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onToggle}
      disabled={!onToggle}
    >
      {renderContent()}
    </TouchableOpacity>
  )
}

// ─── Shell 渲染器 ────────────────────────────────────────

const ShellRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const [outputExpanded, setOutputExpanded] = useState(false)
  const command = (call.input as any)?.command || (call.input as any)?.cmd || ''
  const output = call.result ? String(call.result) : ''
  const statusIcon = call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>🖥️</Text>
        <Text style={styles.toolName}>Shell</Text>
        <Text style={styles.statusIcon}>{statusIcon}</Text>
      </View>
      <Text style={styles.command} numberOfLines={outputExpanded ? undefined : 2}>
        $ {command}
      </Text>
      {output ? (
        <TouchableOpacity
          style={styles.outputToggle}
          onPress={() => setOutputExpanded(!outputExpanded)}
        >
          <Text style={styles.outputLabel}>
            {outputExpanded ? '▼' : '▶'} Output ({output.split('\n').length} lines)
          </Text>
        </TouchableOpacity>
      ) : null}
      {outputExpanded && output ? (
        <ScrollView style={styles.outputContainer}>
          <Text style={styles.output}>{output}</Text>
        </ScrollView>
      ) : null}
    </View>
  )
}

// ─── Read 渲染器 ─────────────────────────────────────────

const ReadRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const filePath = (call.input as any)?.path || (call.input as any)?.file || ''
  const content = call.result ? String(call.result) : ''
  const lines = content.split('\n').length

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>📖</Text>
        <Text style={styles.toolName}>Read</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.filePath} numberOfLines={1}>{filePath}</Text>
      {content ? (
        <Text style={styles.contentPreview} numberOfLines={3}>
          {content}
        </Text>
      ) : null}
      <Text style={styles.meta}>{lines} lines</Text>
    </View>
  )
}

// ─── Write 渲染器 ────────────────────────────────────────

const WriteRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const filePath = (call.input as any)?.path || (call.input as any)?.file || ''
  const content = (call.input as any)?.content || ''

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>✏️</Text>
        <Text style={styles.toolName}>Write</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.filePath} numberOfLines={1}>{filePath}</Text>
      {content ? (
        <Text style={styles.contentPreview} numberOfLines={3}>
          {content}
        </Text>
      ) : null}
    </View>
  )
}

// ─── Edit 渲染器 ─────────────────────────────────────────

const EditRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const filePath = (call.input as any)?.path || (call.input as any)?.file || ''
  const oldString = (call.input as any)?.oldString || ''
  const newString = (call.input as any)?.newString || ''

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>🔧</Text>
        <Text style={styles.toolName}>Edit</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.filePath} numberOfLines={1}>{filePath}</Text>
      {oldString ? (
        <View style={styles.diffContainer}>
          <Text style={styles.diffRemove} numberOfLines={2}>- {oldString}</Text>
          {newString ? (
            <Text style={styles.diffAdd} numberOfLines={2}>+ {newString}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

// ─── Glob 渲染器 ─────────────────────────────────────────

const GlobRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const pattern = (call.input as any)?.pattern || (call.input as any)?.glob || ''
  const results = call.result ? (Array.isArray(call.result) ? call.result : []) : []

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>🔍</Text>
        <Text style={styles.toolName}>Glob</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.pattern}>Pattern: {pattern}</Text>
      {results.length > 0 ? (
        <Text style={styles.resultCount}>{results.length} files found</Text>
      ) : null}
    </View>
  )
}

// ─── Grep 渲染器 ─────────────────────────────────────────

const GrepRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const query = (call.input as any)?.query || (call.input as any)?.pattern || ''
  const results = call.result ? (Array.isArray(call.result) ? call.result : []) : []

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>🔎</Text>
        <Text style={styles.toolName}>Grep</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.pattern}>Query: {query}</Text>
      {results.length > 0 ? (
        <Text style={styles.resultCount}>{results.length} matches found</Text>
      ) : null}
    </View>
  )
}

// ─── WebFetch 渲染器 ─────────────────────────────────────

const WebFetchRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const url = (call.input as any)?.url || ''
  const content = call.result ? String(call.result) : ''

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>🌐</Text>
        <Text style={styles.toolName}>WebFetch</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.url} numberOfLines={1}>{url}</Text>
      {content ? (
        <Text style={styles.contentPreview} numberOfLines={2}>
          {content.length > 200 ? content.slice(0, 200) + '...' : content}
        </Text>
      ) : null}
    </View>
  )
}

// ─── WebSearch 渲染器 ────────────────────────────────────

const WebSearchRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const query = (call.input as any)?.query || ''
  const results = call.result ? (Array.isArray(call.result) ? call.result : []) : []

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>🔍</Text>
        <Text style={styles.toolName}>WebSearch</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.pattern}>Query: {query}</Text>
      {results.length > 0 ? (
        <Text style={styles.resultCount}>{results.length} results found</Text>
      ) : null}
    </View>
  )
}

// ─── Task 渲染器 ─────────────────────────────────────────

const TaskRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const description = (call.input as any)?.description || ''

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>📋</Text>
        <Text style={styles.toolName}>Task</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.description} numberOfLines={2}>{description}</Text>
    </View>
  )
}

// ─── Question 渲染器 ─────────────────────────────────────

const QuestionRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const question = (call.input as any)?.question || ''

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>❓</Text>
        <Text style={styles.toolName}>Question</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.description} numberOfLines={3}>{question}</Text>
    </View>
  )
}

// ─── Skill 渲染器 ────────────────────────────────────────

const SkillRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const name = (call.input as any)?.name || ''

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>⚡</Text>
        <Text style={styles.toolName}>Skill</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.description} numberOfLines={1}>{name}</Text>
    </View>
  )
}

// ─── TodoWrite 渲染器 ────────────────────────────────────

const TodoWriteRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const todos = (call.input as any)?.todos || []

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>📝</Text>
        <Text style={styles.toolName}>TodoWrite</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.description}>
        {todos.length} todo items
      </Text>
    </View>
  )
}

// ─── 默认渲染器 ──────────────────────────────────────────

const DefaultRenderer: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const inputPreview =
    typeof call.input === 'object' && call.input !== null
      ? JSON.stringify(call.input).slice(0, 60)
      : String(call.input || '')

  return (
    <View style={styles.toolContent}>
      <View style={styles.toolHeader}>
        <Text style={styles.toolIcon}>⚙️</Text>
        <Text style={styles.toolName}>{call.tool}</Text>
        <Text style={styles.statusIcon}>
          {call.status === 'success' ? '✅' : call.status === 'failed' ? '❌' : '⏳'}
        </Text>
      </View>
      <Text style={styles.inputPreview} numberOfLines={1}>{inputPreview}</Text>
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
    marginBottom: 8,
  },
  toolIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  toolName: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  statusIcon: {
    fontSize: 14,
  },
  command: {
    color: '#4ecdc4',
    fontFamily: 'monospace',
    fontSize: 13,
    backgroundColor: '#0d1117',
    padding: 8,
    borderRadius: 4,
  },
  filePath: {
    color: '#007AFF',
    fontSize: 13,
    marginBottom: 4,
  },
  contentPreview: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
    backgroundColor: '#0d1117',
    padding: 8,
    borderRadius: 4,
  },
  meta: {
    color: '#666',
    fontSize: 11,
    marginTop: 4,
  },
  diffContainer: {
    marginTop: 8,
    padding: 8,
    backgroundColor: '#0d1117',
    borderRadius: 4,
  },
  diffRemove: {
    color: '#ff6b6b',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  diffAdd: {
    color: '#51cf66',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  pattern: {
    color: '#ffd43b',
    fontSize: 13,
  },
  resultCount: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  url: {
    color: '#007AFF',
    fontSize: 13,
  },
  description: {
    color: '#eee',
    fontSize: 13,
  },
  inputPreview: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  outputToggle: {
    marginTop: 8,
    paddingVertical: 4,
  },
  outputLabel: {
    color: '#888',
    fontSize: 12,
  },
  outputContainer: {
    maxHeight: 200,
    backgroundColor: '#0d1117',
    borderRadius: 4,
    padding: 8,
  },
  output: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
})
