import React, { memo, useMemo, useRef } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { TextStyle, ViewStyle } from 'react-native'
import { Renderer, useMarkdown } from 'react-native-marked'
import { MarkdownTable } from './MarkdownTable'
import { MarkdownCodeBlock } from './MarkdownCodeBlock'
import { useThemeColors, useThemeMode } from '../../theme/ThemeContext'

interface MarkdownRendererProps {
  content: string
}

/**
 * 覆写默认 Renderer 的 table() 与 code()：
 * - table()：内置 MDTable 列宽固定为 43% 屏宽/列且横向滚动在 inverted FlatList +
 *   TouchableOpacity 手势协商下经常失效（表格溢出屏幕又滑不动）。
 *   改用 MarkdownTable：自适应列宽 + 可靠横向滚动 + 全屏查看兜底。
 * - code()：内置实现未开 nestedScrollEnabled，嵌套滚动下横向拖动失效。
 *   改用 MarkdownCodeBlock：horizontal ScrollView + nestedScrollEnabled + 溢出检测。
 */
/** 渲染器实例序号：保证不同 MarkdownRenderer 实例的 key 命名空间互不冲突 */
let rendererSeq = 0

export class TableAwareRenderer extends Renderer {
  private readonly uid = `md${++rendererSeq}`
  private keySeq = 0

  /** 每次重新解析前归零：位置键从 0 起，同一文档位置的 key 跨渲染稳定 */
  resetKeys(): void {
    this.keySeq = 0
  }

  /**
   * 覆盖基类 getKey()。
   *
   * 基类实现是 `this.slugger.slug('react-native-marked-ele')`——github-slugger
   * 单调递增且**永不重置**，于是每次重新解析（流式每 80ms 一次）都产出全新的 key。
   * React 按 key 对齐子节点，key 全变 ⇒ 整棵 markdown 子树被判定为"全部删除 +
   * 全部新建"，Fabric 把每个节点重新 create + measure + layout。
   *
   * 实测（Android 模拟器 / 30k 字符长文 / 流式 12.5 次重渲染每秒）：
   *   主线程卡死在 View.<init> → ViewGroup.resolveLayoutParams → View.measure
   *   （debuggerd 实拍栈），CPU 打满 → 点击无响应、只能滚动；
   *   同时 slugger 内部 Set 无界增长（RES 每分钟涨数十 MB）。
   *
   * 改为"单次解析内自增的位置键"：同一文档前缀跨渲染 key 稳定，Fabric 只需 diff
   * 变化部分（流式追加时只有尾部节点重建），并顺带消除 slugger 的内存泄漏。
   */
  getKey(): string {
    return `${this.uid}-${this.keySeq++}`
  }

  code(
    text: string,
    _language?: string,
    containerStyle?: ViewStyle,
    textStyle?: TextStyle,
  ): React.ReactNode {
    return (
      <MarkdownCodeBlock
        key={this.getKey()}
        text={text}
        containerStyle={containerStyle}
        textStyle={textStyle}
      />
    )
  }

  table(header: React.ReactNode[][], rows: React.ReactNode[][][]): React.ReactNode {
    return <MarkdownTable key={this.getKey()} header={header} rows={rows} />
  }
}

// ─── 流式增量解析：稳定前缀 + 增长尾部 ──────────────────────────────

/**
 * 前缀末尾若是列表项 / 引用 / 缩进续行，在此切分会把一个块拆成两个块
 * （松列表↔紧列表、引用块分裂等）→ 渲染结果与整篇解析不一致，跳过。
 */
function isContinuationish(line: string): boolean {
  return (
    /^\s*([-*+]|\d+[.)])\s/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s{2,}\S/.test(line)
  )
}

/**
 * 找出内容中最后一个「安全块边界」，返回 { stable, tail }：
 * stable 为可冻结前缀（含边界处空行），tail 为尚在增长、每个 flush 都要重解析的尾部。
 *
 * 切分点必须落在「块边界」且**不破坏 markdown 语义**：
 *   - 只在空行（\n\n）处切；
 *   - 前缀里代码围栏必须闭合（否则会把围栏内的空行当块边界）；
 *   - 前缀最后一行不能是列表项/引用/缩进续行（否则会拆散同一个块）。
 * 找不到安全切分点时返回 stable=''，退化为整篇解析（与原行为一致，不会更差）。
 */
export function splitStablePrefix(content: string): { stable: string; tail: string; openFenceAtEnd: boolean } {
  // 单趟扫描（O(n)）：流式每个 flush 都会调用，不能在候选边界上反复切分整个前缀
  // （列表/引用密集的长文会让 O(n²) 退化成每秒数百 ms 的纯开销）。
  let offset = 0
  let openFence: string | null = null
  let prevNonBlank = ''
  let lastSafe = 0

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineEnd = Math.min(offset + line.length + 1, content.length)
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      const marker = fence[1][0]
      if (openFence === null) openFence = marker
      else if (openFence === marker) openFence = null
    } else if (
      line.trim() === '' &&
      openFence === null &&
      prevNonBlank !== '' &&
      !isContinuationish(prevNonBlank)
    ) {
      // 空行 + 围栏已闭合 + 前一个非空行不是续行 → 此处是安全块边界
      lastSafe = lineEnd
    }
    if (line.trim() !== '') prevNonBlank = line
    offset = offset + line.length + 1
  }

  const openFenceAtEnd = openFence !== null
  if (lastSafe <= 0) {
    // 无可冻结前缀 → 整篇交给尾部解析（与原行为一致，不会更差）
    return { stable: '', tail: content, openFenceAtEnd }
  }
  return { stable: content.slice(0, lastSafe), tail: content.slice(lastSafe), openFenceAtEnd }
}

// ─── 组件 ─────────────────────────────────────────────────────────

/**
 * 冻结块：text 不变则**永不重解析**（memo 挡住父级重渲染 + useMarkdown 以 value
 * 为 memo 依赖）。流式期间只有「尾部块」的 text 会变。
 */
const MarkdownChunk: React.FC<{ text: string }> = memo(({ text }) => {
  const colors = useThemeColors()
  const mode = useThemeMode()

  // ⚠️ theme 必须跨渲染保持引用稳定：react-native-marked 的 useMarkdown 内部以
  // [styles, theme, colorScheme] 为 memo 依赖，行内新建 theme 会让 styles/parser/
  // elements 三级 memo 全部失效 —— 即使 content 完全没变，每次父级重渲染仍会对
  // 整篇 markdown 重新 lex + parse。
  const theme = useMemo(
    () => ({
      colors: {
        code: colors.markdownCodeBg,
        link: colors.markdownLink,
        text: colors.markdownText,
        border: colors.markdownBorder,
      },
      spacing: {},
    }),
    [colors.markdownCodeBg, colors.markdownLink, colors.markdownText, colors.markdownBorder],
  )

  // 每个块独立 renderer 实例：块之间是兄弟节点，key 命名空间必须隔离
  const renderer = useMemo(() => new TableAwareRenderer(), [])

  let elements: React.ReactNode[] | null = null
  let failed = false
  try {
    // 解析前把位置键归零（详见 TableAwareRenderer.getKey 注释）
    renderer.resetKeys()
    elements = useMarkdown(text, {
      theme: theme as any,
      colorScheme: mode as any,
      renderer,
    })
  } catch {
    failed = true
  }

  if (failed || elements === null) {
    return <Text style={[styles.fallback, { color: colors.markdownText }]}>{text}</Text>
  }
  return <>{elements}</>
})

/**
 * 尾部是否为「未闭合代码围栏」：是则跳过 markdown 解析，直接按代码块渲染。
 * 只在 tail 以围栏开头时成立（否则尾部还含其它未完成块，交给 MarkdownChunk 正常解析）。
 */
export function isOpenFenceTail(tail: string): boolean {
  return /^\s*(`{3,}|~{3,})/.test(tail)
}

/**
 * 流式「未闭合代码围栏」的尾部渲染。
 *
 * 背景：围栏未闭合时 `splitStablePrefix` 找不到安全块边界（块语义要求围栏闭合），
 * 于是 tail = 整段代码；若走 `useMarkdown`，每个 flush 都会把整段代码**全量重解析**
 * （实测 16KB 文档：tail 平均 8.3KB、最大 16.6KB，207/208 次 flush 都在重解析）。
 *
 * 这里直接把纯文本按代码块样式渲染（单份 Text、不解析）—— 把「每次 flush 全量解析」
 * 降为**零解析**。围栏一旦闭合，边界推进 → 整块进入冻结块路径，由 MarkdownChunk 解析一次。
 */
const StreamingCodeTail: React.FC<{ text: string }> = memo(({ text }) => {
  const colors = useThemeColors()
  // 去掉开头的围栏行（含语言标注），只渲染代码正文
  const m = /^[ \t]*(?:`{3,}|~{3,})[^\n]*\n?/.exec(text)
  const body = m ? text.slice(m[0].length) : text
  // 刻意不用 MarkdownCodeBlock：它为了横滚会额外渲染一个隐藏探针（同一份文本渲染两遍）
  // 并触发 layout→setState，流式期间反而更贵。这里只渲染一份文本（长行换行），
  // 围栏闭合后自然切回带横滚的 MarkdownCodeBlock。
  return (
    <View testID="md-stream-code" style={[styles.streamCodeWrap, { backgroundColor: colors.markdownCodeBg }]}>
      <Text
        selectable={false}
        style={[styles.streamCodeText, { color: colors.markdownText }]}
      >
        {body}
      </Text>
    </View>
  )
})

/** 尾部是否为「无 markdown 语义的纯文本」（无换行、非列表项、无元字符） */
export function isPlainTextTail(tail: string): boolean {
  if (tail.length === 0) return false
  if (tail.includes('\n')) return false
  if (/^\s*([-+]|\d+[.)])\s/.test(tail)) return false
  if (/^\s*-{3,}\s*$/.test(tail)) return false // 分隔线 ---
  return !/[*_`~#>|[\]\\!&]/.test(tail)
}

/**
 * 纯文本尾部：无 markdown 语义 → 直接单节点 Text 渲染。
 * 结果与解析一致（纯文本 markdown 不改变字形），但省掉 useMarkdown 的解析与元素树开销。
 */
const PlainTextTail: React.FC<{ text: string }> = memo(({ text }) => {
  const colors = useThemeColors()
  return (
    <Text testID="md-plain-tail" style={[styles.plainTail, { color: colors.markdownText }]}>
      {text}
    </Text>
  )
})

/** 冻结块累积状态：text = 已冻结文本，chunks = 按边界切开的块（只增不改） */
export interface FrozenChunks {
  text: string
  chunks: string[]
}

/**
 * 把新的稳定前缀累积成冻结块列表。
 *
 * 关键不变量：**已产出的块永不改写**（否则 useMarkdown 会重新解析整篇 —— 实测
 * 单次 346ms）。边界推进时只把新增部分作为新块追加。
 * 内容被权威快照替换/回退（stable 不再以已冻结文本为前缀）时整组重建。
 */
export function accumulateChunks(prev: FrozenChunks, stable: string): FrozenChunks {
  if (!stable.startsWith(prev.text)) {
    return stable ? { text: stable, chunks: [stable] } : { text: '', chunks: [] }
  }
  if (stable.length === prev.text.length) return prev
  return { text: stable, chunks: [...prev.chunks, stable.slice(prev.text.length)] }
}

const MarkdownRendererInner: React.FC<MarkdownRendererProps> = ({ content }) => {
  const { stable, tail, openFenceAtEnd } = useMemo(() => splitStablePrefix(content), [content])
  // 冻结块跨渲染累积（只增不改，见 accumulateChunks 不变量）
  const frozen = useRef<FrozenChunks>({ text: '', chunks: [] })
  const next = accumulateChunks(frozen.current, stable)
  if (next !== frozen.current) frozen.current = next
  const chunks = frozen.current.chunks

  return (
    <View>
      {chunks.map((c, i) => (
        <MarkdownChunk key={`c${i}`} text={c} />
      ))}
      {tail.length > 0 ? (
        openFenceAtEnd && isOpenFenceTail(tail)
          ? <StreamingCodeTail key="tail" text={tail} />
          : isPlainTextTail(tail)
            ? <PlainTextTail key="tail" text={tail} />
            : <MarkdownChunk key="tail" text={tail} />
      ) : null}
    </View>
  )
}

/**
 * 流式 markdown 渲染器：把内容切成「冻结块 + 尾部块」。
 *
 * 背景：`useMarkdown` 以 content 为 memo 依赖 —— 流式期间 content 每个 flush 都变，
 * 于是**整篇** markdown（实测 30k 字符 / 1 万个 token 节点）被重新 lex + parse +
 * 重建 React 元素树，每秒 12.5 次（80ms flush）。Hermes 上单次全量解析 60–350ms
 * （实测 28.7k 字符 = 346ms），JS 线程长期 100%、主线程被 Fabric 挂载指令打满 →
 * 点击无响应、只能滚动（实测流式期间点「Files」页签无反应）。
 *
 * 方案：按**安全块边界**把已写完的部分切成若干「冻结块」，每块只解析一次并 memo
 * 住；只有尾部（最后一个未完成块）每个 flush 重新解析。实测真实长文（28.7k 字符）：
 * 尾部平均 219 字符、最大 902 字符；真机实测流式期间解析量从 ~1000ms/s 降到 ~4ms/s。
 *
 * 注意：不能把「稳定前缀」当作一个整体字符串去 memo —— 边界每推进一次，前缀字符串
 * 就变了，整篇会被重新解析（实测单次 346ms）。必须按块累积（accumulateChunks），
 * 边界推进时只解析新增的那一块。
 *
 * ⚠️ 导出名**不能**用 `memo()` 包：react-test-renderer 的
 * `findAllByType(MarkdownRenderer)` 依赖 fiber.type 是组件本体（memo 会把 fiber.type
 * 指向内层函数 → 测试全部找不到）。内容不变时不重解析由两层保证：
 *   1) `useMemo(..., [content])` —— content 不变则跳过切分；
 *   2) `MarkdownChunk` 的 `memo` —— 块文本不变则永不重解析。
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = MarkdownRendererInner

const styles = StyleSheet.create({
  fallback: { fontSize: 14, lineHeight: 22 },
  streamCodeWrap: {
    alignSelf: 'stretch',
    padding: 16,
  },
  streamCodeText: {
    fontSize: 16,
    lineHeight: 24,
    fontStyle: 'italic',
    fontWeight: '300',
  },
  plainTail: {
    fontSize: 16,
    lineHeight: 24,
    paddingVertical: 8,
  },
})
