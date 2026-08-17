import React, { useRef, useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Clipboard,
} from 'react-native'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import { ToolProgressCard } from '../components/ToolProgressCard'
import { SessionInfoModal } from './SessionInfoModal'
import { SlashSheet } from './SlashSheet'
import { PartBlock, MessageWrapperForFallback } from '../components/chat/PartBlock'
import { MarkdownRenderer } from '../components/chat/MarkdownRenderer'
import { RichMessage, Part } from '../types/message'
import { useConfigStore } from '../stores/configStore'
import { ThinkingShimmer } from '../components/chat/ThinkingShimmer'
import { PermissionDock } from '../components/chat/PermissionDock'
import { QuestionDock } from '../components/chat/QuestionDock'
import { AttachmentBar } from '../components/chat/AttachmentBar'
import { useAttachmentStore } from '../stores/attachmentStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

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

/** 从服务端消息的 rawContent（parts 数组）构建 App 的 Part 列表（text/tool/reasoning）。 */
function buildPartsFromRaw(rawContent: unknown): { parts: Part[]; text: string; partId?: string } {
  const parts: Part[] = []
  let text = ''
  let partId: string | undefined
  if (Array.isArray(rawContent)) {
    rawContent.forEach((p: any) => {
      if (!p || typeof p !== 'object') return
      if (p.type === 'text') {
        const t = p.text || ''
        text = t || text
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
  const setInputText = useChatStore((s) => s.setInputText)
  const sessions = useSessionStore((s) => s.sessions)
  const createSession = useSessionStore((s) => s.createSession)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const switchAgent = useSessionStore((s) => s.switchAgent)
  const switchModel = useSessionStore((s) => s.switchModel)
  const models = useConfigStore((s) => s.models)
  const popChat = useUiStore((s) => s.popChat)
  const chatSubScreen = useUiStore((s) => s.chatSubScreen)

  const flatListRef = useRef<FlatList>(null)
  const inputRef = useRef<TextInput>(null)
  // 用户当前是否停留在最新消息（底部）。false=正在上滑回看历史，不打扰。
  const pinnedToBottomRef = useRef(true)
  // 新会话打开后置位：内容首次渲染完成时强制滚到底部（即使内容很多也一次到位）。
  const pendingScrollToEndRef = useRef(false)

  useEffect(() => {
    if (messages.length > 0 && pinnedToBottomRef.current && !pendingScrollToEndRef.current) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [messages.length, waiting])

  useEffect(() => {
    if (chatSubScreen === 'chat' && !activeSessionId) {
      popChat()
    }
  }, [chatSubScreen, activeSessionId])

  const colors = useThemeColors()
  const styles = makeStyles(colors)

  // 将 session.messages 返回的消息转换为 ChatMessage 并加入 store（按 messageID 去重）
  const applyLoadedMessages = (msgs: any[]) => {
    msgs.forEach((msg: any) => {
      const msgId = msg.id || undefined
      const rawContent = msg.rawContent
      const { parts, text, partId } = buildPartsFromRaw(rawContent)
      useChatStore.getState().addMessage({
        role: (msg.role as 'user' | 'assistant' | 'system') || 'assistant',
        content: text || msg.content || msg.text || '',
        messageID: msgId,
        partID: partId,
        parts: parts.length > 0 ? parts : undefined,
      })
    })
  }

  // 初始加载：取最近 HISTORY_PAGE_SIZE 条（升序），保留 cursor 供上滑加载更早
  const HISTORY_PAGE_SIZE = 50

  // 兜底刷新：拉取最近消息，按 messageID 与 store 现有内容做幂等合并。
  // 覆盖“事件流丢失/断线期间产生的消息”这类情况，确保页面内容最终与服务端一致。
  const backfillLatestMessages = async () => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    const res = await useSessionStore.getState().getSessionMessages(
      activeSessionId, client.call.bind(client),
      { order: 'desc', limit: HISTORY_PAGE_SIZE },
    )
    if (!res) return
    const list = Array.isArray(res) ? res : (res?.messages ?? [])
    // desc → 升序，按 created 时序批量合入（applyServerMessages 对未知消息按序插入，
    // 避免 SSE 断流恢复时漏掉的 user 消息被追加到其 assistant 之后 → 回答跑到问题上面）
    const asc = [...list].reverse()
    const mapped: Array<{ role: 'user' | 'assistant'; messageID: string; content: string; timestamp?: number; parts?: Part[] }> = []
    asc.forEach((msg: any) => {
      const messageID = msg?.id || msg?.messageID
      if (!messageID) return
      const role = msg?.role === 'user' ? 'user' : 'assistant'
      const created = msg?.time?.created ?? msg?.timestamp
      const { parts } = buildPartsFromRaw(msg?.rawContent)
      mapped.push({
        role,
        messageID,
        content: msg?.content || msg?.text || '',
        timestamp: typeof created === 'number' ? created : undefined,
        parts: parts.length > 0 ? parts : undefined,
      })
    })
    useChatStore.getState().applyServerMessages(mapped)
  }

  useEffect(() => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    let cancelled = false
    // 新会话打开：等待内容首次渲染完成时强制滚到最新底部
    pendingScrollToEndRef.current = true
    setHistoryCursor(undefined)
    setHasMoreHistory(false)
    ;(async () => {
      const res = await useSessionStore.getState().getSessionMessages(
        activeSessionId, client.call.bind(client),
        { order: 'asc', limit: HISTORY_PAGE_SIZE },
      )
      if (cancelled || !res) return
      const list = Array.isArray(res) ? res : (res?.messages ?? [])
      const cursor = res && typeof res === 'object' ? (res as any).cursor : undefined
      if (!cancelled) {
        applyLoadedMessages(list) // asc 顺序即时间正序，直接追加（addMessage 去重）
        setHistoryCursor(cursor)
        setHasMoreHistory(Boolean(cursor))
      }
    })()
    // 打开会话后立即合流一次 + 周期兜底刷新（事件驱动为主，轮询仅兜底）
    backfillLatestMessages()
    const timer = setInterval(() => {
      if (!cancelled) backfillLatestMessages()
    }, 25000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [activeSessionId])

  // 上滑到顶：用 cursor 加载更早的消息，prepend 到列表前
  const handleLoadMoreHistory = async () => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client || !historyCursor || historyLoading) return
    setHistoryLoading(true)
    try {
      const res = await useSessionStore.getState().getSessionMessages(
        activeSessionId, client.call.bind(client),
        { order: 'asc', limit: HISTORY_PAGE_SIZE, cursor: historyCursor },
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

    useChatStore.getState().addMessage({ role: 'user', content: text })
    setInputText('')

    const client = useAuthStore.getState().client
    if (!client) return

    useChatStore.getState().setWaiting(true)

    try {
      await client.call('message.send', {
        sessionId: activeSessionId,
        message: text,
      })
    } catch (e: unknown) {
      useChatStore.getState().addMessage({
        role: 'system',
        content: `发送失败: ${e instanceof Error ? e.message : String(e) || '未知错误'}`,
      })
      useChatStore.getState().setWaiting(false)
    }
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
    useChatStore.getState().addMessage({ role: 'user', content: command })
    useChatStore.getState().setWaiting(true)
    try {
      await client.call('message.send', {
        sessionId: activeSessionId,
        message: command,
      })
    } catch (e: unknown) {
      useChatStore.getState().addMessage({
        role: 'system',
        content: `发送失败: ${e instanceof Error ? e.message : String(e) || '未知错误'}`,
      })
      useChatStore.getState().setWaiting(false)
    }
  }

  const handleRefreshSessions = async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    await fetchSessions(client.call.bind(client))
  }

  const handleSwitchAgent = async (agent: string) => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    await switchAgent(activeSessionId, agent, client.call.bind(client))
  }

  const handleSwitchModel = async (modelId: string) => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    const target: any = (Array.isArray(models) ? models : []).find((m: any) => (m.id || m.name || m.label) === modelId)
    const model = target && target.providerID
      ? { id: String(target.id || target.name || modelId), providerID: String(target.providerID) }
      : modelId
    await switchModel(activeSessionId, model, client.call.bind(client))
    // 刷新会话列表以更新标题栏的模型名/provider 显示
    fetchSessions(client.call.bind(client))
  }

  const handleBack = () => {
    popChat()
  }

  if (!activeSessionId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} accessibilityLabel="Back to sessions">
            <Text style={styles.headerBackText}>{'< Sessions'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Chat</Text>
          <View style={styles.headerRight} />
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

  const handleRevert = async (messageID: string, partID?: string) => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    try {
      await useSessionStore.getState().revertSession(activeSessionId, messageID, partID || '', client.call.bind(client))
      Alert.alert('Reverted', 'Message changes have been reverted')
    } catch {
      Alert.alert('Error', 'Failed to revert message')
    }
  }

  const renderMessage = ({ item }: { item: import('../stores/chatStore').ChatMessage }) => {
    const isUser = item.role === 'user'
    const isSystem = item.role === 'system'
    const isAssistant = item.role === 'assistant'
    const parts = (item as any).parts as Part[] | undefined

    // 用户消息 → 右对齐气泡
    // 助手/系统消息 → 无气泡，全宽左对齐（OpenCode Web 样式）
    return (
      <View style={isUser ? styles.userBubble : styles.nonUserBlock}>
        {!isUser && item.agent ? (
          <Text style={styles.messageMeta}>{item.agent}</Text>
        ) : null}
        {isAssistant ? (
          <>
            {item.content ? (
              <MessageWrapperForFallback content={item.content} message={item} onRevert={handleRevert}>
                <MarkdownRenderer content={item.content} />
              </MessageWrapperForFallback>
            ) : null}
            {parts && parts.length > 0
              ? parts.map((part) => (
                  <PartBlock
                    key={part.id}
                    part={part}
                    message={item as unknown as RichMessage}
                    onRevert={handleRevert}
                  />
                ))
              : null}
          </>
        ) : isUser ? (
          <View accessible accessibilityLabel={item.content}>
            <Text style={styles.userText}>{item.content}</Text>
          </View>
        ) : (
          <View accessible accessibilityLabel={item.content}>
            <Text style={styles.systemMessageText}>{item.content}</Text>
          </View>
        )}
        {/* Copy/Revert 通过长按菜单触发，不显示固定按钮 */}
      </View>
    )
  }

  const renderFooter = () => {
    return (
      <>
        {waiting && <ThinkingShimmer />}
        <ToolProgressCard />
      </>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
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
            style={styles.infoButton}
            accessibilityLabel="Model settings"
          >
            <View style={styles.modelBadge}>
              <Text style={styles.modelBadgeText} numberOfLines={1}>
                {currentSession?.model?.name || currentSession?.model?.id || 'Select Model'}
              </Text>
              {currentSession?.model?.providerID ? (
                <Text style={styles.modelBadgeProvider} numberOfLines={1}>{currentSession.model.providerID}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setInfoModalVisible(true)}
            style={styles.infoButton}
            accessibilityLabel="Session info"
          >
            <Text style={styles.headerBackText}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefreshSessions} accessibilityLabel="Refresh">
            <Text style={styles.headerBackText}>↻</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        ListFooterComponent={renderFooter}
        ListHeaderComponent={hasMoreHistory ? (
          <View style={{ padding: 12, alignItems: 'center' }}>
            <Text style={{ color: colors.textTertiary, fontSize: 12 }}>{historyLoading ? '加载更早消息...' : '上滑加载更早消息'}</Text>
          </View>
        ) : null}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y
          const layoutHeight = e.nativeEvent.layoutMeasurement.height
          const contentHeight = e.nativeEvent.contentSize.height
          // 用户是否在底部（距离底部 < 60）：在底部则保持跟随最新；远离底部视为回看历史
          pinnedToBottomRef.current = contentHeight - (y + layoutHeight) < 60
          // 接近顶部（最早消息）时加载更早历史
          if (y < 60 && hasMoreHistory && !historyLoading) {
            handleLoadMoreHistory()
          }
        }}
        onContentSizeChange={() => {
          // 每次内容尺寸变化都刷新底部判定；若会话刚打开则强制滚到最新底部一次
          if (pendingScrollToEndRef.current) {
            pendingScrollToEndRef.current = false
            pinnedToBottomRef.current = true
            requestAnimationFrame(() => {
              flatListRef.current?.scrollToEnd({ animated: false })
            })
          } else if (pinnedToBottomRef.current) {
            // 停留在底部时新消息/加载更多后仍跟随到底部
            requestAnimationFrame(() => {
              flatListRef.current?.scrollToEnd({ animated: false })
            })
          }
        }}
        scrollEventThrottle={200}
        contentContainerStyle={styles.messageList}
        style={styles.messageListContainer}
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
            else if (slashSheetVisible && !t.endsWith('/') && !t.endsWith('@')) {
              // keep filtering as user types after /
            }
          }}
          placeholder="Type a message..."
          placeholderTextColor={colors.textTertiary}
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
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
                const isCurrent = m.id === currentSession?.model?.id
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.modelPickerItem, isCurrent && styles.modelPickerItemActive]}
                    onPress={() => {
                      handleSwitchModel(m.id || label)
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
    width: 80,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  infoButton: {
    padding: 2,
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
  messageListContainer: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  // 用户消息 → 气泡（右对齐）
  userBubble: {
    maxWidth: '80%',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 12,
    borderBottomRightRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginVertical: 4,
    alignSelf: 'flex-end',
  },
  // 助手/系统消息 → 无气泡（全宽左对齐，OpenCode Web 样式）
  nonUserBlock: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginVertical: 2,
  },
  userText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  assistantText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
  },
  systemMessageText: {
    color: colors.textTertiary,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  messageMeta: {
    color: colors.textTertiary,
    fontSize: 11,
    marginBottom: 4,
  },
  waitingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginVertical: 4,
    marginLeft: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  waitingText: {
    color: colors.textTertiary,
    fontSize: 13,
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
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
  modelBadge: {
    alignItems: 'flex-end',
    marginRight: 8,
    maxWidth: 150,
  },
  modelBadgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  modelBadgeProvider: {
    color: colors.textTertiary,
    fontSize: 10,
  },
})
