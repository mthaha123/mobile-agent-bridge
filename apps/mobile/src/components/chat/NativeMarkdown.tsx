/**
 * NativeMarkdown — C1 原生引擎流式渲染。
 *
 * 增量策略：store 侧只给整串 content（不改管道）；本组件维护 lastRef，
 *  - 新内容是旧内容的严格后缀（流式增长）→ 只 append 差量（原生增量 AST 复用）
 *  - 否则（首帧 / 权威快照覆盖 / 切会话历史）→ session.reset 整篇
 *  - append 失败（如非法 range）→ reset 兜底，不向上抛
 * ⚠️ 只用 append(string)/reset(text)，不用 getTextRange()/replace()：
 *    session range 是 UTF-16 码元，跨 emoji 会报 invalid_range。
 *
 * API 依据（已对安装包 lib/typescript d.ts 核实）：
 *  - useMarkdownSession() 返回 controller，含 getSession(): MarkdownSession 与 reset(text)
 *  - MarkdownSession.nitro: append(chunk: string): number / reset(text: string): void
 *  - MarkdownStreamProps = streaming options & Omit<MarkdownProps,'children'|'sourceAst'>
 */
import React, { memo, useEffect, useRef } from 'react'
import { MarkdownStream, useMarkdownSession } from 'react-native-nitro-markdown'

export interface NativeMarkdownProps {
  content: string
}

export const NativeMarkdown: React.FC<NativeMarkdownProps> = memo(({ content }) => {
  const session = useMarkdownSession()
  const lastRef = useRef('')

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

  return <MarkdownStream session={session} updateStrategy="raf" incrementalParsing />
})
