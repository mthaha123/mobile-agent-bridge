import React, { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useToolStore } from '../stores/toolStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'
import { useDiffStore } from '../stores/diffStore'
import { useTodoStore } from '../stores/todoStore'
import { useQuestionStore } from '../stores/questionStore'
import { useSettingsStore } from '../stores/settingsStore'
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
  const appStateSubRef = useRef<{ remove: () => void } | null>(null)

  // 启动时一次性恢复本地偏好（默认 agent/model），失败静默
  useEffect(() => {
    void useSettingsStore.getState().load()
  }, [])

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

    // ── 回前台秒连：AppState 事件驱动，不等退避定时器/保活验尸 ──
    //
    // 后台期间 Android/iOS 会冻结 JS 定时器并回收网络，socket 大概率已死：
    //   - 已断开（onclose 触发过）→ reconnectNow 立即握手（清掉挂起的退避定时器）
    //   - 显示已连接但可能是"僵尸半开"（系统断网未挥手）→ verifyAlive 短超时
    //     探测，失败立即软重连
    // 切后台不做任何事：省电，且系统会冻结定时器，保活本就无效。
    appStateSubRef.current?.remove()
    appStateSubRef.current = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      const c = clientRef.current
      if (!c) return
      if (!c.connected) {
        c.reconnectNow()
      } else {
        void c.verifyAlive().catch(() => {})
      }
    })

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

    // ── 审批队列对账：修复断线期间错过的 permission.v2.asked / replied ──
    //
    // WS 断口内服务器弹出的审批请求（如后台跑任务时触发）不会重放，本地队列
    // 会永久缺失该条目；同理断线期间被回复的请求会在本地残留。重连后用
    // permission.list（SDK v2 权威待审批快照）双向对账：
    //   - 服务器有而本地无 → 入队（enqueue 自带 id/sourceCallID 去重）
    //   - 本地有而服务器无 → 仅移除"快照前已存在"的条目，避免与实时通知竞态
    const reconcilePermissions = async () => {
      try {
        const beforeIds = new Set(
          useToolStore.getState().pendingApprovals.map((a) => a.id),
        )
        const list = (await client.call('permission.list', {})) as Array<{
          id?: unknown
          sessionID?: unknown
          permission?: unknown
          metadata?: unknown
          tool?: { callID?: string } | null
        }>
        if (!Array.isArray(list)) return
        const serverIds = new Set<string>()
        for (const req of list) {
          if (!req || typeof req.id !== 'string' || !req.id) continue
          serverIds.add(req.id)
          useToolStore.getState().enqueue({
            id: req.id,
            tool: typeof req.permission === 'string' ? req.permission : 'unknown',
            args: (req.metadata && typeof req.metadata === 'object'
              ? (req.metadata as Record<string, unknown>)
              : {}) as Record<string, unknown>,
            sessionId: typeof req.sessionID === 'string' ? req.sessionID : '',
            requestedAt: Date.now(),
            sourceCallID: req.tool?.callID,
          })
        }
        for (const item of useToolStore.getState().pendingApprovals) {
          if (beforeIds.has(item.id) && !serverIds.has(item.id)) {
            useToolStore.getState().dequeue(item.id)
          }
        }
      } catch {
        // 静默：对账失败保持现状，等待下一次 connected/实时事件
      }
    }

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
      if (activeId) {
        if (wasReconnect) {
          useChatStore.getState().syncSessionMessages(activeId, client.call.bind(client)).catch(() => {})
        }
        useChatStore.getState().fetchSessionRunStatus(activeId, client.call.bind(client))
      }
      void reconcilePermissions()
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
    appStateSubRef.current?.remove()
    appStateSubRef.current = null
    useChatStore.getState().stopStatusPolling() // 连接销毁：条件轮询一并撤销
    setQuestionRejectCall(null)
    clientRef.current?.destroy()
    clientRef.current = null
  }

  return <>{children}</>
}
