import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  LayoutAnimation,
  useWindowDimensions,
} from 'react-native'
import { getToolInfo } from '../../types/message'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ToolPart } from './BasicTool'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'
import type { Part } from '../../types/message'
import type { ToolPartData } from '../../stores/chatStore'

interface ToolGroupCardProps {
  parts: Part[]
}

/** 展开级别：0 折叠 / 1 限高（框内滚动，只露最新工具）/ 2 全开（不限高） */
type ExpandLevel = 0 | 1 | 2

/** 一级展开的框高 ≈ 屏高的 1/3 */
const BOX_HEIGHT_RATIO = 1 / 3
/** 距底多少以内算"贴着底部"（决定流式时是否自动跟随最新内容） */
const AT_BOTTOM_THRESHOLD = 24

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
 * 三级展开，解决"长思考 + 多工具顶满屏幕"：
 *   0 折叠：只有标题栏（进行中保持折叠，标题实时反映进度）
 *   1 限高：内容装在 ≈屏高 1/3 的框内（可滚动），工具只露最新一个，
 *           展开即滚到最新；流式输出时仅在用户贴着底部才自动跟随
 *   2 全开：不限高，思考全文 + 全部工具详情依次铺开
 *
 * 状态迁移：0 ──点标题──> 1 ──点底部入口──> 2；1/2 ──点标题──> 0。
 */
export const ToolGroupCard: React.FC<ToolGroupCardProps> = ({ parts }) => {
  const [level, setLevel] = useState<ExpandLevel>(0)
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const { height: windowHeight } = useWindowDimensions()
  const boxHeight = Math.round(windowHeight * BOX_HEIGHT_RATIO)

  const scrollRef = useRef<ScrollView | null>(null)
  /** 用户是否贴着底部：是才自动跟随最新内容，避免打断他往上翻看历史 */
  const atBottomRef = useRef(true)
  const [contentFits, setContentFits] = useState(false)

  const { toolParts, reasoningParts, count, statusIcon, runningTool } = useMemo(() => {
    const tools: Part[] = []
    const reasoning: Part[] = []
    for (const p of parts) {
      if (p.type === 'tool') tools.push(p)
      else if (p.type === 'reasoning') reasoning.push(p)
    }
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
    // 一级展开只露一个工具：正在运行的优先（取最后一个在跑的），否则取最后一个
    const runningOnes = tools.filter(isRunningTool)
    const featured = runningOnes.length > 0
      ? runningOnes[runningOnes.length - 1]
      : (tools.length > 0 ? tools[tools.length - 1] : null)
    return { toolParts: tools, reasoningParts: reasoning, count: tools.length, statusIcon: icon, runningTool: featured }
  }, [parts])

  const hasReasoning = reasoningParts.length > 0
  const hasTools = toolParts.length > 0

  // 展开时滚到最新内容（不做动画：动画会让人看着往下滚半天）
  const scrollToLatest = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: false })
  }, [])

  // 展开 0→1 / 内容变化（流式）时跟随：仅当用户贴着底部
  useEffect(() => {
    if (level !== 1) return
    if (!atBottomRef.current) return
    scrollToLatest()
  }, [level, scrollToLatest, reasoningParts.length, toolParts.length, runningTool?.id, runningTool?.data])

  const handleHeaderPress = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    // level 2 点标题直接收起（不回退到 1）；level 0 → 1
    setLevel((v) => (v === 0 ? 1 : 0))
  }

  const handleExpandAll = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setLevel(2)
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

  const handleScroll = (e: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent
    const distanceToBottom = contentSize.height - layoutMeasurement.height - contentOffset.y
    atBottomRef.current = distanceToBottom <= AT_BOTTOM_THRESHOLD
  }

  const handleContentSizeChange = (_w: number, h: number) => {
    // 内容没超过框高 → 取消限高，按自然高度显示（省掉没必要的滚动框）
    const fits = h <= boxHeight
    if (fits !== contentFits) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      setContentFits(fits)
    }
  }

  const featuredInfo = runningTool ? getToolInfo(getToolData(runningTool).tool, getToolData(runningTool).input ?? {}) : null
  const featuredStatus = runningTool
    ? (getToolData(runningTool).status === 'success' ? '✓'
      : getToolData(runningTool).status === 'failed' ? '✗' : '⏳')
    : ''

  return (
    <View style={styles.card}>
      <TouchableOpacity
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
      </TouchableOpacity>

      {level === 1 ? (
        <>
          <ScrollView
            ref={scrollRef}
            style={[styles.scrollBox, contentFits ? styles.scrollBoxNatural : { maxHeight: boxHeight }]}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            onContentSizeChange={handleContentSizeChange}
          >
            {reasoningParts.map((p, i) => {
              const content = getReasoningContent(p)
              return content ? (
                <View key={p.id || `r-${i}`} style={styles.reasoningBlock}>
                  <Text style={styles.reasoningLabel}>💭 思考</Text>
                  <MarkdownRenderer content={content} />
                </View>
              ) : null
            })}

            {runningTool && featuredInfo ? (
              <View style={styles.glanceRow}>
                <Text style={styles.glanceIcon}>{featuredInfo.icon}</Text>
                <Text style={styles.glanceTitle} numberOfLines={1}>{featuredInfo.title}</Text>
                {featuredInfo.subtitle ? (
                  <Text style={styles.glanceSubtitle} numberOfLines={1}>{featuredInfo.subtitle}</Text>
                ) : null}
                <Text style={styles.glanceStatus}>{featuredStatus}</Text>
              </View>
            ) : null}
          </ScrollView>

          {hasTools ? (
            <TouchableOpacity
              style={styles.expandAllRow}
              onPress={handleExpandAll}
              activeOpacity={0.7}
              accessibilityLabel="展开全部工具"
            >
              <Text style={styles.expandAllText}>
                {count > 1 ? `展开全部 (${count})` : '查看详情'}
              </Text>
              <Text style={styles.expandAllChevron}>›</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {level === 2 ? (
        <View style={styles.body}>
          {/* 思考部分：全文 */}
          {reasoningParts.map((p, i) => {
            const content = getReasoningContent(p)
            return content ? (
              <View key={p.id || `r-${i}`} style={styles.reasoningBlock}>
                <Text style={styles.reasoningLabel}>💭 思考</Text>
                <MarkdownRenderer content={content} />
              </View>
            ) : null
          })}
          {/* 工具部分：全部按顺序铺开，详情默认展开（可单独收起） */}
          {toolParts.map((p, i) => (
            <View key={p.id || `t-${i}`} style={styles.fullToolRow}>
              <ToolPart
                data={getToolData(p) as unknown as Record<string, unknown>}
                messageRole="assistant"
                defaultExpanded
              />
            </View>
          ))}
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
    // 一级展开：内容装进固定高度的框（内容较矮时退回自然高度）
    scrollBox: {
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
    },
    scrollBoxNatural: {
      maxHeight: undefined,
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
    // 底部入口：一级 → 二级
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
    // 二级展开
    body: {
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
      paddingVertical: 4,
    },
    fullToolRow: {
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
  })
