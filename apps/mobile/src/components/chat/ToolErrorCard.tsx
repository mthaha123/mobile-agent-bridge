import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Clipboard } from 'react-native'

interface ToolErrorCardProps {
  tool: string
  error: string
  title?: string
  subtitle?: string
}

export const ToolErrorCard: React.FC<ToolErrorCardProps> = ({ tool, error, title, subtitle }) => {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    Clipboard.setString(error)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <View style={styles.errorCard}>
      <TouchableOpacity
        style={styles.errorHeader}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTool}>{title || tool}</Text>
        {subtitle ? <Text style={styles.errorSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
      </TouchableOpacity>
      {expanded ? (
        <View style={styles.errorBody}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={handleCopy} style={styles.copyBtn}>
            <Text style={styles.copyText}>{copied ? '已复制' : '复制错误'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  errorCard: {
    backgroundColor: 'rgba(231, 76, 60, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(231, 76, 60, 0.3)',
    overflow: 'hidden',
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  errorIcon: { fontSize: 16, marginRight: 8 },
  errorTool: { color: '#ff6b6b', fontSize: 14, fontWeight: '600', flex: 1 },
  errorSubtitle: { color: '#888', fontSize: 12, marginRight: 8, maxWidth: 120 },
  chevron: { color: '#666', fontSize: 12 },
  errorBody: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(231, 76, 60, 0.2)',
    padding: 10,
  },
  errorText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  copyBtn: {
    marginTop: 8,
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#e74c3c',
    borderRadius: 4,
  },
  copyText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
})
