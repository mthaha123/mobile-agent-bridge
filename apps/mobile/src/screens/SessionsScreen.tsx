import React, { useEffect, useCallback, useMemo, useState } from 'react'
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
import { useSessionStore, filterSessions } from '../stores/sessionStore'
import { useAuthStore } from '../stores/authStore'
import { useChatStore } from '../stores/chatStore'
import { useProjectStore } from '../stores/projectStore'
import { useServeStore, type ServeEntry } from '../stores/serveStore'
import { useUiStore } from '../stores/uiStore'
import { useQuestionStore } from '../stores/questionStore'
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

/** 目录末段名（Windows / POSIX 路径都兼容），用于列表项展示 */
function baseName(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() || dir
}

/** Switch Project 弹窗里的可选项目：有 serve 的项目优先（点选即切，无需手输目录） */
export interface SwitchCandidate {
  key: string
  directory: string
  name: string
  /** 该目录注册的 serve 实例 id；undefined = 无 serve，切换时走默认 serve */
  serveId?: string
  port?: number
  status?: ServeEntry['status']
}

export const SessionsScreen: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [switchDirInput, setSwitchDirInput] = useState('')
  const [showSwitchModal, setShowSwitchModal] = useState(false)
  /** 正在拉起的 serve 项目 id（点选 stopped 项目时先起 serve 再切换） */
  const [pendingServeId, setPendingServeId] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<import('../stores/sessionStore').Session | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [renaming, setRenaming] = useState(false)
  // 会话搜索：按名称 / id 模糊匹配（客户端本地过滤，输入即时生效）
  const [searchQuery, setSearchQuery] = useState('')

  const sessions = useSessionStore((s) => s.sessions)
  const loading = useSessionStore((s) => s.loading)
  const filteredSessions = filterSessions(sessions, searchQuery)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const createSession = useSessionStore((s) => s.createSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  // 会话运行状态（session.status / session.idle 通知 + RPC 快照）→ 列表运行红点
  const sessionRunStatus = useChatStore((s) => s.sessionRunStatus)
  // 待回答提问（含息屏/断线期间对账补回的）→ 列表徽标，未进入会话也能发现
  const pendingQuestions = useQuestionStore((s) => s.pending)
  const directory = useProjectStore((s) => s.directory)
  const project = useProjectStore((s) => s.project)
  const switching = useProjectStore((s) => s.switching)
  const currentServe = useProjectStore((s) => s.currentServe)
  const projects = useProjectStore((s) => s.projects)
  const switchProject = useProjectStore((s) => s.switchProject)
  const listProjects = useProjectStore((s) => s.listProjects)
  // 有服务器（serve 已注册）的项目清单 → 切换项目时点选即可，不必每次输目录
  const serves = useServeStore((s) => s.serves)
  const servesLoading = useServeStore((s) => s.loading)
  const fetchServes = useServeStore((s) => s.fetchServes)
  const startServe = useServeStore((s) => s.startServe)
  const pushChat = useUiStore((s) => s.pushChat)

  /** 可切换项目候选：serve 项目优先，其次 project.list，最后当前项目兜底（按 directory 去重） */
  const switchCandidates = useMemo<SwitchCandidate[]>(() => {
    const out: SwitchCandidate[] = []
    const seen = new Set<string>()
    const push = (c: SwitchCandidate) => {
      if (!c.directory || seen.has(c.directory)) return
      seen.add(c.directory)
      out.push(c)
    }
    serves.forEach((s) =>
      push({
        key: `serve:${s.id}`,
        directory: s.directory,
        name: s.name || baseName(s.directory),
        serveId: s.id,
        port: s.port,
        status: s.status,
      }),
    )
    projects.forEach((p) =>
      push({
        key: `project:${p.directory}`,
        directory: p.directory,
        name: p.name || baseName(p.directory),
      }),
    )
    if (directory) {
      push({
        key: `current:${directory}`,
        directory,
        name: project?.name || baseName(directory),
      })
    }
    return out
  }, [serves, projects, directory, project])

  const handleOpenSwitch = () => {
    const client = useAuthStore.getState().client
    setSwitchDirInput(directory || '')
    setShowSwitchModal(true)
    if (client) {
      const call = client.call.bind(client)
      // 有服务器的项目清单（serve.list）+ 当前项目兜底（project.list）
      fetchServes(call)
      listProjects(call)
    }
  }

  /**
   * 点选候选项目：有 serve 且未运行 → 先拉起 serve，再切换。
   * （直接切到 stopped 的 serve 会让 SDK 连上死端口，后续 RPC 全挂）
   */
  const handleSelectProject = async (candidate: SwitchCandidate) => {
    if (pendingServeId) return
    const client = useAuthStore.getState().client
    if (!client) { Alert.alert('Error', '未连接到服务器'); return }
    const call = client.call.bind(client)

    if (candidate.serveId && candidate.status !== 'running') {
      setPendingServeId(candidate.serveId)
      try {
        const started = await startServe(call, candidate.serveId)
        if (!started) {
          Alert.alert('Error', `启动 ${candidate.name} 的 serve 失败（端口耗尽或 opencode 缺失）`)
          return
        }
      } catch (e) {
        Alert.alert('Error', `启动 serve 失败: ${e instanceof Error ? e.message : String(e)}`)
        return
      } finally {
        setPendingServeId(null)
      }
    }

    setShowSwitchModal(false)
    try {
      await switchProject(candidate.directory)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : '切换项目失败')
    }
  }

  const handleConfirmSwitch = async () => {
    const dir = switchDirInput.trim()
    if (!dir) {
      Alert.alert('Error', '请输入项目目录路径')
      return
    }
    // 手输目录若命中候选（含 serve 项目），走同一条「先起 serve 再切换」路径
    const candidate = switchCandidates.find((c) => c.directory === dir)
    if (candidate) {
      await handleSelectProject(candidate)
      return
    }
    setShowSwitchModal(false)
    try {
      await switchProject(dir)
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : '切换项目失败')
    }
  }

  const loadSessions = useCallback(async () => {
    const client = useAuthStore.getState().client
    if (!client) return
    // 会话列表加载时同步运行状态快照：校正重连后错过的 idle 事件，
    // 让列表红点与真实运行态一致（session.status RPC 返回运行中会话集合）
    useChatStore.getState().syncSessionRunStatus(client.call.bind(client))
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
    const runStatus = sessionRunStatus[item.id]
    const isRunning = runStatus === 'busy' || runStatus === 'retry'
    // 该会话有待回答的提问（可能是息屏期间对账补回的）→ 列表页也要看得见
    const pendingCount = pendingQuestions.filter((q) => q.sessionId === item.id).length

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
            {isRunning ? (
              <View style={styles.runningDot} testID="session-running-dot" />
            ) : null}
            {pendingCount > 0 ? (
              <Text style={styles.pendingBadge} testID="session-pending-question">
                ❓ 待回答{pendingCount > 1 ? ` ${pendingCount}` : ''}
              </Text>
            ) : null}
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
    // 区分「还没有会话」与「搜索无结果」两种空态
    if (searchQuery.trim() && sessions.length > 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyText}>
            No sessions match "{searchQuery.trim()}".
          </Text>
        </View>
      )
    }
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
          {currentServe ? (
            <Text style={styles.projectServe} numberOfLines={1}>
              ⚡ {currentServe.name} · :{currentServe.port}
              {currentServe.status === 'running' ? '' : ` · ${currentServe.status}`}
            </Text>
          ) : null}
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

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by name or id..."
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Session search input"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.searchClearBtn}
            onPress={() => setSearchQuery('')}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Clear session search"
          >
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && sessions.length === 0 && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading sessions...</Text>
        </View>
      )}

      <FlatList
        data={filteredSessions}
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
            {switchCandidates.length > 0 ? (
              <ScrollView style={styles.projectList}>
                {switchCandidates.map((c) => {
                  const isPending = pendingServeId === c.serveId
                  const isActive = c.directory === directory
                  return (
                    <TouchableOpacity
                      key={c.key}
                      testID={`switch-project-${c.key}`}
                      accessibilityLabel={`Switch to ${c.name}`}
                      style={[
                        styles.projectListItem,
                        isActive && styles.projectListItemActive,
                        pendingServeId !== null && styles.projectListItemDisabled,
                      ]}
                      disabled={pendingServeId !== null}
                      onPress={() => handleSelectProject(c)}
                    >
                      <View style={styles.projectListItemHeader}>
                        <Text style={styles.projectListItemName} numberOfLines={1}>
                          {c.name}
                        </Text>
                        {isPending ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : isActive ? (
                          <Text style={styles.projectListCurrentTag}>current</Text>
                        ) : null}
                      </View>
                      <Text style={styles.projectListItemDir} numberOfLines={1}>{c.directory}</Text>
                      {c.serveId ? (
                        <Text
                          testID={`switch-project-serve-${c.serveId}`}
                          style={[
                            styles.projectServeMeta,
                            c.status === 'running' ? styles.projectServeRunning : styles.projectServeStopped,
                          ]}
                          numberOfLines={1}
                        >
                          ⚡ :{c.port} · {isPending ? 'starting serve…' : (c.status === 'running' ? 'running' : 'stopped · tap to start')}
                        </Text>
                      ) : (
                        <Text style={styles.projectServeMeta} numberOfLines={1}>
                          no serve · uses default
                        </Text>
                      )}
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            ) : servesLoading ? (
              <View style={styles.projectListLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.projectListEmpty}>Loading projects…</Text>
              </View>
            ) : (
              <Text style={styles.projectListEmpty}>
                No projects yet. Add one in Settings → OpenCode Serves, or enter a directory below.
              </Text>
            )}
            <Text style={styles.modalHint}>Or enter a directory manually</Text>
            <TextInput
              style={styles.modalInput}
              value={switchDirInput}
              onChangeText={setSwitchDirInput}
              placeholder="/home/user/project"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Switch project directory input"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowSwitchModal(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmBtn, pendingServeId !== null && styles.switchBtnDisabled]}
                onPress={handleConfirmSwitch}
                disabled={pendingServeId !== null}
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
  projectServe: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
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
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
  },
  searchClearBtn: {
    marginLeft: 8,
    padding: 4,
  },
  searchClearText: {
    color: colors.textTertiary,
    fontSize: 16,
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
  runningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
    marginRight: 6,
  },
  pendingBadge: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.warning,
    marginRight: 6,
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
  projectListItemDisabled: {
    opacity: 0.6,
  },
  projectListItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  projectListItemName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    flexShrink: 1,
  },
  projectListCurrentTag: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  projectListItemDir: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  projectServeMeta: {
    fontSize: 11,
    marginTop: 4,
  },
  projectServeRunning: {
    color: colors.success,
  },
  projectServeStopped: {
    color: colors.warning,
  },
  projectListEmpty: {
    color: colors.textTertiary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  projectListLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  modalHint: {
    color: colors.textTertiary,
    fontSize: 12,
    marginBottom: 6,
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
