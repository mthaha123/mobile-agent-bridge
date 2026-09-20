import React, { useCallback, useState } from 'react'
import { Clipboard, Text, View } from 'react-native'
import type {
  LayoutChangeEvent,
  NativeSyntheticEvent,
  TextLayoutEventData,
  TextStyle,
  ViewStyle,
} from 'react-native'
import { AppPressable } from '../common/AppPressable'
import { HorizontalScrollBox } from '../common/HorizontalScrollBox'
import { useThemeColors } from '../../theme/ThemeContext'

interface MarkdownCodeBlockProps {
  /** 代码块纯文本（react-native-marked Renderer.code 的 text 参数） */
  text: string
  /** 代码块容器样式（来自 markdown 主题，透传给 contentContainerStyle） */
  containerStyle?: ViewStyle
  /** 代码文本样式（来自 markdown 主题，透传给 Text） */
  textStyle?: TextStyle
}

/**
 * 固有宽度探针的容器宽度（dp）。
 *
 * 探针必须是「绝对定位 + 固定超宽容器 + alignSelf: 'flex-start'」：
 * - 固定超宽 → 探针 Text 的可用宽度极大 → 测量时不折行 →
 *   平台返回的是每行**真实**宽度（而不是被可用宽度撑满的宽度）；
 * - alignSelf: 'flex-start' → 关键！容器是 column，默认 alignItems: 'stretch'
 *   会把探针 Text 拉伸到 20000dp，量到的就是容器宽度而不是文本宽度；
 * - 绝对定位 → 不参与外层布局，不会把代码块本身撑到 20000dp。
 *
 * 注意：直接给真实 Text 设大 width 是没用的 —— 那只会改节点宽度，
 * 外层 ScrollView 的 content container 仍按可用宽度测量。
 */
const PROBE_WIDTH = 20000

/** 探针宽度接近容器满宽时说明没量到固有宽度（被拉伸 / 平台返回了可用宽度），丢弃 */
const isUsableProbeWidth = (w: number): boolean => w > 0 && w < PROBE_WIDTH - 100

/**
 * 代码块渲染组件（替代 react-native-marked 内置 code() 的默认实现）。
 *
 * 历史问题与对策：
 * 1. 未开 nestedScrollEnabled → 横向拖动被外层 inverted FlatList 抢走
 *    （已修：horizontal ScrollView + nestedScrollEnabled，对齐 MarkdownTable 标准方案）
 * 2. 文本 selectable → Android 原生文本选择手势参与触摸分发，
 *    与横向 pan 竞争导致"滑动很难触发"（对照组：同环境的 MarkdownTable
 *    单元格不可选中、滑动正常）。已移除 selectable，复制能力改由右上角
 *    Copy 按钮显式提供。
 * 3. 仅当内容实测超宽时显示横向滚动指示条。
 * 4. react-native-marked 默认 theme 的 code 容器样式含 `minWidth: "100%"`，
 *    会把横向 ScrollView 的 content container 撑成确定宽度。已剥离该属性，
 *    背景色改由外层 View 承担（短代码块背景仍铺满整行）。
 * 5. 【横向"完全滑不动"的真正根因】新版架构（Fabric）下 `Text` 在
 *    `AT_MOST(可用宽度)` 里会把**节点宽度撑满可用宽度**
 *    （RN 已知回归 facebook/react-native#54571 / #52421 / yoga#1730：
 *    Yoga 用 fit-content 而非 max-content 测量 flex basis，
 *    且 RN「文本需要折行时取整个可用宽度」——见 PR #47435）。
 *    实测：168 字符的长行**并没有折行**（截图里是被右侧裁断的 3 行），
 *    但 Text 节点宽度 == 可用宽度，于是横向 ScrollView 的 content 宽度
 *    恒等于视口宽度 → 可滚动范围恒为 0 → "代码块横向完全不动"
 *    （外层列表也不动，因为根本没有滚动量）。
 *
 *    对策：用「绝对定位 + 固定超宽容器 + alignSelf: flex-start」的隐藏探针
 *    量出每行真实固有宽度，再把它显式写成 Text 的 `width`
 *    （显式宽度走 EXACTLY 测量，不再被可用宽度撑满）→ content 真正溢出 → 横向可滚。
 *    实测（Pixel 7 / Android 15 模拟器）：168 字符长行量得 1259dp，
 *    滑动后文本左边界由 53 → 11（内容真实位移）。
 *    对照组：MarkdownTable 的单元格有显式列宽，所以它一直能正常横滚。
 */
export const MarkdownCodeBlock: React.FC<MarkdownCodeBlockProps> = ({
  text,
  containerStyle,
  textStyle,
}) => {
  const colors = useThemeColors()
  const [contentWidth, setContentWidth] = useState<number | null>(null)

  const applyMeasuredWidth = useCallback((raw: number) => {
    if (!isUsableProbeWidth(raw)) return
    const next = Math.ceil(raw) + 2
    // 收敛判断：与上次相差 ≤2px 视为同一结果，避免反复 setState
    setContentWidth((prev) => (prev !== null && Math.abs(prev - next) <= 2 ? prev : next))
  }, [])

  // 通道一：探针节点布局宽度（无约束 + 不拉伸时 == 文本固有宽度）
  const handleProbeLayout = useCallback(
    (e: NativeSyntheticEvent<LayoutChangeEvent>) => {
      applyMeasuredWidth(e.nativeEvent?.layout?.width ?? 0)
    },
    [applyMeasuredWidth],
  )

  // 通道二：探针最长行宽（无约束布局下 == 真实行宽）
  const handleProbeTextLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      const lines = e.nativeEvent?.lines ?? []
      let max = 0
      for (const line of lines) {
        if (line.width > max) max = line.width
      }
      applyMeasuredWidth(max)
    },
    [applyMeasuredWidth],
  )

  // 见上方第 4 条：剥掉会让 content container 变成确定宽度的 minWidth
  const innerStyle: ViewStyle = { ...(containerStyle ?? {}) }
  delete (innerStyle as { minWidth?: unknown }).minWidth
  const codeBackground = containerStyle?.backgroundColor ?? colors.markdownCodeBg

  return (
    <View style={[styles.wrap, { backgroundColor: codeBackground }]}>
      <HorizontalScrollBox contentContainerStyle={innerStyle} testID="md-code-block">
        {/* 包一层 View 避免 "Cannot add a child that doesn't have a YogaNode..." 错误 */}
        <View>
          {/* selectable 会挂载 Android 文本选择手势、抢横向 pan —— 保持 false */}
          <Text
            selectable={false}
            style={[textStyle, contentWidth !== null ? { width: contentWidth } : null]}
            testID="md-code-text"
          >
            {text}
          </Text>
        </View>
      </HorizontalScrollBox>

      {/* 固有宽度探针（见根因 5）：绝对定位 + 超宽容器 + 不拉伸，仅用于测量，不参与布局 */}
      <View style={styles.probeBox} pointerEvents="none">
        <Text
          style={[textStyle, styles.probeText]}
          onLayout={handleProbeLayout}
          onTextLayout={handleProbeTextLayout}
          testID="md-code-probe"
        >
          {text}
        </Text>
      </View>

      <AppPressable
        style={[styles.copyBtn, { backgroundColor: colors.surfaceVariant }]}
        onPress={() => { Clipboard.setString(text) }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        testID="md-code-copy"
      >
        <Text style={[styles.copyText, { color: colors.textSecondary }]}>Copy</Text>
      </AppPressable>
    </View>
  )
}

const styles = {
  wrap: {
    // 背景铺满整行（原先由 content container 的 minWidth: "100%" 实现）
    alignSelf: 'stretch',
  } as ViewStyle,
  probeBox: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PROBE_WIDTH,
    opacity: 0,
  } as ViewStyle,
  probeText: {
    // 关键：否则会被 column 容器的 alignItems: 'stretch' 拉成 20000dp
    alignSelf: 'flex-start',
  } as TextStyle,
  copyBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  } as ViewStyle,
  copyText: {
    fontSize: 11,
    fontWeight: '600',
  } as TextStyle,
}
