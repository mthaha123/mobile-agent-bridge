import React, { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
  TextInput,
  Alert,
} from 'react-native'
import { useDiffStore, FileDiff } from '../stores/diffStore'
import { useTodoStore, TodoItem } from '../stores/todoStore'
import { useSessionStore, Session } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'

type Tab = 'diff' | 'todo' | 'children'

export const SessionInfoModal: React.FC<{
  visible: boolean
  sessionId: string | null
  onClose: () => void
}> = ({ visible, sessionId, onClose }) => {
  const [tab, setTab] = useState<Tab>('diff')
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')

  const [children, setChildren] = useState<any[]>([])
  const diffs = useDiffStore((s) => (sessionId ? s.diffs[sessionId] ?? [] : []))
  const todos = useTodoStore((s) => (sessionId ? s.todos[sessionId] ?? [] : []))
  const sessions = useSessionStore((s) => s.sessions)
  const client = useAuthStore((s) => s.client)

  useEffect(() => {
    if (sessionId && client) {
      useSessionStore.getState().getSessionChildren(sessionId, client.call.bind(client)).then(setChildren)
    } else {
      setChildren([])
    }
  }, [sessionId])

  const currentSession = sessions.find((s: Session) => s.id === sessionId)
  const sessionName = currentSession?.name || ''

  const handleRename = async () => {
    const name = newName.trim()
    if (!name || !sessionId || !client) return
    try {
      await useSessionStore.getState().renameSession(sessionId, name, client.call.bind(client))
      setRenaming(false)
    } catch {
      Alert.alert('Error', 'Failed to rename session')
    }
  }

  const handleFork = async () => {
    if (!sessionId || !client) return
    try {
      const newId = await useSessionStore.getState().forkSession(sessionId, client.call.bind(client))
      if (newId) {
        Alert.alert('Forked', `New session: ${newId.slice(0, 8)}...`)
        onClose()
        await useSessionStore.getState().fetchSessions(client.call.bind(client))
      } else {
        Alert.alert('Error', 'Fork returned no session ID')
      }
    } catch {
      Alert.alert('Error', 'Failed to fork session')
    }
  }

  const handleUnrevert = async () => {
    if (!sessionId || !client) return
    try {
      await useSessionStore.getState().unrevertSession(sessionId, client.call.bind(client))
      Alert.alert('Unreverted', 'Session has been unreverted')
    } catch {
      Alert.alert('Error', 'Failed to unrevert session')
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={styles.card}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={styles.titleRow}>
            {renaming ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={styles.renameInput}
                  value={newName}
                  onChangeText={setNewName}
                  onSubmitEditing={handleRename}
                  placeholder="Session name"
                  placeholderTextColor="#666"
                  autoFocus
                />
                <TouchableOpacity style={styles.renameSaveBtn} onPress={handleRename}>
                  <Text style={styles.renameSaveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setRenaming(false)}>
                  <Text style={styles.renameCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.title} numberOfLines={1}>{sessionName || 'Session Info'}</Text>
                <View style={styles.titleActions}>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleUnrevert}>
                    <Text style={styles.actionBtnText}>Unrevert</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={handleFork}>
                    <Text style={styles.actionBtnText}>Fork</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setNewName(sessionName || ''); setRenaming(true) }}
                    style={styles.actionBtn}
                  >
                    <Text style={styles.actionBtnText}>✏️</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {currentSession && (
            <View style={styles.sessionStatsRow}>
              <Text style={styles.sessionStatItem}>
                {currentSession.messageCount ?? 0} msgs
              </Text>
              {currentSession.createdAt && (
                <Text style={styles.sessionStatItem}>
                  Created {formatTime(currentSession.createdAt)}
                </Text>
              )}
              {currentSession.updatedAt && (
                <Text style={styles.sessionStatItem}>
                  Updated {formatTime(currentSession.updatedAt)}
                </Text>
              )}
            </View>
          )}

          <View style={styles.tabs}>
            <TouchableOpacity
              style={[styles.tab, tab === 'diff' && styles.tabActive]}
              onPress={() => setTab('diff')}
            >
              <Text
                style={[styles.tabText, tab === 'diff' && styles.tabTextActive]}
              >
                Diffs ({diffs.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === 'todo' && styles.tabActive]}
              onPress={() => setTab('todo')}
            >
              <Text
                style={[styles.tabText, tab === 'todo' && styles.tabTextActive]}
              >
                Todos ({todos.length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, tab === 'children' && styles.tabActive]}
              onPress={() => setTab('children')}
            >
              <Text
                style={[styles.tabText, tab === 'children' && styles.tabTextActive]}
              >
                Children ({children.length})
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
          >
            {tab === 'diff' && diffs.length === 0 && (
              <Text style={styles.emptyText}>No file changes</Text>
            )}
            {tab === 'diff' &&
              diffs.map((d: FileDiff, i: number) => (
                <View key={i} style={styles.item}>
                  <View style={styles.itemHeader}>
                    <Text
                      style={[
                        styles.statusBadge,
                        d.status === 'added' && styles.statusAdded,
                        d.status === 'deleted' && styles.statusDeleted,
                        d.status === 'modified' && styles.statusModified,
                      ]}
                    >
                      {d.status || 'modified'}
                    </Text>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {d.file || 'unknown'}
                    </Text>
                  </View>
                  <View style={styles.statsRow}>
                    <Text style={styles.statAdded}>+{d.additions}</Text>
                    <Text style={styles.statDeleted}>-{d.deletions}</Text>
                  </View>
                  {d.patch ? (
                    <Text style={styles.patch} numberOfLines={5}>
                      {d.patch}
                    </Text>
                  ) : null}
                </View>
              ))}

            {tab === 'children' && children.length === 0 && (
              <Text style={styles.emptyText}>No child sessions</Text>
            )}
            {tab === 'children' &&
              children.map((child: any, i: number) => (
                <View key={i} style={styles.item}>
                  <Text style={styles.fileName}>{child.name || child.id || `Session ${i + 1}`}</Text>
                  <Text style={styles.childrenMeta}>
                    {child.messageCount ?? 0} msgs
                    {child.createdAt ? ` · ${formatTime(child.createdAt)}` : ''}
                  </Text>
                </View>
              ))}

            {tab === 'todo' && todos.length === 0 && (
              <Text style={styles.emptyText}>No todos</Text>
            )}
            {tab === 'todo' &&
              todos.map((t: TodoItem, i: number) => (
                <View key={i} style={styles.todoItem}>
                  <View style={styles.todoHeader}>
                    <Text
                      style={[
                        styles.todoStatus,
                        t.status === 'done' && styles.todoStatusDone,
                      ]}
                    >
                      {t.status === 'done' ? '✓' : '○'}
                    </Text>
                    <Text style={styles.todoContent}>{t.content}</Text>
                  </View>
                  {t.priority ? (
                    <Text style={styles.todoPriority}>Priority: {t.priority}</Text>
                  ) : null}
                </View>
              ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

function formatTime(t: string): string {
  try {
    const d = new Date(t)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return t
  }
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#eee',
    flex: 1,
  },
  titleActions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionBtn: {
    backgroundColor: '#0f3460',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  actionBtnText: {
    color: '#8ab4f8',
    fontSize: 13,
    fontWeight: '600',
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  renameInput: {
    flex: 1,
    backgroundColor: '#0f3460',
    color: '#eee',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 16,
  },
  renameSaveBtn: {
    backgroundColor: '#1a5276',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  renameSaveText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  renameCancelText: {
    color: '#888',
    fontSize: 14,
  },
  tabs: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#0f3460',
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#1a5276',
  },
  tabText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#fff',
  },
  body: {
    maxHeight: 400,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
  item: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
    backgroundColor: '#1a1a2e',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
    textTransform: 'uppercase',
  },
  statusAdded: { color: '#2ecc71' },
  statusDeleted: { color: '#e74c3c' },
  statusModified: { color: '#f39c12' },
  fileName: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  statAdded: {
    color: '#2ecc71',
    fontSize: 12,
    fontWeight: '600',
  },
  statDeleted: {
    color: '#e74c3c',
    fontSize: 12,
    fontWeight: '600',
  },
  childrenMeta: {
    color: '#888',
    fontSize: 12,
    marginTop: 4,
  },
  patch: {
    color: '#aaa',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#1a1a2e',
    borderRadius: 4,
    padding: 6,
  },
  todoItem: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  todoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  todoStatus: {
    fontSize: 16,
    color: '#888',
    marginRight: 8,
    marginTop: 1,
  },
  todoStatusDone: {
    color: '#2ecc71',
  },
  todoContent: {
    color: '#eee',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  todoPriority: {
    color: '#888',
    fontSize: 11,
    marginTop: 6,
    marginLeft: 24,
  },
  sessionStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#0f3460',
  },
  sessionStatItem: {
    color: '#888',
    fontSize: 12,
    backgroundColor: '#0f3460',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
})
