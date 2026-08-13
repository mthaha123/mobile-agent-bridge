import { create } from 'zustand'
import { useAuthStore } from './authStore'

export interface ProjectInfo {
  name?: string
}

export interface ProjectEntry {
  directory: string
  name?: string
}

export interface ProjectState {
  directory: string
  project: ProjectInfo | null
  switching: boolean
  projects: ProjectEntry[]

  setDirectory: (dir: string) => void
  setProject: (info: { directory: string; project?: { name?: string } }) => void
  switchProject: (dir?: string) => Promise<boolean>
  fetchCurrentProject: () => Promise<void>
  listProjects: (clientCall: (method: string, params?: unknown) => Promise<unknown>) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  directory: '',
  project: null,
  switching: false,
  projects: [],

  setDirectory: (dir: string) => {
    set({ directory: dir })
  },

  setProject: (info) => {
    set({
      directory: info.directory,
      project: info.project ?? null,
    })
  },

  switchProject: async (dir?: string): Promise<boolean> => {
    const client = useAuthStore.getState().client
    if (!client) return false

    let targetDir = dir ?? get().directory

    // 未指定目录时：探测 OpenCode 当前项目（project.current 不依赖已 switch）
    if (!targetDir) {
      try {
        const cur = (await client.call('project.current', {})) as {
          directory?: string
          project?: { name?: string }
        }
        if (cur?.directory) {
          targetDir = cur.directory
          set({ directory: cur.directory, project: cur.project ?? null })
        }
      } catch {
        // 探测失败，视为无项目，返回 false（不抛错）
      }
    }

    // 无目录且探测不到 → 静默返回 false，由调用方（login）决定是否阻断
    if (!targetDir) {
      return false
    }

    set({ switching: true })
    try {
      const result = (await client.call('project.switch', { directory: targetDir })) as {
        directory: string
        project?: { name?: string }
      }
      set({
        directory: result.directory,
        project: result.project ?? null,
        switching: false,
      })
      return true
    } catch (e: unknown) {
      set({ switching: false })
      throw e instanceof Error ? e : new Error('切换项目失败')
    }
  },

  fetchCurrentProject: async () => {
    const client = useAuthStore.getState().client
    if (!client) return

    try {
      const result = (await client.call('project.current', {})) as {
        directory: string
        project?: { name?: string }
      }
      if (result?.directory) {
        set({
          directory: result.directory,
          project: result.project ?? null,
        })
      }
    } catch {
      // project.current may fail if no project is set
    }
  },

  listProjects: async (clientCall) => {
    try {
      const result = await clientCall('project.list', {})
      const raw = Array.isArray(result)
        ? result
        : ((result as Record<string, unknown>)?.projects as any[]) || []
      const list: ProjectEntry[] = raw.map((p: any) => ({
        directory: p.directory || p.worktree || '',
        name: p.name || p.id,
      }))
      set({ projects: list })
    } catch {
      // not critical
    }
  },
}))
