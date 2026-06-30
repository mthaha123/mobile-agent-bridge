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
    //   payload = { sessionID, part: { id, sessionID, messageID, type: "text", text, ... }, time }
    client.on('notification', (method: string, payload: any) => {
      if (method === 'message.part.updated') {
        const text = payload?.part?.text || payload?.part?.content || ''
        if (text) {
          useChatStore.getState().addMessage({
            role: 'assistant',
            content: text,
          })
        }
        useChatStore.getState().setWaiting(false)
      }

      // 工具审批请求（SDK event: permission.asked）
      //   payload = { id, sessionID, permission: "file.read", patterns: ["src/**"], metadata: {...} }
      if (method === 'permission.asked') {
        useToolStore.getState().enqueue({
          id: payload?.id || 'unknown',
          tool: payload?.permission || 'unknown',
          args: { patterns: payload?.patterns || [] } as Record<string, unknown>,
          sessionId: payload?.sessionID || '',
          requestedAt: Date.now(),
        })
      }
    })

    // 通知：session 更新（SDK event: session.updated）
    //   payload 结构取决于 SDK session.updated 事件的具体 properties
    client.on('notification', (method: string, payload: any) => {
      if (method === 'session.updated') {
        // session.updated 的 properties 中包含 session 信息
        // 可能是 properties.session 或 properties.info
        const info = payload?.session || payload?.info || payload
        if (info?.id) {
          useSessionStore.getState().updateSession(info.id, info)
        }
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
