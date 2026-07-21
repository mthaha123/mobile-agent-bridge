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
} from 'react-native'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { useSessionStore } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import { ToolProgressCard } from '../components/ToolProgressCard'
import { SessionInfoModal } from './SessionInfoModal'

export const ChatScreen: React.FC = () => {
  const [infoModalVisible, setInfoModalVisible] = useState(false)
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const messages = useChatStore((s) => s.messages)
  const inputText = useChatStore((s) => s.inputText)
  const waiting = useChatStore((s) => s.waiting)
  const setInputText = useChatStore((s) => s.setInputText)
  const sessions = useSessionStore((s) => s.sessions)
  const createSession = useSessionStore((s) => s.createSession)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
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
        msgs.forEach((m: any) => useChatStore.getState().addMessage({
          role: m.role || 'assistant',
          content: m.content || m.text || '',
        }))
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
    } catch (e: any) {
      useChatStore.getState().addMessage({
        role: 'system',
        content: `发送失败: ${e?.message || String(e) || '未知错误'}`,
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

  const handleRefreshSessions = async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    await fetchSessions(client.call.bind(client))
  }

  const handleBack = () => {
    popChat()
  }

  if (!activeSessionId) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack}>
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

  const renderMessage = ({ item }: { item: import('../stores/chatStore').ChatMessage }) => {
    const isUser = item.role === 'user'
    const isSystem = item.role === 'system'
    const isAssistant = item.role === 'assistant'

    return (
      <View
        style={[
          styles.messageBubble,
          isUser && styles.userBubble,
          isAssistant && styles.assistantBubble,
          isSystem && styles.systemBubble,
        ]}
      >
        <Text
          style={[
            styles.messageText,
            isSystem && styles.systemMessageText,
          ]}
        >
          {item.content}
        </Text>
      </View>
    )
  }

  const renderFooter = () => {
    return (
      <>
        {waiting && (
          <View style={styles.waitingContainer}>
            <ActivityIndicator size="small" color="#888" />
            <Text style={styles.waitingText}>AI is thinking...</Text>
          </View>
        )}
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
        <TouchableOpacity onPress={handleBack}>
          <Text style={styles.headerBackText}>{'< Sessions'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {sessionName}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setInfoModalVisible(true)}
            style={styles.infoButton}
          >
            <Text style={styles.headerBackText}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRefreshSessions}>
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

      <View style={styles.inputContainer}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor="#666"
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          editable={!waiting}
        />
        {waiting ? (
          <TouchableOpacity style={styles.stopButton} onPress={handleAbort}>
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
  messageBubble: {
    maxWidth: '80%',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginVertical: 4,
  },
  userBubble: {
    backgroundColor: '#0f3460',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#16213e',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
  },
  systemBubble: {
    backgroundColor: 'transparent',
    alignSelf: 'center',
  },
  messageText: {
    color: '#eee',
    fontSize: 15,
    lineHeight: 21,
  },
  systemMessageText: {
    color: '#888',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
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
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 4,
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
})
