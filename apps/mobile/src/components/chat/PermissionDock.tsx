import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useToolStore } from '../../stores/toolStore'
import { useAuthStore } from '../../stores/authStore'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'

export const PermissionDock: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const approvals = useToolStore(s => s.pendingApprovals)
  const approve = useToolStore(s => s.approve)
  const reject = useToolStore(s => s.reject)
  const alwaysAllow = useToolStore(s => s.alwaysAllow)

  if (approvals.length === 0) return null

  // 每次只展示一张审批卡片，其余在队列中排队；当前卡片处理完成后自动显示下一个
  const current = approvals[0]
  const queuedCount = approvals.length - 1

  return (
    <View style={styles.dockArea}>
      <View style={styles.dockPrompt}>
        <View style={styles.dockHeader}>
          <Text style={styles.dockIcon}>🔒</Text>
          <Text style={styles.dockTitle}>工具请求</Text>
        </View>
        <View style={styles.dockBody}>
          <Text style={styles.toolName}>{current.tool}</Text>
          <Text style={styles.toolArgs} numberOfLines={2}>
            {JSON.stringify(current.args).slice(0, 150)}
          </Text>
        </View>
        <View style={styles.dockFooter}>
          <TouchableOpacity style={styles.rejectBtn} onPress={() => reject(current.id, getReplyCall())}>
            <Text style={styles.btnText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.approveBtn} onPress={() => approve(current.id, getReplyCall())}>
            <Text style={styles.btnText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.alwaysBtn} onPress={() => alwaysAllow(current.id, getReplyCall())}>
            <Text style={styles.btnText}>Always Allow</Text>
          </TouchableOpacity>
        </View>
        {queuedCount > 0 ? (
          <View style={styles.queuedBadge}>
            <Text style={styles.queuedBadgeText}>+{queuedCount}</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

function getReplyCall() {
  const client = useAuthStore.getState().client
  if (!client) return async () => {}
  return async (id: string, reply: 'once' | 'always' | 'reject') => {
    const { pendingApprovals } = useToolStore.getState()
    const item = pendingApprovals.find(a => a.id === id)
    if (!item) return
    await client.call('permission.reply', {
      sessionId: item.sessionId,
      id,
      reply,
    })
  }
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    dockArea: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      gap: 6,
    },
    queuedBadge: {
      position: 'absolute',
      top: 6,
      right: 6,
      backgroundColor: colors.primary,
      borderRadius: 10,
      minWidth: 18,
      height: 18,
      paddingHorizontal: 5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    queuedBadgeText: {
      color: colors.textOnPrimary,
      fontSize: 11,
      fontWeight: '700',
    },
    dockPrompt: {
      position: 'relative',
      backgroundColor: colors.surface,
      borderRadius: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.surfaceVariant,
    },
    dockHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surfaceVariant,
    },
    dockIcon: { fontSize: 14, marginRight: 8 },
    dockTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
    dockBody: {
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    toolName: { color: colors.text, fontSize: 14, fontWeight: '500', marginBottom: 4 },
    toolArgs: { color: colors.textTertiary, fontSize: 12, fontFamily: 'monospace' },
    dockFooter: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
    },
    rejectBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: 'rgba(231, 76, 60, 0.15)',
    },
    approveBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: 'rgba(46, 204, 113, 0.15)',
    },
    alwaysBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: 'rgba(74, 158, 255, 0.15)',
    },
    btnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  })
