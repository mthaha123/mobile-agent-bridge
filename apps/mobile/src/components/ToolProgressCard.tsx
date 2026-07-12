import React from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { useToolProgressStore, ToolCallProgress } from '../stores/toolProgressStore'

export const ToolProgressCard: React.FC = () => {
  const activeCalls = useToolProgressStore((s) => s.activeCalls)
  const running = activeCalls.filter(
    (c) => c.status === 'called' || c.status === 'progress',
  )

  if (running.length === 0) return null

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {running.map((call) => (
          <ToolCallItem key={call.callID} call={call} />
        ))}
      </ScrollView>
    </View>
  )
}

const ToolCallItem: React.FC<{ call: ToolCallProgress }> = ({ call }) => {
  const statusIcon = call.status === 'called' ? '⏳' : '⚙️'
  const inputPreview =
    typeof call.input === 'object' && call.input !== null
      ? JSON.stringify(call.input).slice(0, 60)
      : String(call.input || '')

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.icon}>{statusIcon}</Text>
        <Text style={styles.toolName} numberOfLines={1}>
          {call.tool}
        </Text>
      </View>
      <Text style={styles.input} numberOfLines={1}>
        {inputPreview}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#16213e',
  },
  scroll: {
    gap: 8,
  },
  card: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 10,
    minWidth: 140,
    maxWidth: 200,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  icon: {
    fontSize: 14,
    marginRight: 6,
  },
  toolName: {
    color: '#eee',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  input: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
  },
})
