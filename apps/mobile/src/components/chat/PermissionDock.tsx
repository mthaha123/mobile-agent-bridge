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

  return (
    <View style={styles.dockArea}>
      {approvals.map(item => (
        <View key={item.id} style={styles.dockPrompt}>
          <View style={styles.dockHeader}>
            <Text style={styles.dockIcon}>🔒</Text>
            <Text style={styles.dockTitle}>工具请求</Text>
          </View>
          <View style={styles.dockBody}>
            <Text style={styles.toolName}>{item.tool}</Text>
            <Text style={styles.toolArgs} numberOfLines={2}>
              {JSON.stringify(item.args).slice(0, 150)}
            </Text>
          </View>
          <View style={styles.dockFooter}>
            <TouchableOpacity style={styles.rejectBtn} onPress={() => reject(item.id, getReplyCall())}>
              <Text style={styles.btnText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.approveBtn} onPress={() => approve(item.id, getReplyCall())}>
              <Text style={styles.btnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.alwaysBtn} onPress={() => alwaysAllow(item.id, getReplyCall())}>
              <Text style={styles.btnText}>Always Allow</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
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
    dockPrompt: {
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
