import React, { useRef, useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  ScrollView,
  LayoutAnimation,
  UIManager,
} from 'react-native'
import { useChatStore } from '../stores/chatStore'
import type { ChatMessage } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import { useToolStore } from '../stores/toolStore'
import { useQuestionStore } from '../stores/questionStore'
import { useConfigStore } from '../stores/configStore'
import { useAttachmentStore } from '../stores/attachmentStore'
import { SessionInfoModal } from './SessionInfoModal'
import { SlashSheet } from './SlashSheet'
import type { Part } from '../types/message'
import { MessageList } from '../components/chat/MessageList'
import { TAB_BAR_HEIGHT } from '../components/MainLayout'
import { MessageItem } from '../components/chat/MessageItem'
import { ThinkingShimmer } from '../components/chat/ThinkingShimmer'
import { PermissionDock } from '../components/chat/PermissionDock'
import { QuestionDock } from '../components/chat/QuestionDock'
import { AttachmentBar } from '../components/chat/AttachmentBar'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

// Android 需要显式启用 LayoutAnimation
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

/** 从 SDK tool part 的 state 提取可展示的输出文本（content 数组 → 拼接 text） */
function extractToolOutput(state: any): string {
  if (!state) return ''
  if (Array.isArray(state.content)) {
    return state.content
      .filter((c: any) => c && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('')
  }
  if (typeof state.output === 'string') return state.output
  if (typeof state.output === 'object' && state.output !== null) return JSON.stringify(state.output)
  return ''
}

/** 从服务端消息的 rawContent（parts 数组）构建 App 的 Part 列表（text/tool/reasoning）。
 * 保留 text part 在 parts 中的原始位置（保持 reasoning/text/tool 相对顺序），
 * 同时把文本并入 content 供流式/兜底使用。MessageItem 渲染时若 parts 含 text part
 * 则不重复渲染 content，避免文本显示两遍。 */
function buildPartsFromRaw(rawContent: unknown): { parts: Part[]; text: string; partId?: string } {
  const parts: Part[] = []
  let text = ''
  let partId: string | undefined
  if (Array.isArray(rawContent)) {
    rawContent.forEach((p: any) => {
      if (!p || typeof p !== 'object') return
      if (p.type === 'text') {
        const t = p.text || ''
        text = text ? text + t : t
        partId = p.id || partId
        parts.push({ id: p.id || `t_${Date.now()}`, type: 'text', data: { content: t } })
      } else if (p.type === 'tool') {
        parts.push({
          id: p.id || p.callID || `tool_${Date.now()}`,
          type: 'tool',
          data: {
            tool: p.name || p.tool || '',
            input: p.state?.input ?? {},
            status: p.state?.status === 'error' ? 'failed' : (p.state?.status === 'completed' ? 'success' : (p.state?.status || 'called')),
            result: extractToolOutput(p.state),
            error: p.state?.error ?? undefined,
            title: p.state?.title ?? undefined,
          },
        })
      } else if (p.type === 'reasoning') {
        parts.push({ id: p.id || `r_${Date.now()}`, type: 'reasoning', data: { content: p.text || '' } })
      }
    })
  }
  return { parts, text, partId }
}

export const ChatScreen: React.FC = () => {
  const [infoModalVisible, setInfoModalVisible] = useState(false)
  const [slashSheetVisible, setSlashSheetVisible] = useState(false)
  const [slashFilter, setSlashFilter] = useState<string | undefined>()
  const [modelPickerVisible, setModelPickerVisible] = useState(false)
  const [historyCursor, setHistoryCursor] = useState<string | undefined>()
  const [historyLoading, setHistoryLoading] = useState(false)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const messages = useChatStore((s) => s.messages)
  const inputText = useChatStore((s) => s.inputText)
  const waiting = useChatStore((s) => s.waiting)
  const runError = useChatStore((s) => s.runError)
  const clearRunError = useChatStore((s) => s.clearRunError)
  const setInputText = useChatStore((s) => s.setInputText)
  const sessions = useSessionStore((s) => s.sessions)
  const createSession = useSessionStore((s) => s.createSession)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const switchAgent = useSessionStore((s) => s.switchAgent)
  const switchModel = useSessionStore((s) => s.switchModel)
  const models = useConfigStore((s) => s.models)
  const popChat = useUiStore((s) => s.popChat)
  const chatSubScreen = useUiStore((s) => s.chatSubScreen)

  const inputRef = useRef<TextInput>(null)

  // Dock 区域显隐动画：监听审批/问题/附件状态，显隐变化时用 LayoutAnimation 平滑过渡
  const approvals = useToolStore((s) => s.pendingApprovals)
  const questionVisible = useQuestionStore((s) => s.visible)
  const pendingQuestions = useQuestionStore((s) => s.pending)
  const attachments = useAttachmentStore((s) => s.attachments)
  const dockVisible = approvals.length > 0 || (questionVisible && pendingQuestions.length > 0) || attachments.length > 0
  const prevDockVisibleRef = useRef(false)

  React.useLayoutEffect(() => {
    if (prevDockVisibleRef.current !== dockVisible) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
      prevDockVisibleRef.current = dockVisible
    }
  }, [dockVisible])

  useEffect(() => {
    if (chatSubScreen === 'chat' && !activeSessionId) {
      popChat()
    }
  }, [chatSubScreen, activeSessionId])

  const colors = useThemeColors()
  const styles = makeStyles(colors)

  // 将 session.messages 返回的消息转换为 ChatMessage 并加入 store（按 messageID 去重）。
  // sessionStore 已把 v2 {info, parts} 归一化为 { id, role, content, text, rawContent, time }，
  // 其中 rawContent 是原始 parts 数组，需 buildPartsFromRaw 映射为 App Part[]。
  const applyLoadedMessages = (msgs: any[]) => {
    msgs.forEach((msg: any) => {
      const msgId = msg.id || undefined
      const rawContent = msg.rawContent
      const role = (msg.role as 'user' | 'assistant' | 'system') || 'assistant'
      const { parts, text, partId } = buildPartsFromRaw(rawContent)
      useChatStore.getState().addMessage({
        role,
        content: text || msg.content || msg.text || '',
        messageID: msgId,
        partID: partId,
        parts: parts.length > 0 ? parts : undefined,
      })
    })
  }

  // 初始加载：取最近 HISTORY_PAGE_SIZE 条（bridge 契约恒定升序输出的最新窗口），保留 cursor 供上滑加载更早
  const HISTORY_PAGE_SIZE = 50

  useEffect(() => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    let cancelled = false
    setHistoryCursor(undefined)
    setHasMoreHistory(false)
    // 打开会话时用 session.status RPC 快照校正该会话运行状态：
    // 若会话正在其它端/后台生成中，立刻点亮红方块（无需等下一个 SSE 事件）
    useChatStore.getState().fetchSessionRunStatus(activeSessionId, client.call.bind(client))
    ;(async () => {
      // bridge 返回升序（旧→新）的最新窗口；cursor 为绑定来源通道的不透明 token
      const res = await useSessionStore.getState().getSessionMessages(
        activeSessionId, client.call.bind(client),
        { limit: HISTORY_PAGE_SIZE },
      )
      if (cancelled || !res) return
      const list = Array.isArray(res) ? res : (res?.messages ?? [])
      const cursor = res && typeof res === 'object' ? (res as any).cursor : undefined
      if (!cancelled) {
        // bridge 契约保证升序（旧→新），无需 reverse
        applyLoadedMessages(list)
        setHistoryCursor(cursor)
        setHasMoreHistory(Boolean(cursor))

      }
    })()
    return () => { cancelled = true }
  }, [activeSessionId])

  // 上滑到顶：用 cursor 加载更早的消息，prepend 到列表前
  const handleLoadMoreHistory = async () => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client || !historyCursor || historyLoading) return
    setHistoryLoading(true)
    try {
      // cursor 不透明，由 bridge 路由到来源通道继续取更早消息
      const res = await useSessionStore.getState().getSessionMessages(
        activeSessionId, client.call.bind(client),
        { limit: HISTORY_PAGE_SIZE, cursor: historyCursor },
      )
      if (!res) return
      const list = Array.isArray(res) ? res : (res?.messages ?? [])
      const cursor = res && typeof res === 'object' ? (res as any).cursor : undefined
      // 转成 ChatMessage 后 prepend
      const newMsgs: any[] = []
      ;(list as any[]).forEach((msg: any) => {
        const msgId = msg.id || undefined
        const { parts, text } = buildPartsFromRaw(msg.rawContent)
        newMsgs.push({ id: msgId || `m_${Date.now()}_${Math.random()}`, messageID: msgId, role: msg.role, content: text || msg.content || msg.text || '', text: text || msg.content || msg.text || '', parts: parts.length ? parts : undefined, rawContent: msg.rawContent })
      })
      useChatStore.getState().prependMessages(newMsgs as any)
      setHistoryCursor(cursor)
      setHasMoreHistory(Boolean(cursor))
    } catch {
      // 加载失败静默，保留现有 cursor 可重试
    } finally {
      setHistoryLoading(false)
    }
  }

  const currentSession = sessions.find((s) => s.id === activeSessionId)
  const sessionName = currentSession?.name ?? `Session ${activeSessionId?.slice(0, 8) ?? ''}`

  const handleSend = async () => {
    const text = inputText.trim()
    if (!text || !activeSessionId) return
    setInputText('')
    const client = useAuthStore.getState().client
    if (!client) return
    // sendMessage 内部已做乐观 addMessage user + waiting + 失败落 system 错误
    await useChatStore.getState().sendMessage(activeSessionId, text, client.call.bind(client))
  }

  const handleNewSession = async () => {
    const client = useAuthStore.getState().client
    if (!client) { Alert.alert('Error', '未连接到服务器'); return }
    const id = await createSession(client.call.bind(client))
    if (id) {
      useChatStore.getState().setActiveSession(id)
    }
  }

  const handleAbort = async () => {
    const client = useAuthStore.getState().client
    if (!client || !activeSessionId) return
    await useChatStore.getState().abortMessage(activeSessionId, client.call.bind(client))
  }

  const handleSlashSelect = async (command: string) => {
    if (!activeSessionId) return
    const client = useAuthStore.getState().client
    if (!client) return
    setSlashSheetVisible(false)
    await useChatStore.getState().sendMessage(activeSessionId, command, client.call.bind(client))
  }

  // 用户可见刷新：头部 ↻ → 同步当前会话消息（幂等合入），随后刷新会话列表更新标题栏模型/provider
  const handleRefresh = async () => {
    if (!activeSessionId) return
    try {
      const client = useAuthStore.getState().client
      if (!client) return
      await useChatStore.getState().syncSessionMessages(activeSessionId, client.call.bind(client))
      await fetchSessions(client.call.bind(client))
    } catch {
      // 刷新失败静默，保留现有状态
    }
  }

  const handleSwitchAgent = async (agent: string) => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    await switchAgent(activeSessionId, agent, client.call.bind(client))
  }

  const handleSwitchModel = async (entry: any) => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    // 直接使用被点击条目的剩余 identity（id + providerID + variant），
    // 避免按 id 重新查找——同名模型跨 provider 时可能选错 provider。
    const model = entry && typeof entry === 'object'
      ? {
          id: String(entry.id || entry.name || ''),
          providerID: entry.providerID ? String(entry.providerID) : undefined,
          variant: entry.variant,
        }
      : entry
    await switchModel(activeSessionId, model, client.call.bind(client))
    // 刷新会话列表以更新标题栏的模型/provider 显示
    fetchSessions(client.call.bind(client))
  }

  const handleBack = () => {
    popChat()
  }

  const handleRevert = useCallback(async (messageID: string, partID?: string) => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    try {
      await useSessionStore.getState().revertSession(activeSessionId, messageID, partID || '', client.call.bind(client))
      Alert.alert('Reverted', 'Message changes have been reverted')
    } catch {
      Alert.alert('Error', 'Failed to revert message')
    }
  }, [activeSessionId])

  const renderMessage = useCallback((item: ChatMessage) => {
    return <MessageItem item={item} onRevert={handleRevert} />
  }, [handleRevert])


  if (!activeSessionId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} accessibilityLabel="Back to sessions">
            <Text style={styles.headerBackText}>{'< Sessions'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Chat</Text>
          <View style={styles.headerRightEmpty} />
        </View>

        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>💬</Text>
          <Text style={styles.emptyText}>
            Select or create a session to start chatting
          </Text>
          <TouchableOpacity
            style={styles.newSessionButton}
            onPress={handleNewSession}
          >
            <Text style={styles.newSessionButtonText}>+ New Session</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? TAB_BAR_HEIGHT + 8 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} accessibilityLabel="Back to sessions">
          <Text style={styles.headerBackText}>{'< Sessions'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {sessionName}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setModelPickerVisible(true)}
            style={styles.iconButton}
            accessibilityLabel="Model settings"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Text style={styles.headerIcon}>🤖</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setInfoModalVisible(true)}
            style={styles.iconButton}
            accessibilityLabel="Session info"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Text style={styles.headerIcon}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleRefresh}
            style={styles.iconButton}
            accessibilityLabel="Refresh"
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Text style={styles.headerIcon}>↻</Text>
          </TouchableOpacity>
        </View>
      </View>

      {runError ? (
        <View style={styles.runErrorBanner} accessibilityRole="alert">
          <Text style={styles.runErrorIcon}>⚠️</Text>
          <Text style={styles.runErrorText} numberOfLines={3}>{runError}</Text>
          <TouchableOpacity onPress={clearRunError} accessibilityLabel="Dismiss error" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.runErrorClose}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <MessageList
        messages={messages}
        renderMessage={renderMessage}
        thinkingIndicator={waiting ? <ThinkingShimmer /> : undefined}
        historyHint={hasMoreHistory ? (
          <View style={{ padding: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{historyLoading ? '加载更早消息...' : '上滑加载更早消息'}</Text>
          </View>
        ) : undefined}
        hasMoreHistory={hasMoreHistory}
        historyLoading={historyLoading}
        onLoadMoreHistory={handleLoadMoreHistory}
      />

      {/* Dock 区域：权限审批 / 问题面板 */}
      <PermissionDock />
      <QuestionDock />
      <AttachmentBar />

      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.cmdButton} onPress={() => setSlashSheetVisible(true)} accessibilityLabel="Open commands">
          <Text style={styles.cmdButtonText}>⌘</Text>
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={(t) => {
            setInputText(t)
            if (t.endsWith('/')) { setSlashFilter('/'); setSlashSheetVisible(true) }
            else if (t.endsWith('@')) { setSlashFilter('@'); setSlashSheetVisible(true) }
          }}
          placeholder="Type a message..."
          placeholderTextColor={colors.textTertiary}
          multiline
          editable={!waiting}
          accessibilityLabel="Type a message..."
        />
        {waiting ? (
          <TouchableOpacity style={styles.stopButton} onPress={() => {
            Alert.alert('停止生成', '确定要停止 AI 回复吗？', [
              { text: '取消', style: 'cancel' },
              { text: '停止', style: 'destructive', onPress: handleAbort },
            ])
          }}>
            <Text style={styles.stopButtonText}>■</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim()}
            accessibilityLabel="Send message"
          >
            <Text style={styles.sendButtonText}>➤</Text>
          </TouchableOpacity>
        )}
      </View>

      <SessionInfoModal
        visible={infoModalVisible}
        sessionId={activeSessionId}
        onClose={() => setInfoModalVisible(false)}
      />
      <SlashSheet
        visible={slashSheetVisible}
        onClose={() => { setSlashSheetVisible(false); setSlashFilter(undefined) }}
        onSelect={handleSlashSelect}
        onSwitchAgent={handleSwitchAgent}
        filter={slashFilter}
      />

      <Modal
        visible={modelPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModelPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setModelPickerVisible(false)}
        >
          <TouchableOpacity style={styles.modelPickerCard} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.modelPickerTitle}>Select Model</Text>
            <ScrollView style={styles.modelPickerBody}>
              {Array.isArray(models) && models.length === 0 && (
                <Text style={styles.modelPickerEmpty}>No models loaded</Text>
              )}
              {Array.isArray(models) && models.map((m: any, i: number) => {
                const label = m.name || m.id || m.label || `Model ${i + 1}`
                const provider = m.providerID || m.provider?.id || ''
                // 同名模型可能来自不同 provider（如 deepseek-v4-flash 同时存在于
                // opencode 与 opencode-go）。必须按 (id + providerID) 匹配，确保
                // 只有真正正在使用的那个模型被标记为选中（✓）。
                const currentModelId = currentSession?.model?.id
                const currentProvider = currentSession?.model?.providerID
                const isCurrent = currentModelId != null && m.id === currentModelId &&
                  (!currentProvider || m.providerID === currentProvider)
                return (
                  <TouchableOpacity
                    key={`${m.providerID || ''}:${m.id || i}`}
                    style={[styles.modelPickerItem, isCurrent && styles.modelPickerItemActive]}
                    onPress={async () => {
                      await handleSwitchModel(m)
                      setModelPickerVisible(false)
                    }}
                  >
                    <View style={styles.modelPickerItemLeft}>
                      {provider ? (
                        <View style={styles.modelProviderBadge}>
                          <Text style={styles.modelProviderBadgeText} numberOfLines={1}>{provider}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.modelPickerItemText}>{label}</Text>
                    </View>
                    <Text style={styles.modelPickerItemArrow}>{isCurrent ? '✓' : '›'}</Text>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBackText: {
    color: colors.primary,
    fontSize: 15,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    marginHorizontal: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  // 空态（无会话）标题栏：右侧无图标，用固定宽度与左侧 '< Sessions' 文字平衡，保持标题居中
  headerRightEmpty: {
    width: 80,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: {
    color: colors.primary,
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  newSessionButton: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  newSessionButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderRadius: 24,
    marginHorizontal: 12,
    marginVertical: 8,
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 4,
  },
  cmdButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cmdButtonText: {
    fontSize: 18,
    color: colors.primary,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: 8,
    minHeight: 36,
    maxHeight: 120,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceVariant,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: colors.text,
    fontSize: 18,
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.destructive,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopButtonText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '600',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modelPickerCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
  },
  modelPickerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  modelPickerBody: {
    maxHeight: 400,
  },
  modelPickerEmpty: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    padding: 24,
  },
  modelPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 14,
    marginBottom: 6,
  },
  modelPickerItemText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  modelPickerItemArrow: {
    color: colors.textTertiary,
    fontSize: 20,
  },
  modelPickerItemLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  modelPickerItemActive: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  modelProviderBadge: {
    backgroundColor: colors.primary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
    maxWidth: 110,
  },
  modelProviderBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  runErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    borderLeftWidth: 4,
    borderLeftColor: colors.destructive,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 6,
  },
  runErrorIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  runErrorText: {
    color: colors.destructive,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  runErrorClose: {
    color: colors.textTertiary,
    fontSize: 18,
    marginLeft: 8,
    paddingHorizontal: 4,
  },
})
