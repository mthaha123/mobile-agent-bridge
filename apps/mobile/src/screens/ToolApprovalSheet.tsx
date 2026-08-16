/**
 * ToolApprovalSheet — AI 工具调用审批面板
 *
 * 底部弹出 Modal，展示待审批的工具请求（名称 + 参数），
 * 由用户选择批准或拒绝。通过 useToolStore 管理状态。
 *
 * replyCall 通过 module-level 的 setToolReplyCall() 注入，
 * 由外部代码（如 BridgeClient 通知处理器）在 enqueue 时注册。
 */
import React, { useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Platform,
} from 'react-native'
import { useToolStore } from '../stores/toolStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

// ─── Module-level replyCall ──────────────────────────────
// 由外部（如通知处理器）在 enqueue ToolApproval 时注册，
// 用于将审批结果发回 Bridge 服务端。
let _replyCall:
  | ((id: string, reply: 'once' | 'always' | 'reject') => Promise<void>)
  | null = null

export function setToolReplyCall(
  cb: (id: string, reply: 'once' | 'always' | 'reject') => Promise<void>,
): void {
  _replyCall = cb
}

// ─── Component ───────────────────────────────────────────

export const ToolApprovalSheet: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const visible = useToolStore((s) => s.visible)
  const pendingApprovals = useToolStore((s) => s.pendingApprovals)
  const approve = useToolStore((s) => s.approve)
  const reject = useToolStore((s) => s.reject)
  const alwaysAllow = useToolStore((s) => s.alwaysAllow)
  const setVisible = useToolStore((s) => s.setVisible)

  // 当可见但队列已空时自动关闭
  useEffect(() => {
    if (visible && pendingApprovals.length === 0) {
      setVisible(false)
    }
  }, [visible, pendingApprovals, setVisible])

  const handleApprove = async (id: string) => {
    if (_replyCall) {
      await approve(id, _replyCall)
    }
  }

  const handleReject = async (id: string) => {
    if (_replyCall) {
      await reject(id, _replyCall)
    }
  }

  const handleAlwaysAllow = async (id: string) => {
    if (_replyCall) {
      await alwaysAllow(id, _replyCall)
    }
  }

  const handleDismiss = () => {
    setVisible(false)
  }

  const pending = pendingApprovals[0]

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleDismiss}
      >
        {/* 阻止 card 内部点击冒泡到 overlay */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={1}
          onPress={() => {}}
        >
          <Text style={styles.title}>Tool Request</Text>

          {pending ? (
            <>
              <Text style={styles.toolName}>{pending.tool}</Text>

              <ScrollView
                style={styles.argsContainer}
                showsVerticalScrollIndicator={false}
              >
                {pending.args && typeof pending.args === 'object'
                  ? Object.entries(pending.args).map(([key, value]) => (
                      <View key={key} style={styles.argRow}>
                        <Text style={styles.argKey}>{key}</Text>
                        <Text style={styles.argValue}>
                          {typeof value === 'object' && value !== null
                            ? JSON.stringify(value, null, 2)
                            : String(value)}
                        </Text>
                      </View>
                    ))
                  : null
                }
              </ScrollView>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.rejectButton]}
                  onPress={() => handleReject(pending.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionButtonText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.approveButton]}
                  onPress={() => handleApprove(pending.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionButtonText}>Approve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.alwaysButton]}
                  onPress={() => handleAlwaysAllow(pending.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionButtonText}>Always Allow</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={styles.noItems}>No pending requests</Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

// ─── Styles ──────────────────────────────────────────────

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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  toolName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e94560',
    marginBottom: 16,
  },
  argsContainer: {
    marginBottom: 20,
    maxHeight: 280,
  },
  argRow: {
    marginBottom: 12,
  },
  argKey: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  argValue: {
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 6,
    padding: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveButton: {
    backgroundColor: '#2ecc71',
  },
  rejectButton: {
    backgroundColor: '#e74c3c',
  },
  alwaysButton: {
    backgroundColor: '#f39c12',
  },
  actionButtonText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  noItems: {
    color: colors.textTertiary,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 40,
  },
})
