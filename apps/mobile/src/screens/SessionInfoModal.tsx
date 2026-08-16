import React, { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
} from 'react-native'
import { useDiffStore, FileDiff } from '../stores/diffStore'
import { useTodoStore, TodoItem } from '../stores/todoStore'
import { useSessionStore, Session } from '../stores/sessionStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

type Tab = 'diff' | 'todo'

export const SessionInfoModal: React.FC<{
  visible: boolean
  sessionId: string | null
  onClose: () => void
}> = ({ visible, sessionId, onClose }) => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [tab, setTab] = useState<Tab>('diff')

  const diffs = useDiffStore((s) => (sessionId ? s.diffs[sessionId] ?? [] : []))
  const todos = useTodoStore((s) => (sessionId ? s.todos[sessionId] ?? [] : []))
  const sessions = useSessionStore((s) => s.sessions)

  const currentSession = sessions.find((s: Session) => s.id === sessionId)
  const sessionName = currentSession?.name || ''

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
            <Text style={styles.title} numberOfLines={1}>{sessionName || 'Session Info'}</Text>
          </View>

          {currentSession && (
            <View style={styles.sessionStatsRow}>
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: colors.surface,
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
    color: colors.text,
    flex: 1,
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
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#1a5276',
  },
  tabText: {
    color: colors.textTertiary,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.textOnPrimary,
  },
  body: {
    maxHeight: 400,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
  item: {
    backgroundColor: colors.surfaceVariant,
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
    color: colors.textTertiary,
    backgroundColor: colors.background,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
    textTransform: 'uppercase',
  },
  statusAdded: { color: colors.success },
  statusDeleted: { color: colors.error },
  statusModified: { color: colors.warning },
  fileName: {
    color: colors.text,
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
    color: colors.success,
    fontSize: 12,
    fontWeight: '600',
  },
  statDeleted: {
    color: colors.error,
    fontSize: 12,
    fontWeight: '600',
  },
  patch: {
    color: colors.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: colors.background,
    borderRadius: 4,
    padding: 6,
  },
  todoItem: {
    backgroundColor: colors.surfaceVariant,
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
    color: colors.textTertiary,
    marginRight: 8,
    marginTop: 1,
  },
  todoStatusDone: {
    color: colors.success,
  },
  todoContent: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  todoPriority: {
    color: colors.textTertiary,
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
    borderTopColor: colors.surfaceVariant,
  },
  sessionStatItem: {
    color: colors.textTertiary,
    fontSize: 12,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
})
