import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, TextInput, Modal, Alert, Platform } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { useConfigStore } from '../stores/configStore'
import { useUiStore } from '../stores/uiStore'
import { useToolStore } from '../stores/toolStore'
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

  const config = useConfigStore((s) => s.config)
  const updateConfig = useConfigStore((s) => s.updateConfig)
  const agents = useConfigStore((s) => s.agents) as Array<{ name?: string; label?: string }>
  const providers = useConfigStore((s) => s.providers) as Array<{ name?: string; id?: string }>

  const [configEditVisible, setConfigEditVisible] = useState(false)
  const [configEditText, setConfigEditText] = useState('')

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

  const handleOpenConfigEdit = () => {
    setConfigEditText(JSON.stringify(config || {}, null, 2))
    setConfigEditVisible(true)
  }

  const handleSaveConfig = async () => {
    if (!client) return
    try {
      const parsed = JSON.parse(configEditText)
      await updateConfig(parsed, client.call.bind(client))
      setConfigEditVisible(false)
    } catch {
      Alert.alert('Error', 'Invalid JSON')
    }
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
        <Text style={styles.sectionLabel}>Config</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Config</Text>
          <TouchableOpacity onPress={handleOpenConfigEdit}>
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        </View>
        {config && Object.keys(config).length > 0 ? (
          Object.entries(config).slice(0, 5).map(([key, value]) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowLabel}>{key}</Text>
              <Text style={styles.rowValue} numberOfLines={1}>{String(value)}</Text>
            </View>
          ))
        ) : (
          <View style={styles.row}><Text style={styles.rowValue}>(none)</Text></View>
        )}
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
                  <Text style={{ color: '#e74c3c', fontSize: 13 }}>Delete</Text>
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

      <Modal
        visible={configEditVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setConfigEditVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setConfigEditVisible(false)}
        >
          <TouchableOpacity style={styles.modalContent} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.modalTitle}>Edit Config</Text>
            <TextInput
              style={styles.configEditor}
              value={configEditText}
              onChangeText={setConfigEditText}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              placeholder='{"theme": "dark"}'
              placeholderTextColor="#555"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setConfigEditVisible(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveConfig}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    color: '#eee',
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
    color: '#eee',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  editBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 32,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    color: '#eee',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  configEditor: {
    backgroundColor: colors.surfaceVariant,
    color: '#eee',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    minHeight: 200,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  cancelBtnText: {
    color: colors.textTertiary,
    fontSize: 15,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  saveBtnText: {
    color: colors.textOnPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
})
