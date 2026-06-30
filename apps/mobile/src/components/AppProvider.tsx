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
import { BridgeClient } from '../services/BridgeClient'
import { setToolReplyCall } from '../screens/ToolApprovalSheet'

/**
 * 注册 tool approval 的 replyCall
 * 当用户批准/拒绝工具调用时，通过 BridgeClient 发送 permission.reply RPC
 */
function createReplyCall(client: BridgeClient): (id: string, approved: boolean) => Promise<void> {
  return async (id: string, approved: boolean) => {
    await client.call('permission.reply', {
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

    // 通知：AI 消息流（SDK event: message.part.updated）
    client.on('notification', (method: string, payload: any) => {
      if (method === 'message.part.updated') {
        useChatStore.getState().addMessage({
          role: 'assistant',
          content: payload?.message || payload?.text || '',
        })
        useChatStore.getState().setWaiting(false)
      }

      // 工具审批请求（SDK event: permission.asked）
      if (method === 'permission.asked') {
        useToolStore.getState().enqueue({
          id: payload?.id || 'unknown',
          tool: payload?.name || payload?.tool || 'unknown',
          args: (payload?.arguments || payload?.args || {}) as Record<string, unknown>,
          sessionId: payload?.sessionId || '',
          requestedAt: Date.now(),
        })
      }
    })

    // 通知：session 更新（SDK event: session.updated）
    client.on('notification', (method: string, payload: any) => {
      if (method === 'session.updated' && payload?.session) {
        useSessionStore
          .getState()
          .updateSession(payload.session.id, payload.session)
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
