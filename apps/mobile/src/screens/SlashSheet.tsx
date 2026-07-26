import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
} from 'react-native'
import { useConfigStore } from '../stores/configStore'

interface SlashSheetProps {
  visible: boolean
  onClose: () => void
  onSelect: (command: string) => void
  onSwitchAgent?: (agent: string) => void
}

export const SlashSheet: React.FC<SlashSheetProps> = ({ visible, onClose, onSelect, onSwitchAgent }) => {
  const agents = useConfigStore((s) => s.agents) as Array<{ name?: string; id?: string; label?: string }>
  const commands = useConfigStore((s) => s.commands) as Array<{ name?: string; command?: string; description?: string }>

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
          <Text style={styles.title}>Commands & Agents</Text>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {commands.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Commands</Text>
                {commands.map((cmd, i) => {
                  const label = cmd.command || cmd.name || ''
                  const desc = cmd.description || ''
                  return (
                    <TouchableOpacity
                      key={i}
                      style={styles.item}
                      onPress={() => { onSelect(`/${label}`); onClose() }}
                    >
                      <Text style={styles.itemIcon}>/</Text>
                      <View style={styles.itemContent}>
                        <Text style={styles.itemLabel}>{label}</Text>
                        {desc ? <Text style={styles.itemDesc} numberOfLines={1}>{desc}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  )
                })}
              </>
            )}

            {agents.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Agents</Text>
                {agents.map((agent, i) => {
                  const label = agent.label || agent.name || agent.id || ''
                  return (
                    <TouchableOpacity
                      key={`agent-${i}`}
                      style={styles.item}
                      onPress={() => {
                        if (onSwitchAgent) {
                          onSwitchAgent(label)
                        } else {
                          onSelect(`/agent ${label}`)
                        }
                        onClose()
                      }}
                    >
                      <Text style={styles.itemIcon}>A</Text>
                      <View style={styles.itemContent}>
                        <Text style={styles.itemLabel}>{label}</Text>
                        {onSwitchAgent ? <Text style={styles.itemDesc}>Switch agent</Text> : null}
                      </View>
                    </TouchableOpacity>
                  )
                })}
              </>
            )}

            {agents.length === 0 && commands.length === 0 && (
              <Text style={styles.emptyText}>No commands or agents loaded</Text>
            )}
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
    maxHeight: '70%',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#eee',
    marginBottom: 8,
  },
  body: {
    maxHeight: 400,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  itemIcon: {
    fontSize: 16,
    color: '#8ab4f8',
    width: 28,
    textAlign: 'center',
  },
  itemContent: {
    flex: 1,
    marginLeft: 8,
  },
  itemLabel: {
    color: '#eee',
    fontSize: 15,
    fontWeight: '500',
  },
  itemDesc: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
})
