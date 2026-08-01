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
import { useConfigStore } from '../stores/configStore'
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

    const call = client.call.bind(client)
    useConfigStore.getState().fetchAgents(call)
    useConfigStore.getState().fetchProviders(call)
    useConfigStore.getState().fetchCommands(call)
    useConfigStore.getState().fetchModels(call)
    useConfigStore.getState().fetchVcs(call)
    useConfigStore.getState().fetchConfig(call)

    client.on('notification', (method: string, payload: any) => {
      // 流式文本增量（带 eventId 排序重组；SDK v3 的 eventId 是 evt_ 字符串 → 走到达顺序）
      if (method === 'session.next.text.delta') {
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
        const text = payload?.text || ''
        const msgId = payload?.assistantMessageID || ''
        if (text && msgId) {
          useChatStore.getState().finalizeAssistantContent(msgId, text)
        }
        useChatStore.getState().setWaiting(false)
      }

      // 推理增量（带 eventId 排序重组）
      if (method === 'session.next.reasoning.delta') {
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
        })
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
        useChatStore.getState().setWaiting(true)
      }

      // 步骤结束
      if (method === 'session.next.step.ended') {
        useChatStore.getState().setWaiting(false)
      }

      // 步骤失败
      if (method === 'session.next.step.failed') {
        useChatStore.getState().setWaiting(false)
        const errorMsg = payload?.error?.message || payload?.error || 'Unknown error'
        useChatStore.getState().addMessage({
          role: 'system',
          content: `AI step failed: ${typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)}`,
        })
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
        if (statusType === 'idle') {
          useChatStore.getState().setWaiting(false)
        } else if (statusType === 'busy') {
          useChatStore.getState().setWaiting(true)
        }
        const sid = payload?.sessionID || ''
        if (sid) {
          const info = payload?.session || payload
          useSessionStore.getState().patchSession(sid, info)
        }
      }

      // 回复完成
      if (method === 'session.idle') {
        useChatStore.getState().setWaiting(false)
      }

      // 回复出错
      if (method === 'session.error') {
        useChatStore.getState().setWaiting(false)
        const errorMsg = payload?.error || 'unknown error'
        useChatStore.getState().addMessage({
          role: 'system',
          content: `Error: ${errorMsg}`,
        })
      }

      // ─── 通用 fallback：未单独处理的 *.failed / *.error 事件 ───
      // 防止新的事件类型导致 UI 死锁（waiting 停不下来）
      if (
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
        useChatStore.getState().addMessage({
          role: 'system',
          content: `${method}: ${typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg)}`,
        })
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
