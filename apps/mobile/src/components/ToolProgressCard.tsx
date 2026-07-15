import React, { useState } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { useToolProgressStore, ToolCallProgress } from '../stores/toolProgressStore'
import { ToolRenderer } from './ToolRenderer'

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
  const [expanded, setExpanded] = useState(false)

  return (
    <View style={styles.card}>
      <ToolRenderer
        call={call}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
      />
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
    minWidth: 200,
    maxWidth: 300,
  },
})
