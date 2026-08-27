/**
 * settingsStore — 客户端本地偏好设置
 *
 * 默认 Agent / 默认 Model / 聊天显示模式 等本地设置，
 * 经 react-native-blob-util 持久化到 DocumentDir/mobile-agent-bridge-settings.json。
 * 读写失败静默降级为内存态，不阻塞 UI。
 */
import { create } from 'zustand'
import ReactNativeBlobUtil from 'react-native-blob-util'

export interface DefaultModel {
  id: string
  providerID: string
  variant?: string
}

export type ChatDisplayMode = 'flat' | 'grouped'

interface SettingsFile {
  defaultAgent: string | null
  defaultModel: DefaultModel | null
  chatDisplayMode: ChatDisplayMode
}

export interface SettingsState {
  /** 新会话默认 agent；null = 跟随服务端默认 */
  defaultAgent: string | null
  /** 新会话默认模型；null = 跟随服务端默认 */
  defaultModel: DefaultModel | null
  /** 聊天消息显示模式：flat = 平铺（逐个 PartBlock），grouped = 聚合（ToolGroupCard/ThinkingBlock） */
  chatDisplayMode: ChatDisplayMode
  /** 磁盘恢复是否已完成（无论成败） */
  loaded: boolean

  load: () => Promise<void>
  setDefaultAgent: (agent: string | null) => Promise<void>
  setDefaultModel: (model: DefaultModel | null) => Promise<void>
  setChatDisplayMode: (mode: ChatDisplayMode) => Promise<void>
}

const SETTINGS_PATH =
  `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/mobile-agent-bridge-settings.json`

async function persist(file: SettingsFile): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(SETTINGS_PATH, JSON.stringify(file), 'utf8')
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  defaultAgent: null,
  defaultModel: null,
  chatDisplayMode: 'flat',
  loaded: false,

  load: async () => {
    try {
      const exists = await ReactNativeBlobUtil.fs.exists(SETTINGS_PATH)
      if (!exists) {
        set({ loaded: true })
        return
      }
      const raw = await ReactNativeBlobUtil.fs.readFile(SETTINGS_PATH, 'utf8')
      const parsed = JSON.parse(raw || '{}') as Partial<SettingsFile>
      set({
        defaultAgent: parsed.defaultAgent ?? null,
        defaultModel: parsed.defaultModel ?? null,
        chatDisplayMode: parsed.chatDisplayMode ?? 'flat',
        loaded: true,
      })
    } catch {
      // 文件损坏/读取失败：静默降级为内存默认值
      set({ loaded: true })
    }
  },

  setDefaultAgent: async (agent) => {
    set({ defaultAgent: agent })
    await persist({
      defaultAgent: get().defaultAgent,
      defaultModel: get().defaultModel,
      chatDisplayMode: get().chatDisplayMode,
    }).catch(() => {})
  },

  setDefaultModel: async (model) => {
    set({ defaultModel: model })
    await persist({
      defaultAgent: get().defaultAgent,
      defaultModel: get().defaultModel,
      chatDisplayMode: get().chatDisplayMode,
    }).catch(() => {})
  },

  setChatDisplayMode: async (mode) => {
    set({ chatDisplayMode: mode })
    await persist({
      defaultAgent: get().defaultAgent,
      defaultModel: get().defaultModel,
      chatDisplayMode: get().chatDisplayMode,
    }).catch(() => {})
  },
}))
