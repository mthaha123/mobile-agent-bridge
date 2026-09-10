/**
 * serveManager — 管理多个 opencode serve 实例（每个项目独立一个）
 *
 * 模式 B：serve 进程独立于 bridge
 *   - detached: true → opencode.exe 不跟随 bridge 进程组
 *   - 正常退出 → 杀所有 serve（用户主动停止）
 *   - crash/kill -9 → serve 残留，重启后清理孤儿并重启
 *
 * 架构：
 *   Bridge ←→ serve:4100（项目A）
 *            ←→ serve:4101（项目B）
 *            ←→ serve:4102（项目C）
 *
 * 注册表持久化到 data/projects.json，重启后自动恢复。
 */
import { spawn, execSync, type ChildProcess } from "child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, resolve } from "path"
import http from "http"
import net from "net"

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

// ─── Constants ─────────────────────────────────────────

const PORT_RANGE_START = 4100
const MAX_PROJECTS = 20
const STARTUP_TIMEOUT_MS = 30_000
const KILL_TIMEOUT_MS = 10_000

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

// ─── Port / process utilities ──────────────────────────

/** 检测端口是否被占用 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once("error", () => resolve(true))
    server.once("listening", () => { server.close(); resolve(false) })
    server.listen(port)
  })
}

/** 通过端口查找并杀掉占用进程（Windows），返回是否成功释放 */
function killOnPort(port: number): boolean {
  try {
    const output = execSync(
      `netstat -ano | findstr :${port}`,
      { encoding: "utf8", timeout: 5000, windowsHide: true },
    )
    const lines = output.split("\n").filter(
      l => l.includes(`:${port}`) && l.includes("LISTENING"),
    )
    if (lines.length === 0) return true // 没人占用，已释放

    const parts = lines[0].trim().split(/\s+/)
    const pid = parseInt(parts[parts.length - 1], 10)
    if (!pid || isNaN(pid)) return true

    try {
      execSync(`taskkill /T /F /PID ${pid}`, {
        timeout: KILL_TIMEOUT_MS,
        windowsHide: true,
      })
    } catch { /* 进程可能已退出 */ }

    return true
  } catch {
    return false
  }
}

/** 等待端口释放（最多 waitMs） */
async function waitForPortFree(port: number, waitMs = 5000): Promise<boolean> {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (!(await isPortInUse(port))) return true
    await new Promise(r => setTimeout(r, 300))
  }
  return !(await isPortInUse(port))
}

// ─── Registry persistence ──────────────────────────────

function loadRegistry() {
  if (!existsSync(registryPath)) {
    projects = []
    return
  }
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8"))
    projects = (raw.projects || []).map((p: any) => ({ ...p, status: "stopped" as const }))
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

/**
 * 启动时清理孤儿进程：
 *   遍历注册表，检查端口是否仍被占用。
 *   若占用 → kill 掉旧进程（孤儿）→ 端口释放后标记 stopped。
 */
async function cleanOrphans() {
  for (const p of projects) {
    const inUse = await isPortInUse(p.port)
    if (inUse) {
      console.log(`[ServeManager] 清理孤儿 serve: ${p.name} port=${p.port}`)
      killOnPort(p.port)
      await waitForPortFree(p.port, 3000)
    }
    p.status = "stopped"
    p.pid = undefined
  }
  saveRegistry()
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
      detached: true,    // 独立于 bridge 进程组
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
      entry.pid = undefined
      processes.delete(entry.id)
      saveRegistry()
    })

    child.on("exit", (code, signal) => {
      entry.status = "stopped"
      entry.pid = undefined
      processes.delete(entry.id)
      saveRegistry()
    })

    // 等待 serve 就绪（轮询 /doc）
    const check = setInterval(() => {
      http.get(`http://localhost:${entry.port}/doc`, { timeout: 2000 }, (res) => {
        clearInterval(check)
        clearTimeout(fallback)
        if (res.statusCode === 200) {
          entry.status = "running"
          saveRegistry()
          resolve(true)
        }
      }).on("error", () => { /* 还没就绪 */ })
        .on("timeout", function (this: http.ClientRequest) { this.destroy() })
    }, 1000)

    // 超时兜底
    const fallback = setTimeout(() => {
      clearInterval(check)
      if (entry.status === "starting") {
        entry.status = "running"
        saveRegistry()
        resolve(true)
      }
    }, STARTUP_TIMEOUT_MS)
  })
}

/** 杀进程树并等待端口释放 */
async function stopServe(entry: ProjectEntry): Promise<void> {
  // 优先用已跟踪的 pid
  if (entry.pid) {
    try {
      execSync(`taskkill /T /F /PID ${entry.pid}`, {
        timeout: KILL_TIMEOUT_MS,
        windowsHide: true,
      })
    } catch { /* 可能已退出 */ }
    processes.delete(entry.id)
  }

  // 兜底：按端口杀（防止 pid 不准的情况）
  killOnPort(entry.port)
  await waitForPortFree(entry.port, 3000)

  entry.status = "stopped"
  entry.pid = undefined
  saveRegistry()
}

// ─── Public API ────────────────────────────────────────

export async function initManager(projectRoot: string) {
  dataDir = join(projectRoot, "servers", "bridge", "data")
  registryPath = join(dataDir, "projects.json")
  loadRegistry()

  // 清理 crash 残留的孤儿进程
  await cleanOrphans()

  // 注册 bridge 正常退出时的清理逻辑
  const gracefulShutdown = async () => {
    console.log("[ServeManager] bridge 退出，停止所有 serve...")
    await stopAll()
    process.exit(0)
  }
  process.on("SIGINT", gracefulShutdown)
  process.on("SIGTERM", gracefulShutdown)
  process.on("exit", () => {
    // sync 部分：尽力杀（exit handler 不能 await）
    for (const p of projects) {
      if (p.pid) {
        try { spawn("taskkill", ["/T", "/F", "/PID", String(p.pid)], { stdio: "ignore", windowsHide: true }) } catch {}
      }
    }
  })
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

  // 检查端口冲突
  const port = nextPort++
  if (await isPortInUse(port)) {
    throw new Error(`端口 ${port} 被占用，请重启 bridge 或手动释放`)
  }

  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const entry: ProjectEntry = {
    id, name, directory: resolved, port,
    status: "stopped", createdAt: Date.now(),
  }

  projects.push(entry)
  saveRegistry()

  // fire-and-forget
  startServe(entry)

  return { ...entry }
}

export async function removeProject(id: string): Promise<boolean> {
  const idx = projects.findIndex(p => p.id === id)
  if (idx === -1) return false
  await stopServe(projects[idx])
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

export async function stopProject(id: string): Promise<void> {
  const entry = projects.find(p => p.id === id)
  if (entry) await stopServe(entry)
}

/** 获取项目对应的 serve baseUrl */
export function getServeUrl(entry: ProjectEntry): string {
  return `http://localhost:${entry.port}`
}

/** 停止所有项目 */
export async function stopAll() {
  const tasks = projects.map(p => stopServe(p))
  await Promise.allSettled(tasks)
}
