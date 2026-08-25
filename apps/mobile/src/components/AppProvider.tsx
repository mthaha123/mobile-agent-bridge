import React, { useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useToolStore } from '../stores/toolStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'
import { useDiffStore } from '../stores/diffStore'
import { useTodoStore } from '../stores/todoStore'
import { useQuestionStore } from '../stores/questionStore'
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

    // 配置拉取由 authStore.login 在 project.switch 建立 OpenCode 连接后显式驱动，
    // 保证时序：连接 → 切项目 → 拉配置 → 进入主界面

    client.on('notification', (method: string, payload: any) => {
      // chat 相关事件统一交给 ingestEvent：会话过滤、工具 part 状态、
      // runError/waiting/pendingSteps 状态机均在 ingest 层处理
      useChatStore.getState().ingestEvent(method, payload)

      const p = payload ?? {}

      // session 状态 → sessionStore（非 chat 写入）
      if (method === 'session.status') {
        const sid = p.sessionID ?? ''
        if (sid) {
          const info = p.session || p
          useSessionStore.getState().patchSession(sid, info)
        }
      }

      // 工具执行完成/失败：清除审批队列残留（ingest 只负责 tool part 状态）
      if ((method === 'session.next.tool.success' || method === 'session.next.tool.failed') && p.callID) {
        useToolStore.getState().dequeue(p.callID)
      }

      // 工具审批请求入队
      if (method === 'permission.v2.asked') {
        const reqId = p.id || 'unknown'
        const callID = p.source?.callID
        useToolStore.getState().enqueue({
          id: reqId,
          tool: p.action || 'unknown',
          args: { resources: p.resources || [] } as Record<string, unknown>,
          sessionId: p.sessionID || '',
          requestedAt: Date.now(),
          sourceCallID: callID,
        })
      }

      // 审批结果确认（SDK 可能用 requestID 或 id）
      if (method === 'permission.v2.replied') {
        useToolStore.getState().dequeue(p.requestID || p.id || '')
      }

      // 文件变更
      if (method === 'session.diff') {
        const sid = p.sessionID || ''
        const diffs = p.diff || []
        if (sid) useDiffStore.getState().setDiffs(sid, diffs)
      }

      // 待办更新
      if (method === 'todo.updated') {
        const sid = p.sessionID || ''
        const todos = p.todos || []
        if (sid) useTodoStore.getState().setTodos(sid, todos)
      }

      // 问答请求
      if (method === 'question.v2.asked') {
        useQuestionStore.getState().addQuestion({
          id: p.id || '',
          sessionId: p.sessionID || '',
          questions: p.questions || [],
          tool: p.tool,
        })
      }

      // 服务端会话更新（手动重命名/自动命名）→ 实时同步列表标题
      // SDK v2 事件载荷: { info: Session }；兼容 { session } / 平铺结构
      if (method === 'session.updated') {
        const info = (p.info ?? p.session ?? p) as Record<string, unknown>
        const sid = typeof info?.id === 'string' ? info.id : ''
        const title = typeof info?.title === 'string' ? info.title : ''
        if (sid && title) {
          useSessionStore.getState().patchSession(sid, { name: title })
        }
      }

      // 项目切换
      if (method === 'project.changed') {
        useProjectStore.getState().setProject({
          directory: p.directory || '',
          project: p.project,
        })
      }
    })

    // 重连后的消息补拉见下方 'connected' 监听（幂等合入，不会与 ChatScreen 初始加载重复）

    // 连接/重连建立时校正当前会话状态。
    //
    // 背景：SSE 不重放历史事件，WS 断线断口内产生的通知（工具终态 tool.success/
    // failed、文本增量、session.idle 等）会永久丢失——表现为工具永远"运行中"、
    // 后续内容不再刷出，直到手动刷新。因此：
    //   1) 首次连接：仅拉权威 busy 快照（初始消息加载由 ChatScreen useEffect 负责）；
    //   2) 断线重连（本 bug 的主恢复路径）：额外幂等补拉当前会话消息
    //      （applyLoadedMessages 按 messageID 去重 + part 级对账，不会重复/回退），
    //      再拉权威 busy 快照校正红方块。
    let sawConnected = client.connected === true
    client.on('connected', () => {
      const wasReconnect = sawConnected
      sawConnected = true
      const activeId = useChatStore.getState().activeSessionId
      if (!activeId) return
      if (wasReconnect) {
        useChatStore.getState().syncSessionMessages(activeId, client.call.bind(client)).catch(() => {})
      }
      useChatStore.getState().fetchSessionRunStatus(activeId, client.call.bind(client))
    })
    // setupClient 晚于首次 connect() 完成（authStore 先 await connect 再 set client），
    // 此时补一次首次连接语义的状态校正
    if (client.connected) {
      const activeId = useChatStore.getState().activeSessionId
      if (activeId) {
        useChatStore.getState().fetchSessionRunStatus(activeId, client.call.bind(client))
      }
    }

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
