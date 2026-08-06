import React, { useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Alert, Clipboard } from 'react-native'
import { PartProps, Part, getPartRenderer, registerPart } from '../../types/message'
import { ToolPart } from './BasicTool'
import { ToolErrorCard } from './ToolErrorCard'
import { MarkdownRenderer } from './MarkdownRenderer'

// ─── PartBlock 调度器 ────────────────────────────────────

export const PartBlock: React.FC<PartProps> = ({ part, message, onRevert }) => {
  const Renderer = getPartRenderer(part.type)
  if (!Renderer) return null
  return <Renderer part={part} message={message} onRevert={onRevert} />
}

// ─── Text Part ────────────────────────────────────────────

const TextPartDisplay: React.FC<PartProps> = ({ part, message, onRevert }) => {
  const content = String(part.data?.content ?? part.data?.text ?? '')
  return (
    <MessageWrapper content={content} message={message} onRevert={onRevert}>
      <MarkdownRenderer content={content} />
    </MessageWrapper>
  )
}
registerPart('text', TextPartDisplay)

// ─── 长按菜单 Wrapper ─────────────────────────────────────

const MessageWrapper: React.FC<{ content: string; message: { id?: string; role?: string; messageID?: string; partID?: string }; onRevert?: (messageID: string, partID?: string) => void; children: React.ReactNode }> = ({ content, message, onRevert, children }) => {
  const showMenu = () => {
    Alert.alert('消息操作', undefined, [
      { text: '复制消息', onPress: () => Clipboard.setString(content) },
      ...(message.role === 'assistant' && message.messageID
        ? [{
            text: '回退到此',
            style: 'destructive' as const,
            onPress: () => {
              if (onRevert && message.messageID) onRevert(message.messageID, message.partID)
            },
          }]
        : []),
      { text: '取消', style: 'cancel' as const },
    ])
  }

  return (
    <TouchableOpacity
      activeOpacity={1}
      onLongPress={showMenu}
      delayLongPress={500}
      accessible={true}
      accessibilityRole="button"
      testID={message.role === 'assistant' ? 'assistant-text-part' : undefined}
    >
      {children}
    </TouchableOpacity>
  )
}

// ─── Tool Part ────────────────────────────────────────────

const ToolPartDisplay: React.FC<PartProps> = ({ part, message }) => (
  <View style={styles.toolPart}>
    <ToolPart data={part.data} messageRole={message.role} />
  </View>
)
registerPart('tool', ToolPartDisplay)

// ─── Reasoning Part ────────────────────────────────────────

const ReasoningDisplay: React.FC<PartProps> = ({ part }) => {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <View style={styles.reasoningBlock}>
      <ReasoningHeader expanded={expanded} onToggle={() => setExpanded(v => !v)} />
      {expanded && (
        <Text style={styles.reasoningText}>{String(part.data?.content ?? '')}</Text>
      )}
    </View>
  )
}
registerPart('reasoning', ReasoningDisplay)

export const ReasoningHeader: React.FC<{ expanded: boolean; onToggle: () => void }> = ({ expanded, onToggle }) => (
  <TouchableOpacity style={styles.reasoningHeader} onPress={onToggle} activeOpacity={0.7}>
    <Text style={styles.reasoningIcon}>🧠</Text>
    <Text style={styles.reasoningLabel}>思考过程</Text>
    <Text style={styles.reasoningArrow}>{expanded ? '▼' : '▶'}</Text>
  </TouchableOpacity>
)

// ─── Error Part ────────────────────────────────────────────

const ErrorPartDisplay: React.FC<PartProps> = ({ part }) => (
  <View style={styles.errorPart}>
    <ToolErrorCard
      tool={String(part.data?.tool ?? 'Error')}
      error={String(part.data?.error ?? part.data?.message ?? '')}
      subtitle={String(part.data?.subtitle ?? '')}
    />
  </View>
)
registerPart('error', ErrorPartDisplay)

// ─── File Part ─────────────────────────────────────────────

const FilePartDisplay: React.FC<PartProps> = ({ part }) => (
  <View style={styles.filePart}>
    <Text style={styles.fileIcon}>📄</Text>
    <Text style={styles.fileName} numberOfLines={1}>{String(part.data?.name ?? '')}</Text>
  </View>
)
registerPart('file', FilePartDisplay)

// ─── Compaction Part ───────────────────────────────────────

const CompactionDisplay: React.FC<PartProps> = () => (
  <View style={styles.compactionDivider}>
    <View style={styles.compactionLine} />
    <Text style={styles.compactionText}>— 上下文压缩 —</Text>
    <View style={styles.compactionLine} />
  </View>
)
registerPart('compaction', CompactionDisplay)

// ─── 导出 Part 类型 ────────────────────────────────────────

export { registerPart, getPartRenderer } from '../../types/message'
export const MessageWrapperForFallback = MessageWrapper

const styles = StyleSheet.create({
  textPart: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 22,
  },
  toolPart: {
    marginVertical: 4,
  },
  reasoningBlock: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    marginVertical: 4,
    overflow: 'hidden',
  },
  reasoningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  reasoningIcon: { fontSize: 14, marginRight: 8 },
  reasoningLabel: { color: '#888', fontSize: 13, flex: 1 },
  reasoningArrow: { color: '#666', fontSize: 12 },
  reasoningText: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  errorPart: {
    marginVertical: 4,
  },
  filePart: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 6,
    padding: 8,
    marginVertical: 2,
  },
  fileIcon: { fontSize: 14, marginRight: 8 },
  fileName: { color: '#eee', fontSize: 13, flex: 1 },
  compactionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 12,
    paddingHorizontal: 12,
  },
  compactionLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#333',
  },
  compactionText: {
    color: '#666',
    fontSize: 11,
    marginHorizontal: 8,
  },
})
