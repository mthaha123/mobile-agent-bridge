import React, { useCallback, useState } from 'react'
import { Text, View } from 'react-native'
import type {
  LayoutChangeEvent,
  NativeSyntheticEvent,
  TextLayoutEventData,
  TextStyle,
  ViewStyle,
} from 'react-native'
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
 *    单元格不可选中、滑动正常）。已移除 selectable；右上角 Copy 按钮后来也
 *    整个删除（见第 6 条），复制改由系统长按选择 / 全局复制入口承担。
 * 3. 仅当内容实测超宽时显示横向滚动指示条。
 * 4. react-native-marked 默认 theme 的 code 容器样式含 `minWidth: "100%"`，
 *    会把横向 ScrollView 的 content container 撑成确定宽度。已剥离该属性，
 *    背景色改由外层 View 承担（短代码块背景仍铺满整行）。
 * 5. 【横向"完全滑不动"的真正根因】react-native-marked 默认 theme 的 code 容器样式
 *    含 `minWidth: "100%"`（见第 4 条）：它把横向 ScrollView 的 content container
 *    变成**确定宽度**，容器内的 Text 便按容器宽度测量（而不是固有宽度）→
 *    content 宽度恒等于视口宽度 → 可滚动范围恒为 0 → "横向完全不动"。
 *    实测（Pixel 7 / Android 15 模拟器，2026-09-21）：剥掉 minWidth 后，
 *    **不套任何显式宽度**时真实 Text 节点宽度 = 2325dp = 固有宽度（314 字符长行），
 *    content = 2356.95dp vs 视口 403.43dp —— 原生测量本身就会给出固有宽度，
 *    滚动量完整。
 *    ⚠️ 早先"Text 节点宽度 == 可用宽度"的结论来自 uiautomator dump 的 bounds：
 *    Android 会把可滚动祖先内的节点 bounds **裁剪到视口**，"右边界 == 视口右边界"
 *    是裁剪假象，不能作为"Text 被撑满"的证据。
 *
 *    对策：保留探针做**兜底**（防平台行为回归），但落到样式上必须是 `minWidth`
 *    而不是 `width`：探针值在流式期间必然滞后文本增长一个测量周期，用 `width`
 *    会**反向限制**文本（折行 + content 被压回视口宽度 → 可滚动范围归零，
 *    必须等一次重新布局，例如弹出键盘，才恢复）；`minWidth` 只保证不小于固有宽度，
 *    永不小于文本自身需求，因此两种世界（原生测量正确 / 平台回归）都成立。
 *    对照组：MarkdownTable 的单元格有显式列宽，所以它一直能正常横滚。
 *
 * 6. 【"从右上角起手横向完全滑不动、弹键盘才好"的根因】右上角 Copy 按钮是
 *    ScrollView 的**兄弟覆盖层**。Android 的 ScrollView 只能拦截落在自己
 *    **子树内**的触摸：落在兄弟覆盖层上的手势被 Pressable 吃掉后，永远传不到
 *    ScrollView → 从按钮矩形内起手时横向滚动一点都触发不了；而弹出键盘会
 *    触发一次重排（窗口变矮 → 列表/卡片位移），同一手指位置落到代码文字上，
 *    于是"弹键盘才能横滑"。
 *    实测（Pixel 7 / Android 15 模拟器，2026-09-21，打桩脚本
 *    scripts/e2e/stub-code-scroll.mjs --diag-matrix）起点二维隔离：
 *      (950,块中部)  PASS   (1000,块中部) PASS
 *      (950,按钮带)  PASS   (1000,按钮带) FAIL ← 唯一失效组合 = 同时落在按钮矩形内
 *    处置：**整个删除 Copy 按钮**（用户决定）。按钮消失后滚动区不再有覆盖层，
 *    任何起点的手势都能到达 ScrollView；同时少了 Pressable 覆盖层，
 *    代码块也不再被误触。
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
          {/*
           * 这里必须是 minWidth 而不是 width（关键）：
           * - 原生测量本身就会给到固有宽度（见文件头第 5 条实测），探针只是"兜底"，
           *   用来在平台行为回归时仍能撑出溢出；
           * - 若写成 width，一旦探针值滞后于文本增长（流式期间必然滞后一个测量周期），
           *   显式宽度会**反向限制**文本 → 文本折行 + content 宽度被压到视口宽度
           *   → 横向可滚动范围归零，必须等一次重新布局（如弹出键盘）才恢复；
           * - minWidth 只保证"不小于固有宽度"，永不小于文本自身需求 → 无此风险。
           */}
          <Text
            selectable={false}
            style={[textStyle, contentWidth !== null ? { minWidth: contentWidth } : null]}
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
}
