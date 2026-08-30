import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native'
import { useQuestionStore, SingleQuestion } from '../stores/questionStore'
import { useSessionStore, type Session } from '../stores/sessionStore'
import { useUiStore } from '../stores/uiStore'
import { useChatStore } from '../stores/chatStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

let _replyCall:
  | ((id: string, answers: string[]) => Promise<void>)
  | null = null

let _rejectCall:
  | ((id: string) => Promise<void>)
  | null = null

export function setQuestionReplyCall(
  cb: (id: string, answers: string[]) => Promise<void>,
): void {
  _replyCall = cb
}

export function setQuestionRejectCall(
  cb: ((id: string) => Promise<void>) | null,
): void {
  _rejectCall = cb
}

export const QuestionSheet: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const pending = useQuestionStore((s) => s.pending)
  const visibleSessionId = useQuestionStore((s) => s.visibleSessionId)
  const removeQuestion = useQuestionStore((s) => s.removeQuestion)
  const sessions = useSessionStore((s: { sessions: Session[] }) => s.sessions)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const pushChat = useUiStore((s) => s.pushChat)
  const setActiveSession = useChatStore((s) => s.setActiveSession)

  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({})
  // 用户手动关掉的提问（仅本地生效）：关掉后不再打扰，但新提问（新 id）仍会弹出，
  // 且不写回 store.visible —— 否则会连带把内联 Dock 也关掉。
  const [dismissed, setDismissed] = useState<string[]>([])

  // 全局弹窗只接管"非当前可见会话"的提问：当前会话的由内联 QuestionDock 展示，
  // 两者互斥，避免同一个提问被弹两次。
  const items = pending.filter(
    (q) => q.sessionId !== visibleSessionId && !dismissed.includes(q.id),
  )
  const visible = items.length > 0

  const current = items[0]
  const currentSessionName = current
    ? (sessions.find((s: Session) => s.id === current.sessionId)?.name ?? '')
    : ''

  const handleGoToSession = () => {
    if (!current?.sessionId) return
    setActiveSession(current.sessionId)
    setActiveTab('chat')
    pushChat()
  }

  useEffect(() => {
    setSelected({})
    setCustomInputs({})
  }, [current?.id])

  const handleSelectOption = (qi: number, label: string, multiple?: boolean) => {
    setSelected((prev) => {
      const currentSelected = prev[qi] || []
      const exists = currentSelected.includes(label)
      if (multiple) {
        return {
          ...prev,
          [qi]: exists
            ? currentSelected.filter((l) => l !== label)
            : [...currentSelected, label],
        }
      }
      return { ...prev, [qi]: exists ? [] : [label] }
    })
  }

  const handleSubmit = async () => {
    if (!_replyCall || !current) return
    const answers = current.questions.map((q, i) => {
      if (q.custom) return customInputs[i] || ''
      return (selected[i] || []).join(', ')
    })
    await _replyCall(current.id, answers)
    removeQuestion(current.id)
  }

  const handleRejectQ = async () => {
    if (!_rejectCall || !current) return
    await _rejectCall(current.id)
    removeQuestion(current.id)
  }

  const handleDismiss = () => {
    if (!current) return
    setDismissed((prev) => (prev.includes(current.id) ? prev : [...prev, current.id]))
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleDismiss}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleDismiss}
      >
        <TouchableOpacity
          style={styles.card}
          activeOpacity={1}
          onPress={() => {}}
        >
          {current ? (
            <>
              <View style={styles.titleRow}>
                <Text style={styles.title}>Question</Text>
                {items.length > 1 ? (
                  <Text style={styles.counter}>{items.length} 条待回答</Text>
                ) : null}
              </View>

              {/* 全局弹窗可能展示的是"别的会话"的提问 → 标明来源并给一键跳转 */}
              <TouchableOpacity
                style={styles.sourceRow}
                onPress={handleGoToSession}
                accessibilityLabel="Go to session"
                activeOpacity={0.7}
              >
                <Text style={styles.sourceText} numberOfLines={1}>
                  {currentSessionName ? `来自会话：${currentSessionName}` : '来自其它会话'}
                </Text>
                <Text style={styles.sourceLink}>去处理 ›</Text>
              </TouchableOpacity>

              <ScrollView
                style={styles.body}
                showsVerticalScrollIndicator={false}
              >
                {current.questions.map((q: SingleQuestion, qi: number) => (
                  <View key={qi} style={styles.questionBlock}>
                    {q.header ? (
                      <Text style={styles.headerText}>{q.header}</Text>
                    ) : null}
                    <Text style={styles.questionText}>{q.question}</Text>

                    {q.options.map((opt, oi) => {
                      const isSelected = (selected[qi] || []).includes(opt.label)
                      return (
                        <TouchableOpacity
                          key={oi}
                          style={[
                            styles.option,
                            isSelected && styles.optionSelected,
                          ]}
                          onPress={() => handleSelectOption(qi, opt.label, q.multiple)}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.optionLabel,
                              isSelected && styles.optionLabelSelected,
                            ]}
                          >
                            {q.multiple
                              ? (isSelected ? '☑ ' : '☐ ')
                              : (isSelected ? '◉ ' : '○ ')}
                            {opt.label}
                          </Text>
                          {opt.description ? (
                            <Text style={styles.optionDesc}>{opt.description}</Text>
                          ) : null}
                        </TouchableOpacity>
                      )
                    })}

                    {q.custom ? (
                      <TextInput
                        style={styles.customInput}
                        value={customInputs[qi] || ''}
                        onChangeText={(t) =>
                          setCustomInputs((prev) => ({ ...prev, [qi]: t }))
                        }
                        placeholder="Type your answer..."
                        placeholderTextColor={colors.textTertiary}
                        multiline
                      />
                    ) : null}
                  </View>
                ))}
              </ScrollView>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.rejectBtn]}
                  onPress={handleRejectQ}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionButtonText}>Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, styles.submitBtn]}
                  onPress={handleSubmit}
                  activeOpacity={0.8}
                >
                  <Text style={styles.actionButtonText}>Submit</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <Text style={styles.noItems}>No pending questions</Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  counter: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  sourceText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
    marginRight: 8,
  },
  sourceLink: {
    fontSize: 12,
    color: colors.link,
    fontWeight: '600',
  },
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
    maxHeight: '85%',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  body: {
    marginBottom: 16,
    maxHeight: 400,
  },
  questionBlock: {
    marginBottom: 20,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  questionText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 12,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  rejectBtn: {
    backgroundColor: '#e74c3c',
  },
  submitBtn: {
    backgroundColor: '#2ecc71',
  },
  actionButtonText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  option: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  optionSelected: {
    backgroundColor: '#1a5276',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  optionLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: '500',
  },
  optionLabelSelected: {
    color: colors.textOnPrimary,
  },
  optionDesc: {
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },
  customInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    color: colors.text,
    fontSize: 15,
    padding: 12,
    minHeight: 60,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  noItems: {
    color: colors.textTertiary,
    fontSize: 15,
    textAlign: 'center',
    marginTop: 40,
  },
})
