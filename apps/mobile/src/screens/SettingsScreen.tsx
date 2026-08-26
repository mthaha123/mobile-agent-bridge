import React, { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, Alert } from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { useConfigStore } from '../stores/configStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToolStore } from '../stores/toolStore'
import { useUiStore } from '../stores/uiStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'
import { ModelPickerModal } from '../components/ModelPickerModal'
import { APP_VERSION } from '../config/appInfo'

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

  const defaultAgent = useSettingsStore((s) => s.defaultAgent)
  const defaultModel = useSettingsStore((s) => s.defaultModel)
  const setDefaultAgent = useSettingsStore((s) => s.setDefaultAgent)
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel)
  const agents = useConfigStore((s) => s.agents) as Array<{ id?: string; name?: string; label?: string; description?: string }>
  const models = useConfigStore((s) => s.models)

  const [agentPickVisible, setAgentPickVisible] = useState(false)
  const [modelPickVisible, setModelPickVisible] = useState(false)
  const [bridgeVersion, setBridgeVersion] = useState('')

  useEffect(() => {
    if (client) {
      fetchSavedRules(client.call.bind(client))
    }
    if (!client) return
    let cancelled = false
    client
      .call('health.ping', {})
      .then((r: unknown) => {
        const v = (r as { bridgeVersion?: string } | null)?.bridgeVersion
        if (!cancelled) setBridgeVersion(typeof v === 'string' && v ? v : '(unknown)')
      })
      .catch(() => {
        if (!cancelled) setBridgeVersion('(unknown)')
      })
    return () => {
      cancelled = true
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

  // 按 tool 分组全量展示（不再截断前 10 条）
  const groupedRules = useMemo(() => {
    const groups = new Map<string, Array<Record<string, unknown>>>()
    for (const rule of savedRules as Array<Record<string, unknown>>) {
      const key = String(rule.tool || rule.action || 'other')
      const list = groups.get(key) ?? []
      list.push(rule)
      groups.set(key, list)
    }
    return [...groups.entries()]
  }, [savedRules])

  const confirmRemoveRule = (rule: Record<string, unknown>) => {
    Alert.alert(
      'Delete Permission Rule',
      String(rule.action || rule.id || ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { void handleRemoveRule(String(rule.id)) },
        },
      ],
    )
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
        <Text style={styles.sectionLabel}>Defaults</Text>
        <TouchableOpacity style={styles.row} onPress={() => setAgentPickVisible(true)}>
          <Text style={styles.rowLabel}>Default Agent</Text>
          <Text style={styles.rowValue}>{defaultAgent || 'Server default'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row} onPress={() => setModelPickVisible(true)}>
          <Text style={styles.rowLabel}>Default Model</Text>
          <Text style={styles.rowValue} numberOfLines={1}>
            {defaultModel ? `${defaultModel.providerID}/${defaultModel.id}` : 'Server default'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Saved Permissions ({savedRules.length})</Text>
        {savedRulesLoading ? (
          <View style={styles.row}><Text style={styles.rowValue}>Loading...</Text></View>
        ) : groupedRules.length > 0 ? (
          groupedRules.map(([tool, rules]) => (
            <View key={tool}>
              <Text style={styles.groupLabel}>{tool} ({rules.length})</Text>
              {rules.map((r, i) => (
                <View key={String(r.id || i)} style={styles.row}>
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {String(r.action || r.pattern || r.id || `Rule ${i + 1}`)}
                  </Text>
                  <TouchableOpacity
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => confirmRemoveRule(r)}
                  >
                    <Text style={{ color: colors.destructive, fontSize: 13 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ))
        ) : (
          <View style={styles.row}><Text style={styles.rowValue}>(none)</Text></View>
        )}
      </View>

      <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect} hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}>
        <Text style={styles.disconnectBtnText}>Disconnect</Text>
      </TouchableOpacity>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>App Version</Text>
          <Text style={styles.rowValue}>v{APP_VERSION}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Bridge Version</Text>
          <Text style={styles.rowValue}>{bridgeVersion ? `v${bridgeVersion}` : '…'}</Text>
        </View>
      </View>

      <Modal visible={agentPickVisible} transparent animationType="slide" onRequestClose={() => setAgentPickVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAgentPickVisible(false)}>
          <TouchableOpacity style={styles.modalContent} activeOpacity={1} onPress={() => {}}>
            <Text style={styles.modalTitle}>Default Agent</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => { void setDefaultAgent(null); setAgentPickVisible(false) }}
              >
                <Text style={styles.rowLabel}>Server default</Text>
              </TouchableOpacity>
              {agents
                .filter((a) => {
                  // 只列可作会话默认的 primary agent：排除 subagent(general/explore)
                  // 与系统内部 agent(compaction/title/summary，无描述)
                  const mode = String((a as { mode?: string }).mode ?? 'primary')
                  return mode === 'primary' && !!a.description
                })
                .map((a, i) => {
                // opencode /api/agent 形态：{ id, description, mode }——无 name/label，
                // 身份与回传值一律用 id；label/name 仅作显示优先
                const id = String(a.id || a.name || '')
                if (!id) return null
                return (
                  <TouchableOpacity
                    key={id}
                    style={styles.row}
                    onPress={() => { void setDefaultAgent(id); setAgentPickVisible(false) }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel} numberOfLines={1}>{a.label || a.name || id}</Text>
                      {a.description ? (
                        <Text numberOfLines={1} style={styles.agentDesc}>{a.description}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ModelPickerModal
        visible={modelPickVisible}
        onClose={() => setModelPickVisible(false)}
        onSelect={(m) => {
          // 与 ChatScreen 相同的身份提取：id + providerID(+variant)，同名跨 provider 不串
          const entry = (m && typeof m === 'object' ? m : {}) as { id?: string; providerID?: string; variant?: string }
          if (entry.id && entry.providerID) {
            void setDefaultModel({
              id: entry.id,
              providerID: entry.providerID,
              ...(entry.variant ? { variant: entry.variant } : {}),
            })
          }
          setModelPickVisible(false)
        }}
        models={models}
        currentModel={defaultModel}
      />
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
  groupLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
    marginBottom: 4,
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
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 16,
  },
  agentDesc: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
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
