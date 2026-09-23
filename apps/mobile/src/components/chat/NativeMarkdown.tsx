/**
 * NativeMarkdown — C1 原生引擎流式渲染（v2：React 侧冻结块 + 零解析快路）。
 *
 * Gate A' 归因：`MarkdownStream` 每次 listener→setState→React 重建整棵元素树，缺
 * legacy 侧的冻结块/memo 缓解 → 长文 JS CPU 反超（+99%）。v2 补上缺的那半边：
 *   1. 冻结块：splitStablePrefix + accumulateChunks（复用 legacy 实现与不变量），
 *      FrozenChunk memo(text+themeKey) —— text/theme 不变即 bail，不渲染=不解析；
 *   2. 尾部快路：未闭合围栏 / 纯文本尾部复用 legacy 零解析组件；
 *   3. 真 markdown 尾部走 <Markdown>（原生 C++ 解析 ~100 字符）。
 * 主题/样式经 markdownProps 透传给每个 <Markdown>。
 *
 * ⚠️ Gate A'' 实测（见设计文档附录）：v2 仍 FAIL —— 短路实验证明原生内容管线
 * （session+增量 AST）无辜，残余成本在「native 渲染的大消息 + 每次 update 的整批
 * Fabric commit」（单批 56–140ms、随消息体量增长）。因此 flag 保持 legacy，本组件
 * 仅在 flag 翻转/后续优化时启用。
 *
 * 内容管道：store 只给整串 content；lastRef 后缀 diff → session.append 差量，
 * 非前缀 → session.reset；异常 → reset 兜底。只用 append(string)/reset(text)
 * （UTF-16 range 跨 emoji 会 invalid_range，规避）。
 */
import React, { memo, useCallback, useEffect, useRef } from 'react'
import {
  Markdown,
  MarkdownStream,
  useMarkdownSession,
  type MarkdownStreamRenderProps,
} from 'react-native-nitro-markdown'
import { useThemeColors } from '../../theme/ThemeContext'
import {
  accumulateChunks,
  isOpenFenceTail,
  isPlainTextTail,
  splitStablePrefix,
  PlainTextTail,
  StreamingCodeTail,
  type FrozenChunks,
} from './MarkdownRenderer'

export interface NativeMarkdownProps {
  content: string
}

type MarkdownProps = MarkdownStreamRenderProps['markdownProps']

interface FrozenChunkProps {
  text: string
  markdownProps: MarkdownProps
  /** 主题指纹：仅用于 memo 比较（markdownProps 每次都是新对象，不能直接比） */
  themeKey: string
}

/**
 * 冻结块（memo）：text 与主题都没变 → bail out，React 不重建子树、原生也不再解析。
 * comparator 刻意忽略 markdownProps 的引用（每次 update 都是新对象），只比 text+themeKey。
 */
const FrozenChunk: React.FC<FrozenChunkProps> = memo(
  ({ text, markdownProps }) => <Markdown {...markdownProps}>{text}</Markdown>,
  (a, b) => a.text === b.text && a.themeKey === b.themeKey,
)

export const NativeMarkdown: React.FC<NativeMarkdownProps> = memo(({ content }) => {
  const colors = useThemeColors()
  const session = useMarkdownSession()
  const lastRef = useRef('')
  const frozen = useRef<FrozenChunks>({ text: '', chunks: [] })

  // ── 内容管道：后缀追加走 append（原生增量），替换/回退走 reset；异常 reset 兜底 ──
  useEffect(() => {
    const last = lastRef.current
    if (content === last) return
    try {
      if (last && content.startsWith(last) && content.length > last.length) {
        session.getSession().append(content.slice(last.length))
      } else {
        session.reset(content)
      }
    } catch {
      session.reset(content)
    } finally {
      lastRef.current = content
    }
  }, [content, session])

  // 主题与 legacy 对齐：text/code_block/link/border 四色跟随 app 暗色
  const styles = {
    text: { color: colors.markdownText },
    code_block: { backgroundColor: colors.markdownCodeBg },
    link: { color: colors.markdownLink },
    blockquote: { borderColor: colors.markdownBorder },
  }

  const renderMarkdown = useCallback(({ text, markdownProps }: MarkdownStreamRenderProps) => {
    const { stable, tail, openFenceAtEnd } = splitStablePrefix(text)
    const next = accumulateChunks(frozen.current, stable)
    if (next !== frozen.current) frozen.current = next
    // 主题指纹：styles/theme 变了（如切暗色）让冻结块整体失效重建
    const themeKey =
      JSON.stringify((markdownProps as { styles?: unknown }).styles ?? {}) +
      JSON.stringify((markdownProps as { theme?: unknown }).theme ?? {})
    return (
      <>
        {frozen.current.chunks.map((c, i) => (
          <FrozenChunk key={`c${i}`} text={c} markdownProps={markdownProps} themeKey={themeKey} />
        ))}
        {tail.length > 0 ? (
          openFenceAtEnd && isOpenFenceTail(tail) ? (
            <StreamingCodeTail key="tail" text={tail} />
          ) : isPlainTextTail(tail) ? (
            <PlainTextTail key="tail" text={tail} />
          ) : (
            // tail 与冻结块共用同一 memo：updateStrategy=raf 会在 120ms 间隔内的
            // 每个空帧都触发 renderMarkdown，text 未变必须 bail —— 否则每帧都
            // native 解析 + 重建子树 + Fabric mount（实测 JS 14.93s / p90 350ms）。
            <FrozenChunk key="tail" text={tail} markdownProps={markdownProps} themeKey={themeKey} />
          )
        ) : null}
      </>
    )
  }, [])

  return (
    <MarkdownStream
      session={session}
      updateStrategy="raf"
      incrementalParsing
      styles={styles}
      renderMarkdown={renderMarkdown}
    />
  )
})
