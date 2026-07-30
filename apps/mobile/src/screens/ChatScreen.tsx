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
import { PartBlock } from '../components/chat/PartBlock'
import { RichMessage, Part } from '../types/message'
import { useConfigStore } from '../stores/configStore'
import { ThinkingShimmer } from '../components/chat/ThinkingShimmer'
import { PermissionDock } from '../components/chat/PermissionDock'
import { QuestionDock } from '../components/chat/QuestionDock'
import { AttachmentBar } from '../components/chat/AttachmentBar'
import { useAttachmentStore } from '../stores/attachmentStore'

export const ChatScreen: React.FC = () => {
  const [infoModalVisible, setInfoModalVisible] = useState(false)
  const [slashSheetVisible, setSlashSheetVisible] = useState(false)
  const [slashFilter, setSlashFilter] = useState<string | undefined>()
  const [modelPickerVisible, setModelPickerVisible] = useState(false)
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

  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [messages.length, waiting])

  useEffect(() => {
    if (chatSubScreen === 'chat' && !activeSessionId) {
      popChat()
    }
  }, [chatSubScreen, activeSessionId])

  useEffect(() => {
    const client = useAuthStore.getState().client
    if (!activeSessionId || !client) return
    let cancelled = false
    ;(async () => {
      const msgs = await useSessionStore.getState().getSessionMessages(activeSessionId, client.call.bind(client))
      if (!cancelled && msgs.length > 0) {
        msgs.forEach((msg: any) => {
          const msgId = msg.id || undefined
          let partId: string | undefined
          let text = msg.content || msg.text || ''
          if (Array.isArray(msg.content)) {
            const textPart = msg.content.find((p: any) => p.type === 'text')
            if (textPart) {
              text = textPart.text || text
              partId = textPart.id || undefined
            }
          }
          useChatStore.getState().addMessage({
            role: (msg.role as 'user' | 'assistant' | 'system') || 'assistant',
            content: text,
            messageID: msgId,
            partID: partId,
          })
        })
      }
    })()
    return () => { cancelled = true }
  }, [activeSessionId])

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
      if (text.startsWith('!')) {
        await useChatStore.getState().shellCommand(activeSessionId, text.slice(1).trim(), client.call.bind(client))
      } else if (text.startsWith('/')) {
        await useChatStore.getState().writeCommand(activeSessionId, text, client.call.bind(client))
      } else {
        await client.call('message.send', {
          sessionId: activeSessionId,
          message: text,
        })
      }
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
      await useChatStore.getState().writeCommand(activeSessionId, command, client.call.bind(client))
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
    await switchModel(activeSessionId, modelId, client.call.bind(client))
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

  const handleCopyMessage = (content: string) => {
    Clipboard.setString(content)
    Alert.alert('Copied', 'Message content copied to clipboard')
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
        {parts && parts.length > 0 ? (
          parts.map((part) => (
            <PartBlock
              key={part.id}
              part={part}
              message={item as unknown as RichMessage}
            />
          ))
        ) : isAssistant ? (
          <View accessible accessibilityLabel={item.content}>
            <Text style={styles.assistantText}>{item.content}</Text>
          </View>
        ) : isUser ? (
          <Text style={styles.userText}>{item.content}</Text>
        ) : (
          <Text style={styles.systemMessageText}>{item.content}</Text>
        )}
        <View style={isUser ? styles.userActions : styles.nonUserActions}>
          <TouchableOpacity
            style={styles.copyBtn}
            onPress={() => handleCopyMessage(item.content)}
          >
            <Text style={styles.copyBtnText}>Copy</Text>
          </TouchableOpacity>
          {isAssistant && item.messageID && (
            <TouchableOpacity
              style={styles.revertBtn}
              onPress={() => handleRevert(item.messageID!, item.partID)}
            >
              <Text style={styles.revertBtnText}>Revert</Text>
            </TouchableOpacity>
          )}
        </View>
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
            <Text style={styles.headerBackText}>⚙</Text>
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
          placeholderTextColor="#666"
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
                return (
                  <TouchableOpacity
                    key={i}
                    style={styles.modelPickerItem}
                    onPress={() => {
                      handleSwitchModel(m.id || label)
                      setModelPickerVisible(false)
                    }}
                  >
                    <Text style={styles.modelPickerItemText}>{label}</Text>
                    <Text style={styles.modelPickerItemArrow}>›</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  headerBackText: {
    color: '#4a9eff',
    fontSize: 15,
  },
  headerTitle: {
    flex: 1,
    color: '#eee',
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
    color: '#888',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  newSessionButton: {
    backgroundColor: '#0f3460',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  newSessionButtonText: {
    color: '#eee',
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
    backgroundColor: '#0f3460',
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
    color: '#eee',
    fontSize: 15,
    lineHeight: 21,
  },
  assistantText: {
    color: '#d4d4d4',
    fontSize: 14,
    lineHeight: 22,
  },
  systemMessageText: {
    color: '#888',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 8,
  },
  messageMeta: {
    color: '#888',
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
    color: '#888',
    fontSize: 13,
    marginLeft: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
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
    color: '#8ab4f8',
  },
  input: {
    flex: 1,
    color: '#eee',
    fontSize: 15,
    paddingVertical: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0f3460',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonText: {
    color: '#eee',
    fontSize: 18,
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#e74c3c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  userActions: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 6,
  },
  nonUserActions: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 6,
  },
  copyBtn: {
    backgroundColor: '#1a3a1a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  copyBtnText: {
    color: '#6bff6b',
    fontSize: 12,
    fontWeight: '600',
  },
  revertBtn: {
    backgroundColor: '#3a1a1a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  revertBtnText: {
    color: '#ff6b6b',
    fontSize: 12,
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
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
  },
  modelPickerTitle: {
    color: '#eee',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  modelPickerBody: {
    maxHeight: 400,
  },
  modelPickerEmpty: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    padding: 24,
  },
  modelPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 14,
    marginBottom: 6,
  },
  modelPickerItemText: {
    color: '#eee',
    fontSize: 15,
    fontWeight: '500',
  },
  modelPickerItemArrow: {
    color: '#555',
    fontSize: 20,
  },
})
