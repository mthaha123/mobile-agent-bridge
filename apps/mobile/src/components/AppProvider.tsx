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

    // 通知：AI 消息流（SDK event: message.part.updated）
    //   payload = { sessionID, part: { id, sessionID, messageID, type: "text", text, ... }, time }
    //   text 字段包含流式增量内容，每帧应替换最后一条助理消息而非追加
    client.on('notification', (method: string, payload: any) => {
      if (method === 'message.part.updated') {
        const text = payload?.part?.text || payload?.part?.content || ''
        if (text) {
          useChatStore.getState().updateLastAssistant(text)
        }
        // waiting 不清除在流式帧上 —— 仅在 session.updated / session.idle 时清除
      }

      // 工具审批请求 v1（SDK event: permission.asked）
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

      // session 更新（SDD event: session.updated）
      //   payload = { id, sessionID, session: {...}, info: {...}, ... }
      if (method === 'session.updated') {
        useChatStore.getState().setWaiting(false)
        const info = payload?.session || payload?.info || payload
        if (info?.id) {
          useSessionStore.getState().updateSession(info.id, info)
        }
      }

      // 回复完成（SDD event: session.idle）
      if (method === 'session.idle') {
        useChatStore.getState().setWaiting(false)
      }

      // 回复出错（SDD event: session.error）
      if (method === 'session.error') {
        useChatStore.getState().setWaiting(false)
        const errorMsg = payload?.error || 'unknown error'
        useChatStore.getState().addMessage({
          role: 'system',
          content: `Error: ${errorMsg}`,
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
