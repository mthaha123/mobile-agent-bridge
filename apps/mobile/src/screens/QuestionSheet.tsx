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

let _replyCall:
  | ((id: string, answers: string[]) => Promise<void>)
  | null = null

export function setQuestionReplyCall(
  cb: (id: string, answers: string[]) => Promise<void>,
): void {
  _replyCall = cb
}

export const QuestionSheet: React.FC = () => {
  const visible = useQuestionStore((s) => s.visible)
  const pending = useQuestionStore((s) => s.pending)
  const removeQuestion = useQuestionStore((s) => s.removeQuestion)
  const setVisible = useQuestionStore((s) => s.setVisible)

  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({})

  useEffect(() => {
    if (visible && pending.length === 0) {
      setVisible(false)
    }
  }, [visible, pending, setVisible])

  const current = pending[0]

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

  const handleDismiss = () => {
    setVisible(false)
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
              <Text style={styles.title}>Question</Text>

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
                        placeholderTextColor="#666"
                        multiline
                      />
                    ) : null}
                  </View>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleSubmit}
                activeOpacity={0.8}
              >
                <Text style={styles.submitText}>Submit</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.noItems}>No pending questions</Text>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
    maxHeight: '85%',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#eee',
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
    color: '#aaa',
    marginBottom: 8,
  },
  questionText: {
    fontSize: 16,
    color: '#ccc',
    marginBottom: 12,
    lineHeight: 22,
  },
  option: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 14,
    marginBottom: 8,
  },
  optionSelected: {
    backgroundColor: '#1a5276',
    borderWidth: 1,
    borderColor: '#4a9eff',
  },
  optionLabel: {
    fontSize: 15,
    color: '#ddd',
    fontWeight: '500',
  },
  optionLabelSelected: {
    color: '#fff',
  },
  optionDesc: {
    fontSize: 12,
    color: '#888',
    marginTop: 4,
  },
  customInput: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    color: '#eee',
    fontSize: 15,
    padding: 12,
    minHeight: 60,
    textAlignVertical: 'top',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  submitButton: {
    backgroundColor: '#4a9eff',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  noItems: {
    color: '#666',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 40,
  },
})
