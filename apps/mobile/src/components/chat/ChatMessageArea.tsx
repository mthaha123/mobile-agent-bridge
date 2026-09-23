import React, { useMemo } from 'react'
import { useChatStore, type ChatMessage } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { MessageList } from './MessageList'
import { mergeConsecutiveAssistantMsgs } from './mergeAssistantMessages'

export interface ChatMessageAreaProps {
  renderMessage: (item: ChatMessage) => React.ReactElement
  thinkingIndicator?: React.ReactElement
  historyHint?: React.ReactElement
  hasMoreHistory: boolean
  historyLoading: boolean
  onLoadMoreHistory: () => void
}

/**
 * 消息区：整个聊天屏里**唯一**订阅 `chatStore.messages` 的组件。
 *
 * 背景（流式卡顿根因）：`ChatScreen` 原先直接订阅 `messages`，于是每个 80ms 的
 * 流式 flush 都会重渲染整屏（header / dock / 输入框 / 列表）。React 会为整屏的
 * host 节点重新创建 element，Fabric 随之对整棵聊天屏视图树做一次 commit ——
 * 显示列表被整屏重录 + GPU 重放。开销与**屏幕节点总量**成正比，与本次 delta 内容无关
 * （实测：纯文本与 markdown 一样卡；流式消息滚出屏幕也一样卡；推到非活跃会话则完全不卡）。
 *
 * 方案：把 `messages` 订阅下沉到本组件（消息列表子树）。流式 flush 只让本组件重渲染，
 * `ChatScreen` 的其余部分 element 引用不变 → React 在边界处 bail out → Fabric 跳过
 * 这些子树。这样每次 flush 的 commit 范围从「整屏」缩小到「消息列表」。
 *
 * 注意：`React.memo` 只挡父级重渲染；store 订阅仍会让本组件在消息变化时重渲染（预期）。
 */
export const ChatMessageArea: React.FC<ChatMessageAreaProps> = React.memo((props) => {
  const messages = useChatStore((s) => s.messages)
  const chatDisplayMode = useSettingsStore((s) => s.chatDisplayMode)

  // 渲染层合并连续 assistant 消息（仅 grouped 模式）：SDK v2 的思考/工具/文本是独立
  // message，实时流式与历史加载统一在此合并，store 数据保持逐条不变
  const displayMessages = useMemo(
    () => (chatDisplayMode === 'grouped' ? mergeConsecutiveAssistantMsgs(messages) : messages),
    [messages, chatDisplayMode],
  )

  return (
    <MessageList
      messages={displayMessages}
      renderMessage={props.renderMessage}
      thinkingIndicator={props.thinkingIndicator}
      historyHint={props.historyHint}
      hasMoreHistory={props.hasMoreHistory}
      historyLoading={props.historyLoading}
      onLoadMoreHistory={props.onLoadMoreHistory}
    />
  )
})

ChatMessageArea.displayName = 'ChatMessageArea'
