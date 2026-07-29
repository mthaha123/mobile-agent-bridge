import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native'
import { useAttachmentStore, Attachment } from '../../stores/attachmentStore'

export const AttachmentBar: React.FC = () => {
  const attachments = useAttachmentStore((s) => s.attachments)
  const removeAttachment = useAttachmentStore((s) => s.removeAttachment)

  if (attachments.length === 0) return null

  return (
    <ScrollView
      horizontal
      style={styles.bar}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.barContent}
    >
      {attachments.map((att) => (
        <AttachmentChip key={att.id} attachment={att} onRemove={() => removeAttachment(att.id)} />
      ))}
    </ScrollView>
  )
}

const AttachmentChip: React.FC<{ attachment: Attachment; onRemove: () => void }> = ({ attachment, onRemove }) => {
  return (
    <View style={styles.chip}>
      {attachment.type === 'image' ? (
        <Image source={{ uri: attachment.data }} style={styles.chipImage} />
      ) : (
        <Text style={styles.chipIcon}>
          {attachment.type === 'file' ? '📄' : '📝'}
        </Text>
      )}
      <Text style={styles.chipName} numberOfLines={1}>{attachment.name}</Text>
      <TouchableOpacity onPress={onRemove} style={styles.chipClose}>
        <Text style={styles.chipCloseText}>✕</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    maxHeight: 60,
    paddingHorizontal: 8,
  },
  barContent: {
    gap: 6,
    paddingVertical: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f3460',
    borderRadius: 16,
    paddingLeft: 6,
    paddingRight: 4,
    paddingVertical: 4,
    maxWidth: 160,
  },
  chipImage: {
    width: 24,
    height: 24,
    borderRadius: 4,
    marginRight: 4,
  },
  chipIcon: {
    fontSize: 16,
    marginRight: 4,
  },
  chipName: {
    color: '#eee',
    fontSize: 12,
    flexShrink: 1,
  },
  chipClose: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  chipCloseText: {
    color: '#ccc',
    fontSize: 10,
    fontWeight: '700',
  },
})
