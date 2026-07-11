/**
 * AppProvider — 全局 Provider
 *
 * 负责 BridgeClient 事件绑定、生命周期管理
 */
import React, { useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useToolStore } from '../stores/toolStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'
import { BridgeClient } from '../services/BridgeClient'
import { setToolReplyCall } from '../screens/ToolApprovalSheet'

/**
 * 注册 tool approval 的 replyCall
 * 当用户批准/拒绝工具调用时，通过 BridgeClient 发送 permission.reply RPC
 * 从 toolStore 待审批队列中查找对应请求的 sessionId（v2 API 需要）
 */
function createReplyCall(client: BridgeClient): (id: string, approved: boolean) => Promise<void> {
  return async (id: string, approved: boolean) => {
    const { pendingApprovals } = useToolStore.getState()
    const item = pendingApprovals.find((a) => a.id === id)
    await client.call('permission.reply', {
      sessionId: item?.sessionId || '',
      id,
      approved,
    })
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const clientRef = useRef<BridgeClient | null>(null)

  useEffect(() => {
    // 监听 auth store 的 client 变化
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (state.client && state.client !== prev.client) {
        setupClient(state.client)
      }
      if (!state.client && prev.client) {
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

    // 注册 tool approval replyCall
    setToolReplyCall(createReplyCall(client))

    client.on('notification', (method: string, payload: any) => {
      // 流式文本增量（SDK event: session.next.text.delta）
      //   payload = { sessionID, assistantMessageID, textID, delta }
      //   delta 是增量文本，每帧替换最后一条助理消息
      if (method === 'session.next.text.delta') {
        const delta = payload?.delta || ''
        if (delta) {
          useChatStore.getState().updateLastAssistant(delta)
        }
      }

      // 工具审批请求 v2（SDK event: permission.v2.asked）
      //   payload = { id, sessionID, action: "read", resources: ["src/**"] }
      if (method === 'permission.v2.asked') {
        useToolStore.getState().enqueue({
          id: payload?.id || 'unknown',
          tool: payload?.action || 'unknown',
          args: { resources: payload?.resources || [] } as Record<string, unknown>,
          sessionId: payload?.sessionID || '',
          requestedAt: Date.now(),
        })
      }

      // session 状态变更（SDK event: session.status）
      //   payload = { sessionID, status: { type: "idle"|"busy"|"retry" } }
      if (method === 'session.status') {
        const statusType = payload?.status?.type
        if (statusType === 'idle') {
          useChatStore.getState().setWaiting(false)
        } else if (statusType === 'busy') {
          useChatStore.getState().setWaiting(true)
        }
        const info = payload?.session || payload
        if (info?.id) {
          useSessionStore.getState().updateSession(info.id, info)
        }
      }

      // 回复完成（SDK event: session.idle）
      if (method === 'session.idle') {
        useChatStore.getState().setWaiting(false)
      }

      // 回复出错（SDK event: session.error）
      if (method === 'session.error') {
        useChatStore.getState().setWaiting(false)
        const errorMsg = payload?.error || 'unknown error'
        useChatStore.getState().addMessage({
          role: 'system',
          content: `Error: ${errorMsg}`,
        })
      }

      // 项目切换（bridge-emitted event: project.changed）
      if (method === 'project.changed') {
        useProjectStore.getState().setProject({
          directory: payload?.directory || '',
          project: payload?.project,
        })
      }
    })

    // token 过期
    client.on('auth_expired', () => {
      useAuthStore.getState().logout()
    })
  }

  function teardownClient() {
    clientRef.current?.destroy()
    clientRef.current = null
  }

  return <>{children}</>
}
