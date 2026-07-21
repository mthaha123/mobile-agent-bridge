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

    client.on('notification', (method: string, payload: any) => {
      // 流式文本增量（带 eventId 排序重组）
      if (method === 'session.next.text.delta') {
        const delta = payload?.delta || ''
        const msgId = payload?.assistantMessageID || ''
        const eventId = payload?.eventId
        if (delta && msgId && typeof eventId === 'number') {
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
        if (delta && msgId && typeof eventId === 'number') {
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
        if (delta && msgId && typeof eventId === 'number') {
          useChatStore.getState().appendAssistantDelta(msgId, delta, eventId)
        } else if (delta) {
          useChatStore.getState().updateLastAssistant(delta)
        }
      }

      // 推理段结束（推进 stream 计数器，无权威文本可 finalize）
      if (method === 'session.next.reasoning.ended') {
        const msgId = payload?.assistantMessageID || ''
        const eventId = payload?.eventId
        if (msgId && typeof eventId === 'number') {
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
      }

      // 工具失败
      if (method === 'session.next.tool.failed') {
        useToolProgressStore.getState().markFailed(
          payload?.callID || '',
          payload?.error,
        )
      }

      // 步骤开始
      if (method === 'session.next.step.started') {
        useChatStore.getState().setWaiting(true)
      }

      // 步骤结束
      if (method === 'session.next.step.ended') {
        useChatStore.getState().setWaiting(false)
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

      // 审批结果确认
      if (method === 'permission.v2.replied') {
        useToolStore.getState().dequeue(payload?.id || '')
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
