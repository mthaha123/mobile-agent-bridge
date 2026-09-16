import React, { useState, useMemo } from 'react'
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
} from 'react-native'
import { AppPressable } from '../common/AppPressable'
import { getToolInfo } from '../../types/message'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ClampBox } from './ClampBox'
import { ToolDetailSheet } from './ToolDetailSheet'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'
import type { Part } from '../../types/message'
import type { ToolPartData } from '../../stores/chatStore'

interface ToolGroupCardProps {
  parts: Part[]
}

/** 展开级别：0 折叠 / 1 限高裁剪（只露最新工具，完整内容走详情 Modal） */
type ExpandLevel = 0 | 1

/** 一级展开的框高 ≈ 屏高的 1/3 */
const BOX_HEIGHT_RATIO = 1 / 3

function getToolData(p: Part): ToolPartData {
  return p.data as unknown as ToolPartData
}

function getReasoningContent(p: Part): string {
  return (p.data as { content?: string })?.content ?? ''
}

function isRunningTool(p: Part): boolean {
  const s = getToolData(p).status
  return s === 'called' || s === 'progress'
}

/**
 * 操作块聚合卡片（reasoning + tool 混合）。
 *
 * 两级展示，解决"长思考 + 多工具顶满屏幕"，且 cell 内不产生纵向滚动：
 *   0 折叠：只有标题栏（进行中保持折叠，标题实时反映进度）
 *   1 限高裁剪：内容装在 ≈屏高 1/3 的框内（ClampBox，裁剪不滚动），工具只露最新一个
 *   详情：点底部入口打开 ToolDetailSheet（Modal，唯一纵向滚动所有者），
 *         思考全文 + 全部工具详情依次铺开
 *
 * 状态迁移：0 ──点标题──> 1 ──点标题──> 0；1 ──点底部入口──> Modal 详情。
 *
 * 为何不内嵌纵向滚动：inverted FlatList 内嵌 ScrollView 过滚动时父列表方向反转
 * （RN #29776），且与列表争夺纵向手势。见
 * docs/plans/2026-09-12-chat-scroll-ownership-design.md。
 */
export const ToolGroupCard: React.FC<ToolGroupCardProps> = ({ parts }) => {
  const [level, setLevel] = useState<ExpandLevel>(0)
  const [detailVisible, setDetailVisible] = useState(false)
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const { height: windowHeight } = useWindowDimensions()
  const boxHeight = Math.round(windowHeight * BOX_HEIGHT_RATIO)

  const { toolParts, reasoningParts, count, statusIcon, featuredTool } = useMemo(() => {
    const tools: Part[] = []
    const reasoning: Part[] = []
    for (const p of parts) {
      if (p.type === 'tool') tools.push(p)
      else if (p.type === 'reasoning') reasoning.push(p)
    }
    let failed = 0
    let running = 0
    for (const p of tools) {
      const d = getToolData(p)
      if (d.status === 'failed') failed++
      else if (d.status !== 'success') running++
    }
    let icon = '✓'
    if (failed > 0) icon = '✗'
    else if (running > 0) icon = '⏳'
    // 一级展开只露一个工具：正在运行的优先（取最后一个在跑的），否则取最后一个
    const runningOnes = tools.filter(isRunningTool)
    const featured = runningOnes.length > 0
      ? runningOnes[runningOnes.length - 1]
      : (tools.length > 0 ? tools[tools.length - 1] : null)
    return { toolParts: tools, reasoningParts: reasoning, count: tools.length, statusIcon: icon, featuredTool: featured }
  }, [parts])

  const hasReasoning = reasoningParts.length > 0
  const hasTools = toolParts.length > 0

  const handleHeaderPress = () => {
    setLevel((v) => (v === 0 ? 1 : 0))
  }

  const handleOpenDetail = () => {
    setDetailVisible(true)
  }

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

  const featuredInfo = featuredTool
    ? getToolInfo(getToolData(featuredTool).tool, getToolData(featuredTool).input ?? {})
    : null
  const featuredStatus = featuredTool
    ? (getToolData(featuredTool).status === 'success' ? '✓'
      : getToolData(featuredTool).status === 'failed' ? '✗' : '⏳')
    : ''

  return (
    <View style={styles.card}>
      <AppPressable
        style={styles.header}
        onPress={handleHeaderPress}
        activeOpacity={0.7}
      >
        <Text style={styles.headerIcon}>{headerIcon}</Text>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {headerLabel}
        </Text>
        {hasTools ? <Text style={styles.statusText}>{statusIcon}</Text> : null}
        <Text style={styles.chevron}>{level === 0 ? '▶' : '▼'}</Text>
      </AppPressable>

      {level === 1 ? (
        <>
          {/* 限高裁剪（不滚动）：思考 + 最新工具一行 */}
          <ClampBox maxHeight={boxHeight} style={styles.clampBox}>
            {reasoningParts.map((p, i) => {
              const content = getReasoningContent(p)
              return content ? (
                <View key={p.id || `r-${i}`} style={styles.reasoningBlock}>
                  <Text style={styles.reasoningLabel}>💭 思考</Text>
                  <MarkdownRenderer content={content} />
                </View>
              ) : null
            })}

            {featuredTool && featuredInfo ? (
              <View style={styles.glanceRow}>
                <Text style={styles.glanceIcon}>{featuredInfo.icon}</Text>
                <Text style={styles.glanceTitle} numberOfLines={1}>{featuredInfo.title}</Text>
                {featuredInfo.subtitle ? (
                  <Text style={styles.glanceSubtitle} numberOfLines={1}>{featuredInfo.subtitle}</Text>
                ) : null}
                <Text style={styles.glanceStatus}>{featuredStatus}</Text>
              </View>
            ) : null}
          </ClampBox>

          {hasTools ? (
            <AppPressable
              style={styles.expandAllRow}
              onPress={handleOpenDetail}
              activeOpacity={0.7}
              accessibilityLabel="展开全部工具"
            >
              <Text style={styles.expandAllText}>
                {count > 1 ? `展开全部 (${count})` : '查看详情'}
              </Text>
              <Text style={styles.expandAllChevron}>›</Text>
            </AppPressable>
          ) : null}
        </>
      ) : null}

      {/* 详情 Modal：唯一纵向滚动所有者（仅在打开时挂载，避免隐藏时预渲染内容） */}
      {detailVisible ? (
        <ToolDetailSheet
          visible
          parts={parts}
          onClose={() => setDetailVisible(false)}
        />
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
    // 一级展开：限高裁剪框（不滚动）
    clampBox: {
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
    },
    reasoningBlock: {
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    reasoningLabel: {
      color: colors.textTertiary,
      fontSize: 12,
      marginBottom: 4,
    },
    glanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 12,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
    },
    glanceIcon: { fontSize: 12, width: 20, textAlign: 'center' },
    glanceTitle: { color: colors.text, fontSize: 12, fontWeight: '500', marginRight: 6 },
    glanceSubtitle: { color: colors.textTertiary, fontSize: 11, flex: 1 },
    glanceStatus: { color: colors.textTertiary, fontSize: 11, marginLeft: 4 },
    // 底部入口：一级 → 详情 Modal
    expandAllRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
    },
    expandAllText: {
      color: colors.link,
      fontSize: 12,
      fontWeight: '600',
    },
    expandAllChevron: {
      color: colors.link,
      fontSize: 12,
      marginLeft: 4,
    },
  })
