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
  switchProject: (dir?: string) => Promise<void>
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

  switchProject: async (dir?: string) => {
    const client = useAuthStore.getState().client
    if (!client) return

    const targetDir = dir ?? get().directory
    if (!targetDir) return

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
    } catch {
      set({ switching: false })
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
      const list = Array.isArray(result)
        ? result as ProjectEntry[]
        : ((result as Record<string, unknown>)?.projects as ProjectEntry[]) || []
      set({ projects: list })
    } catch {
      // not critical
    }
  },
}))
