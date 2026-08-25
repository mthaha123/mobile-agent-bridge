import React, { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native'
import { useThemeColors } from '../theme/ThemeContext'
import type { ThemeColors } from '../theme/colors'

interface ModelEntry {
  id?: string
  providerID?: string
  name?: string
  label?: string
}

interface ModelPickerModalProps {
  visible: boolean
  onClose: () => void
  onSelect: (model: unknown) => void
  models: unknown[]
  currentModel?: { id?: string; providerID?: string } | null
}

/** 归一化一条模型记录：label 取 name > id > label 兜底 */
function normalize(m: unknown, i: number): { key: string; label: string; provider: string; id: string; raw: unknown } {
  const e = (m && typeof m === 'object' ? m : {}) as ModelEntry
  const label = e.name || e.id || e.label || `Model ${i + 1}`
  const provider = e.providerID || ''
  return { key: `${provider}:${e.id || i}`, label, provider, id: e.id || '', raw: m }
}

export function ModelPickerModal({ visible, onClose, onSelect, models, currentModel }: ModelPickerModalProps) {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [query, setQuery] = useState('')

  // 每次打开清空上次搜索词
  useEffect(() => {
    if (visible) setQuery('')
  }, [visible])

  const items = useMemo(() => (Array.isArray(models) ? models : []).map(normalize), [models])

  // 大小写不敏感子串匹配：名称 + id + 服务商任一命中即保留
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => `${it.label} ${it.id} ${it.provider}`.toLowerCase().includes(q))
  }, [items, query])

  const isCurrent = (raw: unknown) => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as ModelEntry
    // 同名模型可能来自不同 provider（如 deepseek-v4-flash 同时存在于
    // opencode 与 opencode-go）：必须 (id + providerID) 双字段匹配，
    // 确保只有真正正在使用的那个被标记 ✓。
    const cid = currentModel?.id
    const cpid = currentModel?.providerID
    return cid != null && e.id === cid && (!cpid || e.providerID === cpid)
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>Select Model</Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索模型…"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="Search models"
            />
            {query.length > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => setQuery('')}
                accessibilityLabel="Clear search"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.clearButtonText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {(!Array.isArray(models) || models.length === 0) && (
              <Text style={styles.empty}>No models loaded</Text>
            )}
            {Array.isArray(models) && models.length > 0 && filtered.length === 0 && (
              <Text style={styles.empty}>无匹配模型</Text>
            )}
            {filtered.map((it) => {
              const current = isCurrent(it.raw)
              return (
                <TouchableOpacity
                  key={it.key}
                  style={[styles.item, current && styles.itemActive]}
                  onPress={() => { onSelect(it.raw); onClose() }}
                >
                  {/* 两行布局：第一行模型名独占整行宽度，第二行服务商徽章，
                      避免长名挤在一行互相截断 */}
                  <View style={styles.itemMain}>
                    <Text style={styles.itemName} numberOfLines={2}>{it.label}</Text>
                    {it.provider ? (
                      <View style={styles.providerBadge}>
                        <Text style={styles.providerBadgeText} numberOfLines={1}>{it.provider}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.itemArrow}>{current ? '✓' : '›'}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 32,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 20,
      width: '100%',
      maxWidth: 400,
      maxHeight: '70%',
    },
    title: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '600',
      marginBottom: 12,
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
      paddingHorizontal: 10,
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      paddingVertical: 8,
    },
    clearButton: {
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    clearButtonText: {
      color: colors.textTertiary,
      fontSize: 14,
    },
    body: {
      maxHeight: 400,
    },
    empty: {
      color: colors.textTertiary,
      fontSize: 14,
      textAlign: 'center',
      padding: 24,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
      padding: 12,
      marginBottom: 6,
    },
    itemActive: {
      borderWidth: 1,
      borderColor: colors.primary,
    },
    itemMain: {
      flex: 1,
      marginRight: 8,
    },
    itemName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '500',
      flexShrink: 1,
    },
    providerBadge: {
      backgroundColor: colors.primary,
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      alignSelf: 'flex-start',
      marginTop: 4,
    },
    providerBadgeText: {
      color: '#fff',
      fontSize: 11,
      fontWeight: '600',
    },
    itemArrow: {
      color: colors.textTertiary,
      fontSize: 20,
    },
  })
