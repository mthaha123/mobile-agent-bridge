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
  ScrollView,
} from 'react-native'
import { useSessionStore } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now()
  const date = new Date(isoDate).getTime()
  const diffMs = now - date

  const seconds = Math.floor(diffMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (days >= 1) {
    if (days < 7) return `${days}d ago`
    return new Date(isoDate).toLocaleDateString()
  }
  if (hours >= 1) return `${hours}h ago`
  return `${minutes}m ago`
}

export const SessionsScreen: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [switchDirInput, setSwitchDirInput] = useState('')
  const [showSwitchModal, setShowSwitchModal] = useState(false)
  const [renameTarget, setRenameTarget] = useState<import('../stores/sessionStore').Session | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [renaming, setRenaming] = useState(false)

  const sessions = useSessionStore((s) => s.sessions)
  const loading = useSessionStore((s) => s.loading)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const createSession = useSessionStore((s) => s.createSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const directory = useProjectStore((s) => s.directory)
  const switching = useProjectStore((s) => s.switching)
  const projects = useProjectStore((s) => s.projects)
  const switchProject = useProjectStore((s) => s.switchProject)
  const listProjects = useProjectStore((s) => s.listProjects)
  const pushChat = useUiStore((s) => s.pushChat)

  const handleOpenSwitch = () => {
    const client = useAuthStore.getState().client
    setSwitchDirInput(directory || '')
    setShowSwitchModal(true)
    if (client) {
      listProjects(client.call.bind(client))
    }
  }

  const handleConfirmSwitch = async () => {
    if (switchDirInput.trim()) {
      setShowSwitchModal(false)
      await switchProject(switchDirInput.trim())
    } else {
      Alert.alert('Error', '请输入项目目录路径')
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
    if (!client) { Alert.alert('Error', '未连接到服务器'); return }
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

  const handleOpenRename = (session: import('../stores/sessionStore').Session) => {
    setRenameTarget(session)
    setRenameInput(session.name || '')
  }

  const handleConfirmRename = async () => {
    if (!renameTarget || renaming) return
    const title = renameInput.trim()
    if (!title) { Alert.alert('Error', '请输入会话名称'); return }
    const client = useAuthStore.getState().client
    if (!client) { Alert.alert('Error', '未连接到服务器'); return }
    setRenaming(true)
    try {
      await renameSession(renameTarget.id, title, client.call.bind(client))
      setRenameTarget(null)
    } finally {
      setRenaming(false)
    }
  }

  const renderSession = ({ item }: { item: import('../stores/sessionStore').Session }) => {
    const displayName = item.name || `Session ${item.id.slice(0, 8)}`

    return (
      <TouchableOpacity
        style={styles.sessionCard}
        onPress={() => handleSelectSession(item.id)}
        onLongPress={() => handleOpenRename(item)}
        activeOpacity={0.7}
        accessibilityLabel={`Session ${displayName}`}
      >
        <View style={styles.sessionInfo}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.sessionMeta}>
            <Text style={styles.sessionId} numberOfLines={1}>
              {item.id}
            </Text>
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
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.switchBtnText}>Switch</Text>
          )}
        </TouchableOpacity>
      </View>

      {loading && sessions.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
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
            {projects.length > 0 && (
              <ScrollView style={styles.projectList}>
                {projects.map((p: { directory: string; name?: string }, i: number) => (
                  <TouchableOpacity
                    key={i}
                    style={[styles.projectListItem, p.directory === directory && styles.projectListItemActive]}
                    onPress={() => {
                      setShowSwitchModal(false)
                      switchProject(p.directory)
                    }}
                  >
                    <Text style={styles.projectListItemName}>
                      {p.name || (p.directory || '').split('/').pop() || p.directory || '(none)'}
                    </Text>
                    <Text style={styles.projectListItemDir} numberOfLines={1}>{p.directory}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TextInput
              style={styles.modalInput}
              value={switchDirInput}
              onChangeText={setSwitchDirInput}
              placeholder="/home/user/project"
              placeholderTextColor={colors.textTertiary}
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

      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>重命名会话</Text>
            <TextInput
              style={styles.modalInput}
              value={renameInput}
              onChangeText={setRenameInput}
              placeholder="输入新名称"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              maxLength={100}
              accessibilityLabel="Rename session input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setRenameTarget(null)}
              >
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleConfirmRename}
                disabled={renaming}
              >
                <Text style={styles.modalConfirmText}>{renaming ? '保存中...' : '保存'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
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
    justifyContent: 'space-between',
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
    color: colors.text,
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
    color: colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  projectBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surfaceVariant,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  projectInfo: {
    flex: 1,
    marginRight: 12,
  },
  projectLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  projectDir: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  switchBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  switchBtnDisabled: {
    opacity: 0.5,
  },
  switchBtnText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.textTertiary,
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
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginVertical: 6,
    padding: 16,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  sessionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionId: {
    color: colors.textSecondary,
    fontSize: 12,
    marginRight: 8,
    flexShrink: 1,
  },
  sessionMetaText: {
    color: colors.textTertiary,
    fontSize: 13,
  },
  sessionChevron: {
    color: colors.textTertiary,
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
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  projectList: {
    maxHeight: 200,
    marginBottom: 12,
  },
  projectListItem: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  projectListItemActive: {
    borderWidth: 1,
    borderColor: colors.primary,
  },
  projectListItemName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  projectListItemDir: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  modalInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
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
    color: colors.textTertiary,
    fontSize: 15,
  },
  modalConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  modalConfirmText: {
    color: colors.textOnPrimary,
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
    color: colors.textTertiary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
})
