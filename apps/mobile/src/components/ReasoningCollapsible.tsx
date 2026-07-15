/**
 * ReasoningCollapsible — 思考/推理折叠组件
 *
 * 显示AI的思考过程，可以折叠/展开
 */
import React, { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native'

interface ReasoningCollapsibleProps {
  /** 推理内容 */
  content: string
  /** 标题 */
  title?: string
  /** 是否默认展开 */
  defaultExpanded?: boolean
  /** 样式 */
  style?: object
}

export const ReasoningCollapsible: React.FC<ReasoningCollapsibleProps> = ({
  content,
  title = 'Thinking Process',
  defaultExpanded = false,
  style,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded)

  if (!content) return null

  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.icon}>💭</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          <Text style={styles.contentText}>{content}</Text>
        </View>
      )}

      {!expanded && content && (
        <Text style={styles.preview} numberOfLines={2}>
          {content}
        </Text>
      )}
    </View>
  )
}

interface ReasoningStreamProps {
  /** 推理内容（流式更新） */
  content: string
  /** 是否正在流式接收 */
  streaming?: boolean
  /** 样式 */
  style?: object
}

export const ReasoningStream: React.FC<ReasoningStreamProps> = ({
  content,
  streaming = false,
  style,
}) => {
  const [expanded, setExpanded] = useState(false)

  if (!content && !streaming) return null

  return (
    <View style={[styles.container, style]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.icon}>
            {streaming ? '⚡' : '💭'}
          </Text>
          <Text style={styles.title}>
            {streaming ? 'Thinking...' : 'Thinking Process'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          {streaming && <View style={styles.streamingIndicator} />}
          <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && content && (
        <View style={styles.content}>
          <Text style={styles.contentText}>{content}</Text>
        </View>
      )}

      {!expanded && content && (
        <Text style={styles.preview} numberOfLines={2}>
          {content}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    marginVertical: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  icon: {
    fontSize: 16,
    marginRight: 8,
  },
  title: {
    color: '#8b949e',
    fontSize: 13,
    fontWeight: '600',
  },
  chevron: {
    color: '#8b949e',
    fontSize: 12,
  },
  streamingIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007AFF',
  },
  content: {
    padding: 12,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
  },
  contentText: {
    color: '#d4d4d4',
    fontSize: 13,
    lineHeight: 20,
  },
  preview: {
    color: '#666',
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 12,
    fontStyle: 'italic',
  },
})
