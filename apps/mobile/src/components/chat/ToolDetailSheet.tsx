import React from 'react'
import { Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolPart } from './BasicTool'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'
import type { Part } from '../../types/message'
import type { ToolPartData } from '../../stores/chatStore'

interface ToolDetailSheetProps {
  visible: boolean
  parts: Part[]
  onClose: () => void
}

function getToolData(p: Part): ToolPartData {
  return p.data as unknown as ToolPartData
}

function getReasoningContent(p: Part): string {
  return (p.data as { content?: string })?.content ?? ''
}

/**
 * 操作块详情面板（Modal）。
 *
 * 一级展开只做裁剪（ClampBox），完整内容在此查看：思考全文 + 全部工具详情。
 * 它是该操作块唯一拥有纵向滚动的容器 —— cell 内不再内嵌纵向 ScrollView，
 * 从根本上避免 inverted FlatList 内嵌滚动的方向反转（RN #29776）。
 */
export const ToolDetailSheet: React.FC<ToolDetailSheetProps> = ({ visible, parts, onClose }) => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)

  const reasoningParts = parts.filter((p) => p.type === 'reasoning')
  const toolParts = parts.filter((p) => p.type === 'tool')

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>工具详情</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="关闭工具详情"
            accessibilityRole="button"
          >
            <Text style={styles.close}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          {reasoningParts.map((p, i) => {
            const content = getReasoningContent(p)
            return content ? (
              <View key={p.id || `r-${i}`} style={styles.reasoningBlock}>
                <Text style={styles.reasoningLabel}>💭 思考</Text>
                <MarkdownRenderer content={content} />
              </View>
            ) : null
          })}

          {toolParts.map((p, i) => (
            <View key={p.id || `t-${i}`} style={styles.toolRow}>
              <ToolPart
                data={getToolData(p) as unknown as Record<string, unknown>}
                messageRole="assistant"
                defaultExpanded
              />
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
    },
    close: {
      color: colors.primary,
      fontSize: 20,
      paddingHorizontal: 4,
    },
    body: {
      flex: 1,
    },
    bodyContent: {
      padding: 12,
      paddingBottom: 32,
    },
    reasoningBlock: {
      marginBottom: 12,
    },
    reasoningLabel: {
      color: colors.textTertiary,
      fontSize: 12,
      marginBottom: 4,
    },
    toolRow: {
      marginVertical: 3,
    },
  })
