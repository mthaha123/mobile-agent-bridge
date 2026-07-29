import React, { useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'

interface DiffDisplayProps {
  oldString: string
  newString: string
  filePath?: string
}

export const DiffDisplay: React.FC<DiffDisplayProps> = ({ oldString, newString, filePath }) => {
  const hunks = useMemo(() => buildDiffHunks(oldString, newString), [oldString, newString])
  if (!oldString && !newString) return null

  return (
    <View style={styles.diffContainer}>
      {filePath ? <Text style={styles.filePath}>{filePath}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {hunks.map((hunk, i) => (
            <View key={i}>
              {hunk.lines.map((line, j) => (
                <View key={j} style={[
                  styles.diffLine,
                  line.type === 'add' && styles.diffAdd,
                  line.type === 'del' && styles.diffDel,
                ]}>
                  <Text style={styles.diffMarker}>
                    {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                  </Text>
                  <Text style={styles.diffText}>{line.content}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

interface DiffLine {
  type: 'ctx' | 'add' | 'del'
  content: string
}

interface DiffHunk {
  lines: DiffLine[]
}

function buildDiffHunks(oldStr: string, newStr: string): DiffHunk[] {
  if (!oldStr && !newStr) return []
  if (oldStr === newStr) return [{ lines: [{ type: 'ctx', content: oldStr }] }]

  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const lines: DiffLine[] = []

  const maxLen = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined
    const newLine = i < newLines.length ? newLines[i] : undefined
    if (oldLine === newLine) {
      lines.push({ type: 'ctx', content: oldLine! })
    } else {
      if (oldLine !== undefined) lines.push({ type: 'del', content: oldLine })
      if (newLine !== undefined) lines.push({ type: 'add', content: newLine })
    }
  }
  return [{ lines }]
}

const styles = StyleSheet.create({
  diffContainer: {
    backgroundColor: '#0d1117',
    borderRadius: 6,
    overflow: 'hidden',
  },
  filePath: {
    color: '#007AFF',
    fontSize: 12,
    padding: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  diffLine: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 1,
    minWidth: '100%',
  },
  diffAdd: {
    backgroundColor: 'rgba(81, 207, 102, 0.15)',
  },
  diffDel: {
    backgroundColor: 'rgba(255, 107, 107, 0.15)',
  },
  diffMarker: {
    width: 14,
    color: '#666',
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  diffText: {
    color: '#d4d4d4',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
    flexShrink: 0,
  },
})
