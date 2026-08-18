import React, { useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useToolStore } from '../stores/toolStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'
import { useToolProgressStore } from '../stores/toolProgressStore'
import { useDiffStore } from '../stores/diffStore'
import { useTodoStore } from '../stores/todoStore'
import { useQuestionStore } from '../stores/questionStore'
import { BridgeClient } from '../services/BridgeClient'
import { setToolReplyCall } from '../screens/ToolApprovalSheet'
import { setQuestionReplyCall, setQuestionRejectCall } from '../screens/QuestionSheet'

/** 从 SSE tool.success payload 提取可展示输出文本（content 数组 → 拼接 text） */
function extractToolResult(payload: any): string {
  if (Array.isArray(payload?.content)) {
    return payload.content
      .filter((c: any) => c && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
  }
  if (typeof payload?.result === 'string') return payload.result
  if (payload?.structured) return JSON.stringify(payload.structured)
  return ''
}

function createReplyCall(client: BridgeClient): (id: string, reply: 'once' | 'always' | 'reject') => Promise<void> {
  return async (id: string, reply: 'once' | 'always' | 'reject') => {
    const { pendingApprovals } = useToolStore.getState()
    const item = pendingApprovals.find((a) => a.id === id)
    if (!item) return
    await client.call('permission.reply', {
      sessionId: item.sessionId,
      id,
      reply,
    })
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const clientRef = useRef<BridgeClient | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (state.client && state.client !== prev.client) {
        if (prev.client) prev.client.destroy()
        setupClient(state.client)
      } else if (!state.client && prev.client) {
        teardownClient()
      }
    })

    return () => {
      unsub()
      teardownClient()
    }
  }, [])

  function setupClient(client: BridgeClient) {
    clientRef.current = client

    refreshTimerRef.current = setInterval(() => {
      useAuthStore.getState().refreshToken()
    }, 25 * 60 * 1000)

    setToolReplyCall(createReplyCall(client))
    setQuestionRejectCall(async (id: string) => {
      const found = useQuestionStore.getState().pending.find((q) => q.id === id)
      if (!found) return
      await client.call('question.reject', { id, sessionId: found.sessionId })
    })
    setQuestionReplyCall(async (id: string, answers: string[]) => {
      const found = useQuestionStore.getState().pending.find((q) => q.id === id)
      if (!found) return
      await client.call('question.reply', { id, sessionId: found.sessionId, answers })
    })

    // 配置拉取由 authStore.login 在 project.switch 建立 OpenCode 连接后显式驱动，
    // 保证时序：连接 → 切项目 → 拉配置 → 进入主界面

    client.on('notification', (method: string, payload: any) => {
      // 事件属于哪个会话：仅当携带 sessionID 且与当前打开的会话不一致时忽略。
      // 防止"别处会话正在更新"的流式内容错贴到当前页面。
      const isForActiveSession = () => {
        const sid = payload?.sessionID
        const active = useChatStore.getState().activeSessionId
        if (!sid || !active) return true
        return sid === active
      }

      // 新用户消息入列（远程/其它端在同样会话里发消息）：插入 user 消息
      if (method === 'session.next.prompt.admitted' || method === 'session.next.prompted') {
        if (!isForActiveSession()) return
        // 新一轮对话开始：清除上一次的失败提示
        useChatStore.getState().clearRunError()
        const messageID = payload?.messageID || ''
        const text = payload?.prompt?.text || payload?.prompt || ''
if (messageID && text) {
          const ts = typeof payload?.timestamp === 'number' ? payload.timestamp : undefined
          useChatStore.getState().upsertUserMessage(messageID, typeof text === 'string' ? text : '', ts)
        }
      }

      // AI 回复开始：预建 assistant 占位，保证 delta 能精确落到这条消息
      if (method === 'session.next.text.started') {
        if (!isForActiveSession()) return
        useChatStore.getState().ensureAssistantMessage(payload?.assistantMessageID || '')
        useChatStore.getState().setWaiting(true)
      }

      // 流式文本增量（带 eventId 排序重组；SDK v3 的 eventId 是 evt_ 字符串 → 走到达顺序）
      if (method === 'session.next.text.delta') {
        if (!isForActiveSession()) return
        const delta = payload?.delta || ''
        const msgId = payload?.assistantMessageID || ''
        const eventId = payload?.eventId
        if (delta && msgId && eventId != null) {
          useChatStore.getState().appendAssistantDelta(msgId, delta, eventId)
        } else if (delta) {
          useChatStore.getState().updateLastAssistant(delta)
        }
      }

      // SDK Part 字段增量（备选流式通道）
      if (method === 'message.part.delta') {
        if (!isForActiveSession()) return
        const delta = payload?.data?.delta || payload?.delta || ''
        const msgId = payload?.assistantMessageID || payload?.data?.assistantMessageID || ''
        const eventId = payload?.eventId
        if (delta && msgId && eventId != null) {
          useChatStore.getState().appendAssistantDelta(msgId, delta, eventId)
        } else if (delta) {
          useChatStore.getState().updateLastAssistant(delta)
        }
      }

      // 文本段结束（用完整文本修正乱序/重复）
      if (method === 'session.next.text.ended') {
        if (!isForActiveSession()) return
        const text = payload?.text || ''
        const msgId = payload?.assistantMessageID || ''
        if (text && msgId) {
          useChatStore.getState().finalizeAssistantContent(msgId, text)
        }
        useChatStore.getState().setWaiting(false)
      }

      // 整条消息更新（权威全量）：覆盖当前会话中已存在/新增的消息
      if (method === 'message.updated') {
        if (!isForActiveSession()) return
        const info = payload?.info || payload?.message || {}
        const messageID = info?.id || ''
        const role = info?.role === 'user' ? 'user' : 'assistant'
        let text = ''
        if (Array.isArray(info?.content)) {
          text = (info.content as any[])
            .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text)
            .join('')
        } else if (typeof info?.content === 'string') {
          text = info.content
        } else if (typeof info?.text === 'string') {
          text = info.text
        }
        if (messageID && text) {
          const created = info?.time?.created ?? payload?.timestamp
          useChatStore.getState().applyServerMessage(role, messageID, text, typeof created === 'number' ? created : undefined)
        }
      }

      // 单个 Part 更新（text part → 覆盖内容；音频/文件类忽略）
      if (method === 'message.part.updated') {
        if (!isForActiveSession()) return
        const part = payload?.part || {}
        if (part?.type === 'text' && typeof part?.text === 'string' && part?.messageID) {
          // 仅当权威完整文本不短于当前流式拼接结果时覆盖，避免打断进行中的流式
          const current = useChatStore.getState().messages.find((m) => m.messageID === part.messageID)
          const curLen = current?.content?.length ?? 0
          if (part.text.length >= curLen) {
            const created = part?.time?.created ?? payload?.timestamp
            useChatStore.getState().applyServerMessage('assistant', part.messageID, part.text, typeof created === 'number' ? created : undefined)
          }
        }
      }

      // 推理增量（带 eventId 排序重组）
      if (method === 'session.next.reasoning.delta') {
        if (!isForActiveSession()) return
        const delta = payload?.delta || ''
        const msgId = payload?.assistantMessageID || ''
        const eventId = payload?.eventId
        if (delta && msgId && eventId != null) {
          useChatStore.getState().appendAssistantDelta(msgId, delta, eventId)
        } else if (delta) {
          useChatStore.getState().updateLastAssistant(delta)
        }
      }

      // 推理段结束（推进 stream 计数器，无权威文本可 finalize）
      if (method === 'session.next.reasoning.ended') {
        if (!isForActiveSession()) return
        const msgId = payload?.assistantMessageID || ''
        const eventId = payload?.eventId
        if (msgId && eventId != null) {
          useChatStore.getState().advanceStreamId(msgId, eventId)
        }
        useChatStore.getState().setWaiting(false)
      }

      // 工具被调用
      if (method === 'session.next.tool.called') {
        useToolProgressStore.getState().addCall({
          callID: payload?.callID || '',
          sessionId: payload?.sessionID || '',
          tool: payload?.tool || '',
          input: payload?.input || {},
        })
        useChatStore.getState().addToolPart({
          id: payload?.callID || '',
          type: 'tool',
          data: {
            tool: payload?.tool || '',
            input: payload?.input || {},
            status: 'called',
          },
        }, payload?.assistantMessageID)
        // 预埋：serve 未发 permission.v2.asked 时，工具调用也可进入审批队列。
        // 仅当工具尚未在待审批队列中时 enqueue，避免与 permission.v2.asked 双弹。
        {
          const callID = payload?.callID || ''
          const tool = payload?.tool || ''
          const sessionId = payload?.sessionID || ''
          const input = payload?.input || {}
          const alreadyPending = useToolStore
            .getState()
            .pendingApprovals.some((a) => a.id === callID || (a.tool === tool && a.sessionId === sessionId))
          if (callID && !alreadyPending) {
            useToolStore.getState().enqueue({
              id: callID,
              tool,
              args: input as Record<string, unknown>,
              sessionId,
              requestedAt: Date.now(),
            })
          }
        }
      }

      // 工具执行进度
      if (method === 'session.next.tool.progress') {
        useToolProgressStore.getState().updateProgress(
          payload?.callID || '',
          { structured: payload?.structured, content: payload?.content },
        )
      }

      // 工具成功
      if (method === 'session.next.tool.success') {
        useToolProgressStore.getState().markSuccess(
          payload?.callID || '',
          payload?.content,
          payload?.result,
          payload?.outputPaths,
        )
        useChatStore.getState().updateToolPart(payload?.callID || '', {
          status: 'success',
          result: extractToolResult(payload),
        })
      }

      // 工具失败
      if (method === 'session.next.tool.failed') {
        useToolProgressStore.getState().markFailed(
          payload?.callID || '',
          payload?.error,
        )
        useChatStore.getState().updateToolPart(payload?.callID || '', {
          status: 'failed',
          error: payload?.error,
        })
      }

      // 步骤开始
      if (method === 'session.next.step.started') {
        if (isForActiveSession()) {
          useChatStore.getState().setWaiting(true)
        }
      }

      // 步骤结束
      if (method === 'session.next.step.ended') {
        if (isForActiveSession()) {
          useChatStore.getState().setWaiting(false)
        }
      }

      // 步骤失败：结束本次对话并醒目展示错误（红色错误条），输入框恢复可用
      if (method === 'session.next.step.failed') {
        if (!isForActiveSession()) return
        useChatStore.getState().setWaiting(false)
        const errorMsg = payload?.error?.message || payload?.error || 'Unknown error'
        const err = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)
        useChatStore.getState().setRunError(err)
      }

      // 工具审批请求 v2
      if (method === 'permission.v2.asked') {
        useToolStore.getState().enqueue({
          id: payload?.id || 'unknown',
          tool: payload?.action || 'unknown',
          args: { resources: payload?.resources || [] } as Record<string, unknown>,
          sessionId: payload?.sessionID || '',
          requestedAt: Date.now(),
        })
      }

      // 审批结果确认（SDK 可能用 requestID 或 id）
      if (method === 'permission.v2.replied') {
        useToolStore.getState().dequeue(payload?.requestID || payload?.id || '')
      }

      // session 状态变更
      if (method === 'session.status') {
        const statusType = payload?.status?.type
        if (isForActiveSession()) {
          if (statusType === 'idle') {
            useChatStore.getState().setWaiting(false)
          } else if (statusType === 'busy') {
            useChatStore.getState().setWaiting(true)
          }
        }
        const sid = payload?.sessionID || ''
        if (sid) {
          const info = payload?.session || payload
          useSessionStore.getState().patchSession(sid, info)
        }
      }

      // 回复完成
      if (method === 'session.idle') {
        if (isForActiveSession()) {
          useChatStore.getState().setWaiting(false)
        }
      }

      // 回复出错
      if (method === 'session.error') {
        if (isForActiveSession()) {
          useChatStore.getState().setWaiting(false)
          const errorMsg = payload?.error || 'unknown error'
          useChatStore.getState().setRunError(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
        }
      }

      // ─── 通用 fallback：未单独处理的 *.failed / *.error 事件 ───
      // 防止新的事件类型导致 UI 死锁（waiting 停不下来）
      if (
        isForActiveSession() &&
        (method.endsWith('.failed') || method.endsWith('.error')) &&
        method !== 'session.next.tool.failed' &&
        method !== 'session.next.step.failed' &&
        method !== 'session.error'
      ) {
        useChatStore.getState().setWaiting(false)
        const errorMsg =
          payload?.error?.message ||
          payload?.error ||
          payload?.message ||
          `${method} (no details)`
        useChatStore.getState().setRunError(`${method}: ${typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)}`)
      }

      // 文件变更
      if (method === 'session.diff') {
        const sid = payload?.sessionID || ''
        const diffs = payload?.diff || []
        if (sid) {
          useDiffStore.getState().setDiffs(sid, diffs)
        }
      }

      // 待办更新
      if (method === 'todo.updated') {
        const sid = payload?.sessionID || ''
        const todos = payload?.todos || []
        if (sid) {
          useTodoStore.getState().setTodos(sid, todos)
        }
      }

      // 问答请求
      if (method === 'question.v2.asked') {
        useQuestionStore.getState().addQuestion({
          id: payload?.id || '',
          sessionId: payload?.sessionID || '',
          questions: payload?.questions || [],
          tool: payload?.tool,
        })
      }

      // 项目切换
      if (method === 'project.changed') {
        useProjectStore.getState().setProject({
          directory: payload?.directory || '',
          project: payload?.project,
        })
      }
    })

    client.on('auth_expired', () => {
      useAuthStore.getState().logout()
    })
  }

  function teardownClient() {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    refreshTimerRef.current = null
    setQuestionRejectCall(null)
    clientRef.current?.destroy()
    clientRef.current = null
  }

  return <>{children}</>
}
