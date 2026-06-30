/**
 * ChatScreen — 主聊天界面
 *
 * 显示当前会话的消息列表、输入栏和消息发送
 */
import React, { useRef, useEffect } from 'react'
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
} from 'react-native'
import { useChatStore } from '../stores/chatStore'
import { useAuthStore } from '../stores/authStore'
import { useSessionStore } from '../stores/sessionStore'

export type ChatScreenProps = {
  onNavigateToSessions: () => void
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  onNavigateToSessions,
}) => {
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const messages = useChatStore((s) => s.messages)
  const inputText = useChatStore((s) => s.inputText)
  const waiting = useChatStore((s) => s.waiting)
  const setInputText = useChatStore((s) => s.setInputText)
  // sendMessage 在 handleSend 中通过 BridgeClient 直接发送
  const sessions = useSessionStore((s) => s.sessions)
  const createSession = useSessionStore((s) => s.createSession)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)

  const flatListRef = useRef<FlatList>(null)
  const inputRef = useRef<TextInput>(null)

  // 滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      // 延迟一帧让 FlatList 渲染完
      const timer = setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [messages.length, waiting])

  // 当前会话名称
  const currentSession = sessions.find((s) => s.id === activeSessionId)
  const sessionName = currentSession?.name ?? `Session ${activeSessionId?.slice(0, 8) ?? ''}`

  const handleSend = async () => {
    const text = inputText.trim()
    if (!text || !activeSessionId) return

    // 本地添加用户消息
    useChatStore.getState().addMessage({ role: 'user', content: text })
    setInputText('')
    useChatStore.getState().setWaiting(true)

    // 通过 Bridge 发送给 OpenCode
    const client = useAuthStore.getState().client
    if (client) {
      try {
        await client.call('message.send', {
          sessionId: activeSessionId,
          message: text,
        })
      } catch (e: any) {
        useChatStore.getState().addMessage({
          role: 'system',
          content: `发送失败: ${e.message}`,
        })
        useChatStore.getState().setWaiting(false)
      }
    }
  }

  const handleNewSession = async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    const id = await createSession(client.call.bind(client))
    if (id) {
      useChatStore.getState().setActiveSession(id)
    }
  }

  const handleRefreshSessions = async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    await fetchSessions(client.call.bind(client))
  }

  // 空状态 — 未选择会话
  if (!activeSessionId) {
    return (
      <View style={styles.container}>
        {/* 头部 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onNavigateToSessions}>
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
    if (!waiting) return null
    return (
      <View style={styles.waitingContainer}>
        <ActivityIndicator size="small" color="#888" />
        <Text style={styles.waitingText}>AI is thinking...</Text>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* 头部 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onNavigateToSessions}>
          <Text style={styles.headerBackText}>{'< Sessions'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {sessionName}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={handleRefreshSessions}>
            <Text style={styles.headerBackText}>↻</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 消息列表 */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        ListFooterComponent={renderFooter}
        contentContainerStyle={styles.messageList}
        style={styles.messageListContainer}
      />

      {/* 输入栏 */}
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
        <TouchableOpacity
          style={[styles.sendButton, (!inputText.trim() || waiting) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || waiting}
        >
          <Text style={styles.sendButtonText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },

  // ── 头部 ──────────────────────────────────────────────
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
    width: 40,
    alignItems: 'flex-end',
  },

  // ── 空状态 ────────────────────────────────────────────
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

  // ── 消息列表 ──────────────────────────────────────────
  messageListContainer: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  // ── 消息气泡 ──────────────────────────────────────────
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

  // ── 等待指示器 ────────────────────────────────────────
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

  // ── 输入栏 ────────────────────────────────────────────
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
})
