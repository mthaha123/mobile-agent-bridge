import React, { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'

interface ShellOutputProps {
  result: unknown
  input?: Record<string, unknown>
}

export const ShellOutput: React.FC<ShellOutputProps> = ({ result, input }) => {
  const command = String(input?.command ?? input?.cmd ?? '')
  const output = result ? String(result) : ''
  const lines = output ? output.split('\n') : []
  const [showAll, setShowAll] = useState(false)
  const maxLines = 20
  const displayLines = showAll ? lines : lines.slice(0, maxLines)

  return (
    <View style={styles.shellContainer}>
      {command ? (
        <Text style={styles.command}>$ {command}</Text>
      ) : null}
      {output ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollX}>
            <View>
              {displayLines.map((line, i) => (
                <View key={i} style={styles.line}>
                  <Text style={styles.lineNum}>{i + 1}</Text>
                  <Text style={[
                    styles.lineText,
                    line.toLowerCase().includes('error') && !line.trim().startsWith('+') && styles.errorLine,
                    line.toLowerCase().includes('warning') && !line.trim().startsWith('+') && styles.warningLine,
                  ]}>{line || ' '}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
          {lines.length > maxLines ? (
            <TouchableOpacity onPress={() => setShowAll(v => !v)} style={styles.showMoreBtn}>
              <Text style={styles.showMoreText}>
                {showAll ? '收起' : `显示全部 ${lines.length} 行`}
              </Text>
            </TouchableOpacity>
          ) : null}
          {lines.length > 0 ? (
            <Text style={styles.lineCount}>{lines.length} lines</Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  shellContainer: {
    backgroundColor: '#0d1117',
    borderRadius: 6,
    overflow: 'hidden',
  },
  command: {
    color: '#4ecdc4',
    fontSize: 13,
    fontFamily: 'monospace',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  scrollX: {
    maxHeight: 300,
  },
  line: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  lineNum: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
    width: 32,
    textAlign: 'right',
    marginRight: 8,
  },
  lineText: {
    color: '#d4d4d4',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
    flexShrink: 0,
  },
  errorLine: {
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
    color: '#ff6b6b',
  },
  warningLine: {
    backgroundColor: 'rgba(255, 212, 59, 0.1)',
    color: '#ffd43b',
  },
  showMoreBtn: {
    paddingVertical: 6,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
  },
  showMoreText: {
    color: '#4a9eff',
    fontSize: 12,
  },
  lineCount: {
    color: '#666',
    fontSize: 11,
    textAlign: 'right',
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
})
