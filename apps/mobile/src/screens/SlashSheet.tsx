import React, { useMemo } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
} from 'react-native'
import { useConfigStore } from '../stores/configStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

interface SlashSheetProps {
  visible: boolean
  onClose: () => void
  onSelect: (command: string) => void
  onSwitchAgent?: (agent: string) => void
  filter?: string  // 输入前缀如 / 或 @，用于过滤
}

export const SlashSheet: React.FC<SlashSheetProps> = ({ visible, onClose, onSelect, onSwitchAgent, filter }) => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const agents = useConfigStore((s) => s.agents) as Array<{ name?: string; id?: string; label?: string }>
  const commands = useConfigStore((s) => s.commands) as Array<{ name?: string; command?: string; description?: string }>

  const showCommands = !filter || filter === '/' || filter.startsWith('/')
  const showAgents = !filter || filter === '@' || filter.startsWith('@')

  const filteredCommands = useMemo(() => {
    if (!filter || filter === '/') return commands
    return commands.filter(c => {
      const label = c.command || c.name || ''
      return label.toLowerCase().includes(filter.slice(1).toLowerCase())
    })
  }, [commands, filter])

  const filteredAgents = useMemo(() => {
    if (!filter || filter === '@') return agents
    return agents.filter(a => {
      const label = a.label || a.name || a.id || ''
      return label.toLowerCase().includes(filter.slice(1).toLowerCase())
    })
  }, [agents, filter])

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
          <Text style={styles.title}>
            {filter === '@' ? '选择 Agent' : filter === '/' ? '选择命令' : '命令 & Agent'}
          </Text>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {showCommands && filteredCommands.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Commands</Text>
                {filteredCommands.map((cmd, i) => {
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

            {showAgents && filteredAgents.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Agents</Text>
                {filteredAgents.map((agent, i) => {
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
                      <Text style={[styles.itemIcon, styles.agentIcon]}>@</Text>
                      <View style={styles.itemContent}>
                        <Text style={styles.itemLabel}>{label}</Text>
                        {onSwitchAgent ? <Text style={styles.itemDesc}>Switch agent</Text> : null}
                      </View>
                    </TouchableOpacity>
                  )
                })}
              </>
            )}

            {filteredCommands.length === 0 && filteredAgents.length === 0 && (
              <Text style={styles.emptyText}>无匹配项</Text>
            )}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

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
    color: colors.textTertiary,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 12,
    marginBottom: 6,
  },
  itemIcon: {
    fontSize: 16,
    color: '#8ab4f8',
    width: 28,
    textAlign: 'center',
    fontWeight: '700',
  },
  agentIcon: {
    color: '#51cf66',
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
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    color: colors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
})
