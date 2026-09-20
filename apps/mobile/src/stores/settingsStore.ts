/**
 * settingsStore — 客户端本地偏好设置
 *
 * 默认 Agent / 默认 Model / 聊天显示模式 / 连接参数 等本地设置，
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

/** 上次使用的连接参数（null = 从未填过） */
export interface ConnectionSettings {
  url: string | null
  password: string | null
  directory: string | null
}

interface SettingsFile {
  defaultAgent: string | null
  defaultModel: DefaultModel | null
  chatDisplayMode: ChatDisplayMode
  /** 上次连接使用的 WebSocket 地址 */
  bridgeUrl?: string | null
  /** 上次连接使用的密码 */
  bridgePassword?: string | null
  /** 上次连接使用的项目目录 */
  projectDirectory?: string | null
}

export interface SettingsState {
  /** 新会话默认 agent；null = 跟随服务端默认 */
  defaultAgent: string | null
  /** 新会话默认模型；null = 跟随服务端默认 */
  defaultModel: DefaultModel | null
  /** 聊天消息显示模式：flat = 平铺（逐个 PartBlock），grouped = 聚合（ToolGroupCard 合并 reasoning+tool） */
  chatDisplayMode: ChatDisplayMode
  /**
   * 上次使用的连接参数（持久化）。
   *
   * 为什么必须持久化：此前 ConnectScreen 的三个输入框每次都硬编码回默认值
   * （`ws://10.0.2.2:8080/ws` + `test123`），用户/联调时填的自定义地址
   * （如 mock bridge `ws://10.0.2.2:8081/ws`）一重启就丢失 ——
   * 手一滑点 Connect 就打到默认地址（生产 8080）。
   * 现在连接参数会落盘并回填，用户填过一次就不会再丢。
   */
  bridgeUrl: string | null
  bridgePassword: string | null
  projectDirectory: string | null
  /** 磁盘恢复是否已完成（无论成败） */
  loaded: boolean

  load: () => Promise<void>
  setDefaultAgent: (agent: string | null) => Promise<void>
  setDefaultModel: (model: DefaultModel | null) => Promise<void>
  setChatDisplayMode: (mode: ChatDisplayMode) => Promise<void>
  /** 记录本次连接参数（部分字段可选，未传的沿用当前值） */
  saveConnection: (conn: Partial<ConnectionSettings>) => Promise<void>
}

const SETTINGS_PATH =
  `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/mobile-agent-bridge-settings.json`

async function persist(file: SettingsFile): Promise<void> {
  await ReactNativeBlobUtil.fs.writeFile(SETTINGS_PATH, JSON.stringify(file), 'utf8')
}

/** 把当前内存态整体落盘（所有 setter 共用，避免新增字段时漏写） */
async function persistState(state: SettingsState): Promise<void> {
  await persist({
    defaultAgent: state.defaultAgent,
    defaultModel: state.defaultModel,
    chatDisplayMode: state.chatDisplayMode,
    bridgeUrl: state.bridgeUrl,
    bridgePassword: state.bridgePassword,
    projectDirectory: state.projectDirectory,
  })
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  defaultAgent: null,
  defaultModel: null,
  chatDisplayMode: 'flat',
  bridgeUrl: null,
  bridgePassword: null,
  projectDirectory: null,
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
        bridgeUrl: parsed.bridgeUrl ?? null,
        bridgePassword: parsed.bridgePassword ?? null,
        projectDirectory: parsed.projectDirectory ?? null,
        loaded: true,
      })
    } catch {
      // 文件损坏/读取失败：静默降级为内存默认值
      set({ loaded: true })
    }
  },

  setDefaultAgent: async (agent) => {
    set({ defaultAgent: agent })
    await persistState(get()).catch(() => {})
  },

  setDefaultModel: async (model) => {
    set({ defaultModel: model })
    await persistState(get()).catch(() => {})
  },

  setChatDisplayMode: async (mode) => {
    set({ chatDisplayMode: mode })
    await persistState(get()).catch(() => {})
  },

  saveConnection: async (conn) => {
    set({
      bridgeUrl: conn.url !== undefined ? conn.url : get().bridgeUrl,
      bridgePassword: conn.password !== undefined ? conn.password : get().bridgePassword,
      projectDirectory:
        conn.directory !== undefined ? conn.directory : get().projectDirectory,
    })
    await persistState(get()).catch(() => {})
  },
}))
