import React, { useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { useToolStore } from '../stores/toolStore'
import { useUiStore } from '../stores/uiStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

export const SettingsScreen: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const client = useAuthStore((s) => s.client)
  const bridgeUrl = useAuthStore((s) => s.bridgeUrl)
  const directory = useProjectStore((s) => s.directory)
  const logout = useAuthStore((s) => s.logout)
  const setScreen = useUiStore((s) => s.setScreen)

  const savedRules = useToolStore((s) => s.savedRules)
  const savedRulesLoading = useToolStore((s) => s.savedRulesLoading)
  const fetchSavedRules = useToolStore((s) => s.fetchSavedRules)
  const removeSavedRule = useToolStore((s) => s.removeSavedRule)

  useEffect(() => {
    if (client) {
      fetchSavedRules(client.call.bind(client))
    }
  }, [])

  const handleDisconnect = () => {
    logout()
    setScreen('connect')
  }

  const handleRemoveRule = async (id: string) => {
    if (!client) return
    await removeSavedRule(id, client.call.bind(client))
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Connection</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Bridge URL</Text>
          <Text style={styles.rowValue} numberOfLines={1}>{bridgeUrl || '(none)'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Status</Text>
          <Text style={[styles.rowValue, { color: client?.connected ? colors.success : colors.error }]}>
            {client?.connected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Project</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Directory</Text>
          <Text style={styles.rowValue} numberOfLines={1}>{directory || '(none)'}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Saved Permissions ({savedRules.length})</Text>
        {savedRulesLoading ? (
          <View style={styles.row}><Text style={styles.rowValue}>Loading...</Text></View>
        ) : savedRules.length > 0 ? (
          savedRules.slice(0, 10).map((rule: unknown, i: number) => {
            const r = rule as Record<string, unknown>
            return (
              <View key={i} style={styles.row}>
                <Text style={styles.rowLabel}>{String(r.tool || r.action || r.id || `Rule ${i + 1}`)}</Text>
                <TouchableOpacity onPress={() => handleRemoveRule(String(r.id))}>
                  <Text style={{ color: colors.destructive, fontSize: 13 }}>Delete</Text>
                </TouchableOpacity>
              </View>
            )
          })
        ) : (
          <View style={styles.row}><Text style={styles.rowValue}>(none)</Text></View>
        )}
      </View>

      <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
        <Text style={styles.disconnectBtnText}>Disconnect</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    color: colors.textTertiary,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 14,
    marginBottom: 6,
  },
  rowLabel: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  rowValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  disconnectBtn: {
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  disconnectBtnText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
})
