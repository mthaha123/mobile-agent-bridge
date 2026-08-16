import React, { useState } from 'react'
import { View, Text, StyleSheet, ScrollView } from 'react-native'
import { useToolProgressStore, ToolCallProgress } from '../stores/toolProgressStore'
import { ToolRenderer } from './ToolRenderer'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

export const ToolProgressCard: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const activeCalls = useToolProgressStore((s) => s.activeCalls)
  const running = activeCalls.filter(
    (c) => c.status === 'called' || c.status === 'progress',
  )

  if (running.length === 0) return null

  return (
    <View style={styles.container} accessible accessibilityLabel="tool-progress-card">
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
  const colors = useThemeColors()
  const styles = makeStyles(colors)
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  scroll: {
    gap: 8,
  },
  card: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    minWidth: 200,
    maxWidth: 300,
  },
})
