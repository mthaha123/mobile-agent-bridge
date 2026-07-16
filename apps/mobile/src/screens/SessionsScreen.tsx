import React, { useEffect, useCallback, useState } from 'react'
import {
  Alert,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native'
import { useSessionStore } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'

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

export const SessionsScreen: React.FC = () => {
  const [switchDirInput, setSwitchDirInput] = useState('')
  const [showSwitchModal, setShowSwitchModal] = useState(false)

  const sessions = useSessionStore((s) => s.sessions)
  const loading = useSessionStore((s) => s.loading)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const createSession = useSessionStore((s) => s.createSession)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const directory = useProjectStore((s) => s.directory)
  const switching = useProjectStore((s) => s.switching)
  const switchProject = useProjectStore((s) => s.switchProject)
  const pushChat = useUiStore((s) => s.pushChat)

  const handleOpenSwitch = () => {
    setSwitchDirInput(directory || '')
    setShowSwitchModal(true)
  }

  const handleConfirmSwitch = async () => {
    if (switchDirInput.trim()) {
      setShowSwitchModal(false)
      await switchProject(switchDirInput.trim())
    }
  }

  const loadSessions = useCallback(async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    await fetchSessions(client.call.bind(client))
  }, [fetchSessions])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    if (directory) loadSessions()
  }, [directory])

  const handleCreateSession = async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    const id = await createSession(client.call.bind(client))
    if (id) {
      useChatStore.getState().setActiveSession(id)
      pushChat()
    }
  }

  const handleSelectSession = (sessionId: string) => {
    useChatStore.getState().setActiveSession(sessionId)
    pushChat()
  }

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
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sessions</Text>
        <TouchableOpacity onPress={handleCreateSession} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
          <Text style={styles.headerActionText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.projectBar}>
        <View style={styles.projectInfo}>
          <Text style={styles.projectLabel}>Project</Text>
          <Text style={styles.projectDir} numberOfLines={1}>
            {directory || '(none)'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.switchBtn, switching && styles.switchBtnDisabled]}
          onPress={handleOpenSwitch}
          disabled={switching}
          activeOpacity={0.7}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          {switching ? (
            <ActivityIndicator size="small" color="#4a9eff" />
          ) : (
            <Text style={styles.switchBtnText}>Switch</Text>
          )}
        </TouchableOpacity>
      </View>

      {loading && sessions.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4a9eff" />
          <Text style={styles.loadingText}>Loading sessions...</Text>
        </View>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        onRefresh={loadSessions}
        refreshing={loading}
      />

      <Modal
        visible={showSwitchModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSwitchModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Switch Project</Text>
            <TextInput
              style={styles.modalInput}
              value={switchDirInput}
              onChangeText={setSwitchDirInput}
              placeholder="/home/user/project"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowSwitchModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleConfirmSwitch}
              >
                <Text style={styles.modalConfirmText}>Switch</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBtn: {
    paddingHorizontal: 4,
  },
  headerActionText: {
    color: '#4a9eff',
    fontSize: 15,
    fontWeight: '600',
  },
  projectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0f3460',
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  projectInfo: {
    flex: 1,
    marginRight: 12,
  },
  projectLabel: {
    color: '#888',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  projectDir: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '500',
  },
  switchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#4a9eff',
  },
  switchBtnDisabled: {
    opacity: 0.5,
  },
  switchBtnText: {
    color: '#4a9eff',
    fontSize: 13,
    fontWeight: '600',
  },
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
  listContent: {
    padding: 16,
    flexGrow: 1,
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalContent: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    color: '#eee',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#eee',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  modalCancelText: {
    color: '#888',
    fontSize: 15,
  },
  modalConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#4a9eff',
  },
  modalConfirmText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
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
  },
})
