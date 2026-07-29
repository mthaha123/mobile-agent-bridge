import { create } from 'zustand'

export interface Attachment {
  id: string
  type: 'image' | 'file' | 'text'
  name: string
  data: string  // base64 for image, text content for file/text
  mime?: string
}

interface AttachmentStore {
  attachments: Attachment[]
  addAttachment: (att: Omit<Attachment, 'id'>) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void
}

let attchCounter = 0

export const useAttachmentStore = create<AttachmentStore>((set) => ({
  attachments: [],

  addAttachment: (att) => {
    const id = `attch_${++attchCounter}_${Date.now()}`
    set((state) => ({
      attachments: [...state.attachments, { ...att, id }],
    }))
  },

  removeAttachment: (id) => {
    set((state) => ({
      attachments: state.attachments.filter((a) => a.id !== id),
    }))
  },

  clearAttachments: () => set({ attachments: [] }),
}))
