/**
 * SessionsScreen — 会话列表管理界面
 *
 * 显示所有对话会话，支持创建、删除、刷新
 */
import React, { useEffect, useCallback } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useSessionStore } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'

export type SessionsScreenProps = {
  onNavigateToChat: (sessionId: string) => void
  onBack: () => void
}

/** 格式化相对时间 */
function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const date = new Date(isoDate).getTime()
  const diffMs = now - date

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 60) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(isoDate).toLocaleDateString()
}

export const SessionsScreen: React.FC<SessionsScreenProps> = ({
  onNavigateToChat,
  onBack,
}) => {
  const sessions = useSessionStore((s) => s.sessions)
  const loading = useSessionStore((s) => s.loading)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const createSession = useSessionStore((s) => s.createSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    await fetchSessions(client.call.bind(client))
  }, [fetchSessions])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // 创建新会话
  const handleCreateSession = async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    const id = await createSession(client.call.bind(client))
    if (id) {
      useChatStore.getState().setActiveSession(id)
      onNavigateToChat(id)
    }
  }

  // 选择会话
  const handleSelectSession = (sessionId: string) => {
    useChatStore.getState().setActiveSession(sessionId)
    onNavigateToChat(sessionId)
  }

  // 长按删除
  const handleDeleteSession = (sessionId: string, sessionName: string) => {
    Alert.alert(
      'Delete Session',
      `Are you sure you want to delete "${sessionName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const client = useAuthStore.getState().client
            if (!client) return
            await deleteSession(sessionId, client.call.bind(client))
          },
        },
      ],
    )
  }

  const renderSession = ({ item }: { item: import('../stores/sessionStore').Session }) => {
    const displayName = item.name || `Session ${item.id.slice(0, 8)}`

    return (
      <TouchableOpacity
        style={styles.sessionCard}
        onPress={() => handleSelectSession(item.id)}
        onLongPress={() => handleDeleteSession(item.id, displayName)}
        activeOpacity={0.7}
      >
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.sessionMeta}>
            <Text style={styles.sessionMetaText}>
              {item.messageCount} message{item.messageCount !== 1 ? 's' : ''}
            </Text>
            <Text style={styles.sessionMetaSeparator}>·</Text>
            <Text style={styles.sessionMetaText}>
              {formatRelativeTime(item.updatedAt)}
            </Text>
          </View>
        </View>
        <Text style={styles.sessionChevron}>›</Text>
      </TouchableOpacity>
    )
  }

  const renderEmpty = () => {
    if (loading) return null
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📭</Text>
        <Text style={styles.emptyText}>
          No sessions yet. Create one to start.
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* 头部 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerBackText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sessions</Text>
        <TouchableOpacity onPress={handleCreateSession}>
          <Text style={styles.headerActionText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {/* 加载状态 */}
      {loading && sessions.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4a9eff" />
          <Text style={styles.loadingText}>Loading sessions...</Text>
        </View>
      )}

      {/* 会话列表 */}
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        onRefresh={loadSessions}
        refreshing={loading}
      />
    </View>
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
    justifyContent: 'space-between',
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
    color: '#eee',
    fontSize: 17,
    fontWeight: '600',
  },
  headerActionText: {
    color: '#4a9eff',
    fontSize: 15,
    fontWeight: '600',
  },

  // ── 加载 ──────────────────────────────────────────────
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    marginTop: 12,
  },

  // ── 列表 ──────────────────────────────────────────────
  listContent: {
    padding: 16,
    flexGrow: 1,
  },

  // ── 会话卡片 ──────────────────────────────────────────
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    marginVertical: 6,
    padding: 16,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    color: '#eee',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionMetaText: {
    color: '#888',
    fontSize: 13,
  },
  sessionMetaSeparator: {
    color: '#555',
    fontSize: 13,
    marginHorizontal: 6,
  },
  sessionChevron: {
    color: '#555',
    fontSize: 22,
    marginLeft: 8,
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
  },
})
