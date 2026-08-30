import React, { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useQuestionStore, SingleQuestion } from '../../stores/questionStore'
import { useAuthStore } from '../../stores/authStore'
import { useThemeColors } from '../../theme/ThemeContext'
import { ThemeColors } from '../../theme/colors'

export const QuestionDock: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const pending = useQuestionStore(s => s.pending)
  const visible = useQuestionStore(s => s.visible)
  const visibleSessionId = useQuestionStore(s => s.visibleSessionId)
  const removeQuestion = useQuestionStore(s => s.removeQuestion)

  // 内联 Dock 只负责"当前会话"的提问；其它会话的提问交给全局 QuestionSheet，
  // 避免同一个提问被弹两次，也避免 A 会话的问题显示在 B 会话页。
  const items = visibleSessionId ? pending.filter(q => q.sessionId === visibleSessionId) : []

  if (!visible || items.length === 0) return null

  return (
    <View style={styles.dockArea}>
      {items.map(q => (
        <QuestionItem
          key={q.id}
          question={q}
          onReject={() => {
            rejectQuestion(q.id)
            removeQuestion(q.id)
          }}
          onSubmit={(answers: string[]) => {
            replyQuestion(q.id, answers)
            removeQuestion(q.id)
          }}
        />
      ))}
    </View>
  )
}

interface QuestionItemProps {
  question: { id: string; sessionId: string; questions: SingleQuestion[] }
  onReject: () => void
  onSubmit: (answers: string[]) => void
}

const QuestionItem: React.FC<QuestionItemProps> = ({ question, onReject, onSubmit }) => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [selected, setSelected] = useState<Record<number, string[]>>({})

  const handleSelect = (qi: number, label: string, multiple?: boolean) => {
    setSelected(prev => {
      const current = prev[qi] || []
      if (multiple) {
        return { ...prev, [qi]: current.includes(label) ? current.filter(l => l !== label) : [...current, label] }
      }
      return { ...prev, [qi]: current.includes(label) ? [] : [label] }
    })
  }

  const handleSubmit = () => {
    const answers = question.questions.map((_, i) => (selected[i] || []).join(', '))
    onSubmit(answers)
  }

  return (
    <View style={styles.dockPrompt}>
      <View style={styles.dockHeader}>
        <Text style={styles.dockIcon}>❓</Text>
        <Text style={styles.dockTitle}>问题</Text>
      </View>
      <View style={styles.dockBody}>
        {question.questions.map((q, qi) => (
          <View key={qi} style={styles.questionBlock}>
            <Text style={styles.questionText}>{q.question}</Text>
            {q.options.map((opt, oi) => {
              const isSelected = (selected[qi] || []).includes(opt.label)
              return (
                <TouchableOpacity
                  key={oi}
                  style={[styles.option, isSelected && styles.optionSelected]}
                  onPress={() => handleSelect(qi, opt.label, q.multiple)}
                >
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                    {q.multiple ? (isSelected ? '☑ ' : '☐ ') : (isSelected ? '◉ ' : '○ ')}
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        ))}
      </View>
          <View style={styles.dockFooter}>
            <TouchableOpacity style={styles.rejectBtn} onPress={onReject}>
              <Text style={styles.btnText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
              <Text style={styles.btnText}>Submit</Text>
            </TouchableOpacity>
          </View>
    </View>
  )
}

function rejectQuestion(id: string) {
  const client = useAuthStore.getState().client
  if (!client) return
  client.call('question.reject', { id }).catch(() => {})
}

function replyQuestion(id: string, answers: string[]) {
  const client = useAuthStore.getState().client
  if (!client) return
  const found = useQuestionStore.getState().pending.find(q => q.id === id)
  if (!found) return
  client.call('question.reply', { id, sessionId: found.sessionId, answers }).catch(() => {})
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    dockArea: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      gap: 6,
    },
    dockPrompt: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.surfaceVariant,
    },
    dockHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.surfaceVariant,
    },
    dockIcon: { fontSize: 14, marginRight: 8 },
    dockTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
    dockBody: {
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    questionBlock: {
      marginBottom: 8,
    },
    questionText: {
      color: colors.text,
      fontSize: 14,
      marginBottom: 8,
      lineHeight: 20,
    },
    option: {
      backgroundColor: colors.surfaceVariant,
      borderRadius: 6,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 4,
    },
    optionSelected: {
      backgroundColor: '#1a5276',
      borderWidth: 1,
      borderColor: colors.primary,
    },
    optionLabel: { color: colors.text, fontSize: 14 },
    optionLabelSelected: { color: colors.textOnPrimary },
    dockFooter: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.surfaceVariant,
    },
    rejectBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: 'rgba(231, 76, 60, 0.15)',
    },
    submitBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: 'rgba(46, 204, 113, 0.15)',
    },
    btnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  })
