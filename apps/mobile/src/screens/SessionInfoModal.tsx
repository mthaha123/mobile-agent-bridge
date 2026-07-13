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

type Tab = 'diff' | 'todo'

export const SessionInfoModal: React.FC<{
  visible: boolean
  sessionId: string | null
  onClose: () => void
}> = ({ visible, sessionId, onClose }) => {
  const [tab, setTab] = useState<Tab>('diff')

  const diffs = useDiffStore((s) => (sessionId ? s.diffs[sessionId] ?? [] : []))
  const todos = useTodoStore((s) => (sessionId ? s.todos[sessionId] ?? [] : []))

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
          <Text style={styles.title}>Session Info</Text>

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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#eee',
    marginBottom: 12,
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
})
