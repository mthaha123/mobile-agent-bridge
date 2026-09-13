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
import { homedir } from "os"
import http from "http"
import net from "net"
import { parseServePortPool, DEFAULT_SERVE_PORT_POOL } from "../config.js"

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

// 端口池可由 BRIDGE_SERVE_PORT_POOL 覆盖（生产/测试隔离），默认保持历史 4100-4104
let portPool: number[] = [...DEFAULT_SERVE_PORT_POOL]
let maxServes = portPool.length
const STARTUP_TIMEOUT_MS = 30_000
const KILL_TIMEOUT_MS = 10_000

const OPENCODE_EXE = join(
  process.env.APPDATA || "",
  "npm", "node_modules", "opencode-ai", "bin", "opencode.exe",
)

function maskKey(k: string): string {
  return k ? `${k.slice(0, 12)}…${k.slice(-4)}` : "(empty)"
}

/**
 * 解析 provider API key：注册表(HKCU) → auth.json → env（三级，逐级兜底）。
 *
 * 优先级理由：注册表是 `setx` 持久化的显式意图；auth.json 是 opencode 自己的
 * 权威凭据库（与 `opencode run` 同源，最可靠）；env **放最后**——bridge 的启动
 * 父进程可能携带过期或已超额的同名 env，env-first 会把坏 key 注入新启动的
 * opencode serve，触发 429（月份额度用尽）却难以定位。
 * 三级读取均在 try/catch 内，任一缺失自动降级。
 * 与 `scripts/start-all.mjs` 的 resolveProviderKey 保持一致。
 */
function resolveProviderKey(envVar: string, providerIds: string[]): string {
  const envKey = process.env[envVar] || ""
  let regKey = ""
  try {
    const reg = execSync(`reg query "HKCU\\Environment" /v ${envVar}`, { encoding: "utf8", timeout: 5000, windowsHide: true })
    const m = reg.match(new RegExp(`${envVar}\\s+REG_\\w+\\s+(\\S+)`))
    if (m && m[1]) regKey = m[1]
  } catch {}
  if (regKey) {
    if (envKey && envKey !== regKey) {
      console.warn(`[ServeManager] ${envVar}: env(${maskKey(envKey)}) != 注册表(${maskKey(regKey)})，采用注册表 key`)
    }
    return regKey
  }
  // auth.json：opencode 权威凭据库（优先于易被污染的环境变量）
  try {
    const authPath = join(homedir(), ".local", "share", "opencode", "auth.json")
    if (existsSync(authPath)) {
      const auth = JSON.parse(readFileSync(authPath, "utf8"))
      for (const pid of providerIds) {
        const k = auth[pid]?.key
        if (typeof k === "string" && k) return k
      }
    }
  } catch {}
  // env 兜底：仅当前两级都不可用时才用（避免坏 env 抢占）
  if (envKey) return envKey
  return ""
}

// ─── State ─────────────────────────────────────────────

let dataDir: string
let registryPath: string
let projects: ProjectEntry[] = []
let processes: Map<string, ChildProcess> = new Map()

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
  } catch {
    projects = []
  }
}

function saveRegistry() {
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(registryPath, JSON.stringify({ projects }, null, 2))
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
    // 安全护栏：只清理【本实例端口池内】的注册项。
    // 若注册表里的端口不在当前端口池（例如数据目录被跨环境共用/端口池改过），
    // 绝不按端口去杀——否则会串段误杀生产/其他环境的 serve。
    if (!portPool.includes(p.port)) {
      console.warn(`[ServeManager] 跳过非本端口池的注册项（不杀）: ${p.name} port=${p.port} pool=[${portPool.join(",")}]`)
      p.status = "stopped"
      p.pid = undefined
      continue
    }
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

    // 注册表优先解析（避免继承自父进程的过期/超额 env 被注入新 serve）
    const apiKey = resolveProviderKey("OPENCODE_API_KEY", ["opencode-go", "opencode"])
    const child = spawn(OPENCODE_EXE, ["serve", "--port", String(entry.port), "--print-logs"], {
      detached: true,    // 独立于 bridge 进程组
      stdio: "ignore",
      cwd: entry.directory,
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: "",
        OPENCODE_API_KEY: apiKey,
        DEEPSEEK_API_KEY: resolveProviderKey("DEEPSEEK_API_KEY", ["deepseek"]),
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

export async function initManager(projectRoot: string, dataDirOverride?: string) {
  // 数据目录：优先显式传入 / BRIDGE_DATA_DIR，默认 <projectRoot>/servers/bridge/data
  dataDir = dataDirOverride && dataDirOverride.trim()
    ? resolve(dataDirOverride)
    : join(projectRoot, "servers", "bridge", "data")
  registryPath = join(dataDir, "projects.json")

  // 端口池：可由 BRIDGE_SERVE_PORT_POOL 覆盖，避免生产/测试争抢同一批端口
  portPool = parseServePortPool(process.env.BRIDGE_SERVE_PORT_POOL)
  maxServes = portPool.length

  // 配置护栏：端口池不得包含 bridge 自身端口（否则会自我冲突/顺位串段）
  const bridgePort = parseInt(process.env.BRIDGE_PORT || "", 10)
  if (Number.isInteger(bridgePort) && portPool.includes(bridgePort)) {
    throw new Error(`[ServeManager] 端口池 [${portPool.join(",")}] 含 bridge 端口 ${bridgePort}，配置冲突，拒绝启动`)
  }

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

/** 当前生效的 serve 端口池（供 /health 诊断生产隔离配置） */
export function getServePortPool(): number[] {
  return [...portPool]
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

  // 从端口池中找第一个空闲且未被占用的端口
  const usedPorts = new Set(projects.map(p => p.port))
  let port: number | undefined
  for (const candidate of portPool) {
    if (usedPorts.has(candidate)) continue
    if (await isPortInUse(candidate)) {
      // 端口被外部进程占用（非本项目 serve），跳过
      console.warn(`[ServeManager] 端口 ${candidate} 被外部占用，跳过`)
      continue
    }
    port = candidate
    break
  }
  if (port === undefined) {
    throw new Error(`已达上限 (${maxServes} 个 serve)，请先删除一个`)
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
