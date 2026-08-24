import React, { useCallback, useMemo, useState } from 'react'
import {
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useThemeColors } from '../../theme/ThemeContext'
import type { ThemeColors } from '../../theme/colors'

/**
 * Markdown 表格渲染组件（替代 react-native-marked 内置 MDTable）。
 *
 * 内置实现的两个问题：
 * 1. 列宽固定 = windowWidth × (1.3/3) ≈ 43% 屏宽/列 → 表格几乎必然溢出屏幕；
 * 2. 横向 ScrollView 嵌在 inverted FlatList + TouchableOpacity 手势协商链里，
 *    Android 上横向拖动常被垂直滚动抢走 → "看得见一部分、滑不动看不全"。
 *
 * 本组件策略：
 * - 列宽按内容估算（CJK 全角计满宽），限定 [MIN_COL_WIDTH, MAX_COL_WIDTH]，
 *   单元格内自动换行；窄表把剩余宽度均分给各列铺满容器（无需滚动），
 *   宽表保持自然宽度并启用横向 ScrollView（nestedScrollEnabled 提升嵌套协商成功率）；
 * - 右上角 ⤢ 打开全屏查看器（Modal + 双向滚动），作为不依赖嵌套手势的保底手段。
 */

interface MarkdownTableProps {
  /** 表头单元格节点（react-native-marked Renderer.table 的 header 参数） */
  header: React.ReactNode[][]
  /** 数据行单元格节点（Renderer.table 的 rows 参数） */
  rows: React.ReactNode[][][]
}

/** 单元格字号（需与 cellTextStyle 保持一致） */
const CELL_FONT_SIZE = 13
const CELL_PADDING_X = 8
/** 单列最大占容器宽比例：超长内容换行而不是无限撑宽 */
const MAX_COL_WIDTH_RATIO = 0.72
/**
 * 视口断点适配的最小列宽（参考 DocNative 方案）
 * 小屏积极压缩、大屏宽松呼吸
 */
function getMinColWidth(screenWidth: number): number {
  if (screenWidth < 400) return 50 // 小屏手机
  if (screenWidth < 600) return 64 // 普通手机
  if (screenWidth < 900) return 80 // 平板竖屏
  return 100 // 平板横屏 / 桌面
}
/** 首屏容器宽度未知时的兜底值（窗口宽 − 聊天气泡左右边距估算） */
const WINDOW_WIDTH = Dimensions.get('window').width
const FALLBACK_CONTAINER_WIDTH = Math.max(WINDOW_WIDTH - 40, getMinColWidth(WINDOW_WIDTH))

/** 从 ReactNode 树提取纯文本（用于列宽估算） */
function extractText(node: unknown): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  const el = node as { props?: { children?: unknown } }
  if (el.props) return extractText(el.props.children)
  return ''
}

/** CJK / 全角字符判定 */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x3000 && code <= 0x9fff) || // CJK 符号 + 汉字
    (code >= 0xff00 && code <= 0xffef) || // 全角标点/字母
    (code >= 0xac00 && code <= 0xd7af) // 谚文
  )
}

/**
 * 按字符类别估算渲染宽度（参考 DocNative + react-native-markdown-stream 方案）。
 * - CJK 全角：整字宽 (1.0×fontSize)
 * - 特宽拉丁 (m/w/M/W)：0.85×
 * - 窄拉丁 (i/l/I/1/!  |)：0.4×
 * - 大写字母 A-Z：0.72×
 * - 数字 0-9：0.65×
 * - 其余拉丁小写/标点：0.58×
 */
function estimateCharWidth(char: string, fontSize: number): number {
  const code = char.codePointAt(0) ?? 0
  if (isWideChar(code)) return fontSize
  if (/[mwMW]/.test(char)) return fontSize * 0.85
  if (/[iIl!|1]/.test(char)) return fontSize * 0.4
  if (code >= 0x0041 && code <= 0x005a) return fontSize * 0.72 // A-Z
  if (code >= 0x0030 && code <= 0x0039) return fontSize * 0.65 // 0-9
  return fontSize * 0.58
}

function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const ch of text) {
    width += estimateCharWidth(ch, fontSize)
  }
  return width
}

/** 单个单元格的自然宽度：取最长一行的估算宽度 + 左右内边距 */
function cellNaturalWidth(node: React.ReactNode): number {
  const text = extractText(node)
  let maxLine = 0
  for (const line of text.split('\n')) {
    maxLine = Math.max(maxLine, estimateTextWidth(line, CELL_FONT_SIZE))
  }
  return Math.ceil(maxLine) + CELL_PADDING_X * 2
}

/** 计算每列自然宽度（被 header+rows 内容的最大值撑起），并夹在 [min, max] 区间 */
function computeNaturalWidths(
  header: React.ReactNode[][],
  rows: React.ReactNode[][][],
  containerWidth: number,
): number[] {
  const colCount = Math.max(header.length, ...rows.map((r) => r.length), 1)
  const minCol = getMinColWidth(containerWidth)
  const maxColWidth = Math.max(Math.floor(containerWidth * MAX_COL_WIDTH_RATIO), minCol)
  const widths = new Array<number>(colCount).fill(minCol)
  header.forEach((cell, i) => {
    widths[i] = Math.max(widths[i], cellNaturalWidth(cell))
  })
  rows.forEach((row) =>
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], cellNaturalWidth(cell))
    }),
  )
  return widths.map((w) => Math.min(w, maxColWidth))
}

/**
 * 列宽分配策略（参考 DocNative + react-native-markdown-stream）。
 *
 * 1. 放得下 → 均分剩余宽度铺满容器（免滚动）
 * 2. 稍微溢出 → 按比例压缩各列至容器宽度（消除滚动）
 * 3. 严重溢出 → 保留自然宽度，交给横向 ScrollView
 *
 * @param natural 各列自然宽度
 * @param containerWidth 可用容器宽度
 */
export function fitColumnWidths(natural: number[], containerWidth: number): number[] {
  if (natural.length === 0) return []
  const total = natural.reduce((sum, w) => sum + w, 0)

  // 1. 放得下：均分剩余空间铺满
  if (total <= containerWidth) {
    const extra = (containerWidth - total) / natural.length
    return natural.map((w) => Math.floor(w + extra))
  }

  // 2. 溢出：尝试按比例压缩
  //    每列最低保留自然宽度的 50%（可读性底线）
  const FLOOR_RATIO = 0.5
  const minCol = getMinColWidth(containerWidth)
  const floors = natural.map((w) => Math.max(Math.floor(w * FLOOR_RATIO), minCol))
  const floorTotal = floors.reduce((s, w) => s + w, 0)

  // 如果均分后每列宽度太窄（<40px），放弃压缩，交给 ScrollView
  const avgIfCompressed = containerWidth / natural.length
  if (avgIfCompressed < 40 || floorTotal >= containerWidth) {
    return natural
  }

  // 按比例分配容器宽度：宽列分得多、窄列分得少
  const excessTotal = total - floorTotal
  const slack = containerWidth - floorTotal
  return natural.map((w, i) => {
    const excess = w - floors[i]
    const share = excessTotal > 0 ? (excess / excessTotal) * slack : 0
    return Math.floor(floors[i] + share)
  })
}

interface RowProps {
  cells: React.ReactNode[]
  widths: number[]
  colors: ThemeColors
  header?: boolean
}

function TableRow({ cells, widths, colors, header }: RowProps): React.ReactElement {
  const styles = makeStyles(colors)
  return (
    <View style={[styles.row, header && styles.headerRow]}>
      {widths.map((width, i) => (
        <View
          key={i}
          style={[
            styles.cell,
            i < widths.length - 1 && styles.cellBordered,
            { width },
            header && { backgroundColor: colors.surfaceVariant },
          ]}
        >
          {cells[i] != null ? (
            cells[i]
          ) : (
            <Text style={styles.emptyCell}>{''}</Text>
          )}
        </View>
      ))}
    </View>
  )
}

/** 表格主体（给定列宽渲染全部行列），供内嵌视图与全屏查看器复用 */
function TableBody({
  header,
  rows,
  widths,
  colors,
}: {
  header: React.ReactNode[][]
  rows: React.ReactNode[][][]
  widths: number[]
  colors: ThemeColors
}): React.ReactElement {
  const styles = makeStyles(colors)
  return (
    <View style={[styles.table, { borderColor: colors.markdownBorder }]}>
      <TableRow cells={header} widths={widths} colors={colors} header />
      {rows.map((row, r) => (
        <TableRow key={r} cells={row} widths={widths} colors={colors} />
      ))}
    </View>
  )
}

export const MarkdownTable: React.FC<MarkdownTableProps> = ({ header, rows }) => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)

  // 容器实测宽度：首帧用窗口宽兜底，onLayout 后修正（聊天气泡比窗口窄）
  const [containerWidth, setContainerWidth] = useState(FALLBACK_CONTAINER_WIDTH)
  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width
    if (w > 0 && Math.abs(w - containerWidth) > 1) setContainerWidth(w)
  }, [containerWidth])

  const naturalWidths = useMemo(
    () => computeNaturalWidths(header, rows, containerWidth),
    [header, rows, containerWidth],
  )
  const fittedWidths = useMemo(
    () => fitColumnWidths(naturalWidths, containerWidth),
    [naturalWidths, containerWidth],
  )
  const overflow = useMemo(() => {
    const total = naturalWidths.reduce((sum, w) => sum + w, 0)
    return total > containerWidth
  }, [naturalWidths, containerWidth])

  const [viewerVisible, setViewerVisible] = useState(false)
  // Modal 内部宽度：onLayout 后修正，首帧用窗口宽兜底
  const [modalWidth, setModalWidth] = useState(Dimensions.get('window').width)
  const onModalLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width
    if (w > 0) setModalWidth(w)
  }, [])
  const modalWidths = useMemo(
    () => fitColumnWidths(naturalWidths, modalWidth),
    [naturalWidths, modalWidth],
  )
  const modalOverflow = useMemo(() => {
    const total = naturalWidths.reduce((sum, w) => sum + w, 0)
    return total > modalWidth
  }, [naturalWidths, modalWidth])

  return (
    <View>
      <View style={styles.embedWrap} onLayout={onLayout} testID="md-table">
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={overflow}
          testID="md-table-scroll"
        >
          <TableBody header={header} rows={rows} widths={fittedWidths} colors={colors} />
        </ScrollView>

        {/* 保底入口：不依赖嵌套手势协商，任何情况下都能看全 */}
        <TouchableOpacity
          style={styles.expandButton}
          onPress={() => setViewerVisible(true)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          accessibilityLabel="全屏查看表格"
          accessibilityRole="button"
          testID="md-table-expand"
        >
          <Text style={styles.expandIcon}>⤢</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={viewerVisible}
        transparent={false}
        animationType="slide"
        onRequestClose={() => setViewerVisible(false)}
        testID="md-table-modal"
      >
        <View style={[styles.viewerContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.viewerHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.viewerTitle, { color: colors.text }]}>表格视图</Text>
            <TouchableOpacity
              onPress={() => setViewerVisible(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="关闭表格视图"
              accessibilityRole="button"
              testID="md-table-modal-close"
            >
              <Text style={[styles.viewerClose, { color: colors.primary }]}>✕</Text>
            </TouchableOpacity>
          </View>
          {/* 横向滚动：无需外层垂直 ScrollView（单表无纵向内容），避免手势竞争 */}
          <ScrollView
            horizontal
            style={styles.viewerBody}
            onLayout={onModalLayout}
            nestedScrollEnabled
            showsHorizontalScrollIndicator={modalOverflow}
          >
            <TableBody header={header} rows={rows} widths={modalWidths} colors={colors} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    embedWrap: {
      borderRadius: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.markdownBorder,
      overflow: 'hidden',
      marginVertical: 4,
    },
    table: {
      alignSelf: 'flex-start',
    },
    row: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.markdownBorder,
    },
    headerRow: {
      borderBottomWidth: 1,
      borderBottomColor: colors.markdownBorder,
    },
    cell: {
      paddingHorizontal: CELL_PADDING_X,
      paddingVertical: 6,
      justifyContent: 'center',
    },
    cellBordered: {
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.markdownBorder,
    },
    emptyCell: {
      color: colors.markdownText,
      fontSize: CELL_FONT_SIZE,
      lineHeight: 18,
    },
    expandButton: {
      position: 'absolute',
      top: 2,
      right: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceVariant,
      opacity: 0.9,
    },
    expandIcon: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 14,
    },
    viewerContainer: {
      flex: 1,
    },
    viewerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 48,
      paddingBottom: 10,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
    },
    viewerTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    viewerClose: {
      fontSize: 20,
      padding: 4,
    },
    viewerBody: {
      flex: 1,
      padding: 12,
    },
  })
