export interface PrependInput {
  prevContentHeight: number
  newContentHeight: number
  y: number
}

/** 已 pin 到底部时，末尾消息 id/content 任一变化（含流式追加）→ 需要跟随滚动 */
export function computeFollow(
  pinned: boolean,
  prevId: string,
  prevContent: string,
  nextId: string,
  nextContent: string,
): boolean {
  if (!pinned) return false
  return prevId !== nextId || prevContent !== nextContent
}

/** 历史 prepend 后保持视口：offset 上移 diff（header/顶部增长量） */
export function computePrependAdjustment(prev: PrependInput, prepended: boolean): number {
  const diff = prev.newContentHeight - prev.prevContentHeight
  return prepended ? prev.y + diff : prev.y
}

/**
 * 判定是否发生了"历史 prepend"（头部插入新消息）：
 * 首元素 id 变化且末元素 id 不变才成立——避免把首次加载 / 追加 / 会话重置误判为 prepend。
 */
export function detectPrepend(
  prevFirstId: string | undefined,
  prevLastId: string | undefined,
  nextFirstId: string | undefined,
  nextLastId: string | undefined,
): boolean {
  if (!prevLastId) return false
  if (!nextFirstId || !nextLastId) return false
  return prevFirstId !== nextFirstId && prevLastId === nextLastId
}