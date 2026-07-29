import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'

interface ThinkingShimmerProps {
  message?: string
  animated?: boolean
}

export const ThinkingShimmer: React.FC<ThinkingShimmerProps> = ({
  message = 'Thinking',
  animated = true,
}) => {
  const [dotCount, setDotCount] = useState(0)

  useEffect(() => {
    if (!animated) return
    const timer = setInterval(() => setDotCount(c => (c + 1) % 4), 400)
    return () => clearInterval(timer)
  }, [animated])

  return (
    <View style={styles.container}>
      <View style={styles.dot} />
      <Text style={styles.text}>
        {message}{'.'.repeat(dotCount)}
      </Text>
    </View>
  )
}

const pulseKeyframes = {
  from: { opacity: 0.4 },
  to: { opacity: 1 },
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4a9eff',
    marginRight: 10,
    opacity: 1,
  },
  text: {
    color: '#888',
    fontSize: 13,
    fontStyle: 'italic',
  },
})
