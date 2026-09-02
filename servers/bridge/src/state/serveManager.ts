/**
 * serveManager — 管理多个 opencode serve 实例（每个项目独立一个）
 *
 * 架构：
 *   Bridge ←→ serve:4097（项目A）
 *            ←→ serve:4098（项目B）
 *            ←→ serve:4099（项目C）
 *
 * 注册表持久化到 data/projects.json，重启后自动恢复。
 */
import { spawn, type ChildProcess } from "child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, resolve } from "path"
import http from "http"

// ─── Types ─────────────────────────────────────────────

export interface ProjectEntry {
  id: string
  name: string
  directory: string
  port: number
  status: "running" | "stopped" | "starting"
  pid?: number
  createdAt: number
}

export interface ProjectListResult {
  projects: ProjectEntry[]
  nextPort: number
}

// ─── Constants ─────────────────────────────────────────

const PORT_RANGE_START = 4100   // serve 端口起始（避开 bridge 8080 / 原 serve 4096-4099）
const MAX_PROJECTS = 20

const OPENCODE_EXE = join(
  process.env.APPDATA || "",
  "npm", "node_modules", "opencode-ai", "bin", "opencode.exe",
)

// ─── State ─────────────────────────────────────────────

let dataDir: string
let registryPath: string
let projects: ProjectEntry[] = []
let processes: Map<string, ChildProcess> = new Map()
let nextPort = PORT_RANGE_START

// ─── Registry persistence ──────────────────────────────

function loadRegistry() {
  if (!existsSync(registryPath)) {
    projects = []
    return
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8"))
    projects = (raw.projects || []).map((p: any) => ({ ...p, status: "stopped" }))
    nextPort = raw.nextPort || PORT_RANGE_START
  } catch {
    projects = []
  }
}

function saveRegistry() {
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(registryPath, JSON.stringify({ projects, nextPort }, null, 2))
  } catch (err) {
    console.error("[ServeManager] 保存注册表失败:", err)
  }
}

// ─── Serve lifecycle ───────────────────────────────────

function startServe(entry: ProjectEntry): Promise<boolean> {
  return new Promise((resolve) => {
    if (!existsSync(OPENCODE_EXE)) {
      console.error(`[ServeManager] opencode.exe 不存在: ${OPENCODE_EXE}`)
      resolve(false)
      return
    }

    const apiKey = process.env.OPENCODE_API_KEY || ""
    const child = spawn(OPENCODE_EXE, ["serve", "--port", String(entry.port), "--print-logs"], {
      detached: true,
      stdio: "ignore",
      cwd: entry.directory,
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: "",
        OPENCODE_API_KEY: apiKey,
      },
    })

    child.unref()
    entry.pid = child.pid
    entry.status = "starting"
    processes.set(entry.id, child)

    child.on("error", (err) => {
      console.error(`[ServeManager] serve ${entry.name} 启动失败:`, err.message)
      entry.status = "stopped"
      processes.delete(entry.id)
      saveRegistry()
    })

    child.on("exit", (code) => {
      console.log(`[ServeManager] serve ${entry.name} 退出 (code=${code})`)
      entry.status = "stopped"
      entry.pid = undefined
      processes.delete(entry.id)
      saveRegistry()
    })

    // 等待 serve 就绪
    const check = setInterval(() => {
      http.get(`http://localhost:${entry.port}/doc`, { timeout: 2000 }, (res) => {
        clearInterval(check)
        if (res.statusCode === 200) {
          entry.status = "running"
          console.log(`[ServeManager] serve ${entry.name} 就绪 (port=${entry.port})`)
          saveRegistry()
          resolve(true)
        }
      }).on("error", () => { /* 还没就绪，继续等 */ })
        .on("timeout", function () { this.destroy() })
    }, 1000)

    // 最多等 20s
    setTimeout(() => {
      clearInterval(check)
      if (entry.status === "starting") {
        entry.status = "running" // 乐观假设
        saveRegistry()
        resolve(true)
      }
    }, 20000)
  })
}

function stopServe(entry: ProjectEntry) {
  if (entry.pid) {
    try {
      spawn("taskkill", ["/f", "/pid", String(entry.pid)], { stdio: "ignore", timeout: 5000 })
    } catch { /* 忽略 */ }
  }
  processes.delete(entry.id)
  entry.status = "stopped"
  entry.pid = undefined
  saveRegistry()
}

// ─── Public API ────────────────────────────────────────

export function initManager(dir: string) {
  dataDir = join(dir, "servers", "bridge", "data")
  registryPath = join(dataDir, "projects.json")
  loadRegistry()
  console.log(`[ServeManager] 加载 ${projects.length} 个项目`)
}

export function getProjects(): ProjectEntry[] {
  return projects.map(p => ({ ...p }))
}

export function getProject(id: string): ProjectEntry | undefined {
  return projects.find(p => p.id === id)
}

export function getProjectByDir(directory: string): ProjectEntry | undefined {
  const normalized = resolve(directory)
  return projects.find(p => resolve(p.directory) === normalized)
}

export async function addProject(name: string, directory: string): Promise<ProjectEntry> {
  const resolved = resolve(directory)
  if (!existsSync(resolved)) throw new Error(`目录不存在: ${resolved}`)
  if (projects.some(p => resolve(p.directory) === resolved)) {
    throw new Error(`项目已存在: ${resolved}`)
  }
  if (projects.length >= MAX_PROJECTS) throw new Error(`已达上限 (${MAX_PROJECTS})`)

  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const port = nextPort++
  const entry: ProjectEntry = {
    id, name, directory: resolved, port,
    status: "stopped", createdAt: Date.now(),
  }

  projects.push(entry)
  saveRegistry()

  // 启动 serve
  await startServe(entry)
  return { ...entry }
}

export function removeProject(id: string): boolean {
  const idx = projects.findIndex(p => p.id === id)
  if (idx === -1) return false
  stopServe(projects[idx])
  projects.splice(idx, 1)
  saveRegistry()
  return true
}

export async function startProject(id: string): Promise<boolean> {
  const entry = projects.find(p => p.id === id)
  if (!entry) return false
  if (entry.status === "running") return true
  return startServe(entry)
}

export function stopProject(id: string) {
  const entry = projects.find(p => p.id === id)
  if (entry) stopServe(entry)
}

/** 获取项目对应的 serve baseUrl */
export function getServeUrl(entry: ProjectEntry): string {
  return `http://localhost:${entry.port}`
}

/** 启动所有项目（bridge 启动时调用） */
export async function startAll() {
  for (const p of projects) {
    if (p.status !== "running") {
      startServe(p) // fire-and-forget
    }
  }
}

/** 停止所有项目（bridge 关闭时调用） */
export function stopAll() {
  for (const p of projects) {
    stopServe(p)
  }
}
