import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { useConfigStore } from '../stores/configStore'
import { useUiStore } from '../stores/uiStore'

export const SettingsScreen: React.FC = () => {
  const client = useAuthStore((s) => s.client)
  const bridgeUrl = useAuthStore((s) => s.bridgeUrl)
  const directory = useProjectStore((s) => s.directory)
  const logout = useAuthStore((s) => s.logout)
  const setScreen = useUiStore((s) => s.setScreen)

  const vcs = useConfigStore((s) => s.vcs) as Record<string, unknown> | null
  const vcsType = vcs?.type || vcs?.vcs || ''
  const vcsBranch = vcs?.branch || vcs?.currentBranch || ''
  const agents = useConfigStore((s) => s.agents) as Array<{ name?: string; label?: string }>
  const providers = useConfigStore((s) => s.providers) as Array<{ name?: string; id?: string }>

  const handleDisconnect = () => {
    logout()
    setScreen('connect')
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
          <Text style={[styles.rowValue, { color: client?.connected ? '#2ecc71' : '#e74c3c' }]}>
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
        <Text style={styles.sectionLabel}>VCS</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Type</Text>
          <Text style={styles.rowValue}>{vcsType ? String(vcsType) : '(none)'}</Text>
        </View>
        {vcsBranch ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Branch</Text>
            <Text style={styles.rowValue}>{String(vcsBranch)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Providers ({providers.length})</Text>
        {providers.length > 0 ? providers.slice(0, 5).map((p, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.rowLabel}>{p.name || p.id || `Provider ${i + 1}`}</Text>
          </View>
        )) : (
          <View style={styles.row}><Text style={styles.rowValue}>(none)</Text></View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Agents ({agents.length})</Text>
        {agents.length > 0 ? agents.slice(0, 5).map((a, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.rowLabel}>{a.label || a.name || `Agent ${i + 1}`}</Text>
          </View>
        )) : (
          <View style={styles.row}><Text style={styles.rowValue}>(none)</Text></View>
        )}
      </View>

      <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
        <Text style={styles.disconnectBtnText}>Disconnect</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 16,
  },
  title: {
    color: '#eee',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 14,
    marginBottom: 6,
  },
  rowLabel: {
    color: '#aaa',
    fontSize: 14,
  },
  rowValue: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  disconnectBtn: {
    backgroundColor: '#c0392b',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  disconnectBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
})
