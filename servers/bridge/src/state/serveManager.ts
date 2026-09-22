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
 * 端口分配（目标并发 5，端口池 4100-4109 留冗余）：
 *   1) 候选端口按「轮转顺序」排列，逐个用 `exclusive` 探测（见 portUtils），
 *      跳过被外部占用 / 僵尸的端口；
 *   2) spawn 后**校验端口归属**（监听 PID == 子进程 PID）才算成功，
 *      失败则换下一个候选端口重试——消除 check-then-spawn 的 TOCTOU 与「假 running」；
 *   3) 持有 PID 已死的端口记为僵尸（黑名单），告警并跳过（彻底释放需重启 OS）。
 *
 * 注册表持久化到 data/projects.json，重启后自动恢复。
 */
import { spawn, execSync, type ChildProcess } from "child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, resolve } from "path"
import { homedir } from "os"
import http from "http"
import {
  parseServePortPool,
  DEFAULT_SERVE_PORT_POOL,
  DEFAULT_MAX_SERVES,
  resolveMaxServes,
} from "../config.js"
import {
  SERVE_HOST,
  probePortFree,
  listeningPids,
  classifyServePort,
  candidateOrder,
  isProcessAlive,
  type ServePortState,
} from "./portUtils.js"

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

export interface ServeStatus {
  pool: number[]
  maxServes: number
  used: Array<{ id: string; name: string; port: number; status: ProjectEntry["status"]; pid?: number }>
  dead: Array<{ port: number; pid: number; since: number }>
}

// ─── Constants ─────────────────────────────────────────

// 端口池可由 BRIDGE_SERVE_PORT_POOL 覆盖（生产/测试隔离），默认 4100-4109
let portPool: number[] = [...DEFAULT_SERVE_PORT_POOL]
let maxServes = DEFAULT_MAX_SERVES
const STARTUP_TIMEOUT_MS = 30_000
const KILL_TIMEOUT_MS = 10_000
const HEALTH_INTERVAL_MS = 15_000
const PORT_POLL_MS = 500

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
/** 轮转游标：下一次分配从池的哪个位置开始 */
let cursor = 0
/** 僵尸端口黑名单（持有 PID 已死，端口未释放） */
const deadPorts = new Map<number, { pid: number; since: number }>()
/** 健康巡检中正在重启的项目，避免重复启动 */
const restarting = new Set<string>()
let healthTimer: NodeJS.Timeout | undefined

// ─── Port / process utilities ──────────────────────────

function dedupe(ports: number[]): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const p of ports) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/** 记录僵尸端口（持有 PID 已死但端口不释放） */
function markDeadPort(port: number): void {
  if (deadPorts.has(port)) return
  const pid = listeningPids(port)[0] ?? -1
  deadPorts.set(port, { pid, since: Date.now() })
  console.warn(
    `[ServeManager] 端口 ${port} 疑似僵尸句柄（持有 PID=${pid} 已死，端口未释放）；已加入黑名单，彻底释放需重启 OS`,
  )
}

/** 通过端口杀掉占用进程（Windows）；持有者已死则记为僵尸端口 */
function killOnPort(port: number): void {
  for (const pid of listeningPids(port)) {
    if (!isProcessAlive(pid)) {
      markDeadPort(port)
      continue
    }
    try {
      execSync(`taskkill /T /F /PID ${pid}`, { timeout: KILL_TIMEOUT_MS, windowsHide: true })
    } catch { /* 进程可能已退出 */ }
  }
}

/** 等待端口释放（最多 waitMs） */
async function waitForPortFree(port: number, waitMs = 5000): Promise<boolean> {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (await probePortFree(port)) return true
    await new Promise(r => setTimeout(r, 300))
  }
  return probePortFree(port)
}

/** GET /doc 就绪探针 */
function probeDoc(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${SERVE_HOST}:${port}/doc`, { timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on("error", () => resolve(false))
    req.on("timeout", () => { req.destroy(); resolve(false) })
  })
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
 *   遍历注册表，检查端口状态：
 *     - free    → 无需清理；
 *     - zombie  → 记入黑名单（无法杀，需重启 OS）；
 *     - 其它占用 → kill 掉旧进程（孤儿）→ 等端口释放。
 *   最后统一标记 stopped。
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
    const state = await classifyServePort(p.port)
    if (state === "zombie") {
      markDeadPort(p.port)
      p.status = "stopped"
      p.pid = undefined
      continue
    }
    if (state !== "free") {
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

/**
 * spawn serve 并**校验它真正绑定了目标端口**（监听 PID == 子进程 PID）且 /doc 就绪。
 * 任一步失败：杀掉子进程并返回 false（由调用方换端口重试）。
 * 绝不「超时即认为 running」——那会产生端口没起却报 running 的假象。
 */
function spawnAndVerify(entry: ProjectEntry, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const apiKey = resolveProviderKey("OPENCODE_API_KEY", ["opencode-go", "opencode"])
    const child = spawn(OPENCODE_EXE, ["serve", "--port", String(port), "--print-logs"], {
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
    const pid = child.pid
    entry.pid = pid
    entry.status = "starting"
    processes.set(entry.id, child)

    let settled = false
    let poll: NodeJS.Timeout | undefined
    let timer: NodeJS.Timeout | undefined
    let probing = false

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      if (poll) clearInterval(poll)
      if (timer) clearTimeout(timer)
      if (!ok) {
        if (pid) {
          try { execSync(`taskkill /T /F /PID ${pid}`, { timeout: KILL_TIMEOUT_MS, windowsHide: true }) } catch {}
        }
        processes.delete(entry.id)
        entry.pid = undefined
      }
      resolve(ok)
    }

    child.once("error", (err) => {
      console.error(`[ServeManager] serve ${entry.name} 启动失败:`, err.message)
      finish(false)
    })
    child.once("exit", () => finish(false))

    poll = setInterval(() => {
      if (settled || probing) return
      probing = true
      void (async () => {
        try {
          if (!pid) { finish(false); return }
          const state: ServePortState = await classifyServePort(port, pid)
          if (state === "ours") {
            if (await probeDoc(port)) finish(true)
          } else if (state === "zombie") {
            markDeadPort(port)
            finish(false)
          } else if (state === "foreign") {
            // 端口被别的进程抢先绑定 → 换端口
            finish(false)
          }
          // state === "free"：还没绑上，继续等
        } finally {
          probing = false
        }
      })()
    }, PORT_POLL_MS)

    timer = setTimeout(() => finish(false), STARTUP_TIMEOUT_MS)
  })
}

/**
 * 启动 serve：候选端口（首选 entry.port，其后按轮转补齐）逐个尝试，
 * 跳过被占用 / 僵尸端口，spawn 后校验归属，失败换下一个。
 * @returns 是否成功启动
 */
async function startServe(entry: ProjectEntry): Promise<boolean> {
  if (!existsSync(OPENCODE_EXE)) {
    console.error(`[ServeManager] opencode.exe 不存在: ${OPENCODE_EXE}`)
    entry.status = "stopped"
    entry.pid = undefined
    saveRegistry()
    return false
  }

  const others = new Set(projects.filter(p => p.id !== entry.id).map(p => p.port))
  const ordered = dedupe([
    entry.port,
    ...candidateOrder(portPool, { used: others, exclude: deadPorts.keys(), cursor }),
  ]).filter(p => portPool.includes(p))

  for (const port of ordered) {
    const state = await classifyServePort(port)
    if (state === "zombie") { markDeadPort(port); continue }
    if (state !== "free") {
      console.warn(`[ServeManager] serve ${entry.name}: 端口 ${port} 不可用（${state}），跳过`)
      continue
    }

    const ok = await spawnAndVerify(entry, port)
    if (ok) {
      entry.port = port
      entry.status = "running"
      cursor = (portPool.indexOf(port) + 1) % portPool.length
      saveRegistry()
      console.log(`[ServeManager] serve ${entry.name} 就绪: port=${port} pid=${entry.pid}`)
      return true
    }
    console.warn(`[ServeManager] serve ${entry.name}: 端口 ${port} 启动/校验失败，尝试下一个候选`)
  }

  entry.status = "stopped"
  entry.pid = undefined
  saveRegistry()
  console.error(`[ServeManager] serve ${entry.name} 无可用端口（池=[${portPool.join(",")}]，僵尸=[${[...deadPorts.keys()].join(",")}]）`)
  return false
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

// ─── Health patrol ─────────────────────────────────────

async function patrolOnce(): Promise<void> {
  for (const p of projects) {
    if (p.status !== "running" || !p.pid) continue
    if (restarting.has(p.id)) continue
    const state = await classifyServePort(p.port, p.pid)
    if (state === "ours") continue
    restarting.add(p.id)
    console.warn(`[ServeManager] 健康巡检: ${p.name} port=${p.port} 失联（${state}），重新启动`)
    p.status = "stopped"
    p.pid = undefined
    void startServe(p).finally(() => restarting.delete(p.id))
  }
}

function startHealthPatrol(): void {
  if (healthTimer) return
  healthTimer = setInterval(() => { void patrolOnce() }, HEALTH_INTERVAL_MS)
  healthTimer.unref?.()
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
  // 并发上限独立于池长度（池长只决定冗余），可由 BRIDGE_SERVE_MAX 覆盖
  maxServes = resolveMaxServes(process.env, portPool.length)

  // 配置护栏：端口池不得包含 bridge 自身端口（否则会自我冲突/顺位串段）
  const bridgePort = parseInt(process.env.BRIDGE_PORT || "", 10)
  if (Number.isInteger(bridgePort) && portPool.includes(bridgePort)) {
    throw new Error(`[ServeManager] 端口池 [${portPool.join(",")}] 含 bridge 端口 ${bridgePort}，配置冲突，拒绝启动`)
  }

  loadRegistry()

  // 清理 crash 残留的孤儿进程
  await cleanOrphans()

  // 健康巡检：running 的 serve 若与端口失联则自动重启
  startHealthPatrol()

  // 注册 bridge 正常退出时的清理逻辑
  const gracefulShutdown = async () => {
    console.log("[ServeManager] bridge 退出，停止所有 serve...")
    if (healthTimer) clearInterval(healthTimer)
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

/** serve 分配状态（供 /health 诊断：池 / 并发上限 / 占用 / 僵尸端口） */
export function getServeStatus(): ServeStatus {
  return {
    pool: [...portPool],
    maxServes,
    used: projects.map(p => ({ id: p.id, name: p.name, port: p.port, status: p.status, pid: p.pid })),
    dead: [...deadPorts.entries()].map(([port, v]) => ({ port, pid: v.pid, since: v.since })),
  }
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
  if (projects.length >= maxServes) {
    throw new Error(`已达并发上限 (${maxServes} 个 serve)，请先删除一个`)
  }

  // 按轮转顺序找第一个「空闲且未被占用」的端口；僵尸端口记入黑名单后跳过
  const usedPorts = new Set(projects.map(p => p.port))
  let port: number | undefined
  for (const candidate of candidateOrder(portPool, { used: usedPorts, exclude: deadPorts.keys(), cursor })) {
    const state = await classifyServePort(candidate)
    if (state === "zombie") { markDeadPort(candidate); continue }
    if (state === "free") { port = candidate; break }
    // 端口被外部进程占用（非本项目 serve），跳过
    console.warn(`[ServeManager] 端口 ${candidate} 被占用（${state}），跳过`)
  }
  if (port === undefined) {
    throw new Error(`端口池 [${portPool.join(",")}] 无可用端口（僵尸=[${[...deadPorts.keys()].join(",")}]）`)
  }

  const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const entry: ProjectEntry = {
    id, name, directory: resolved, port,
    status: "stopped", createdAt: Date.now(),
  }

  projects.push(entry)
  cursor = (portPool.indexOf(port) + 1) % portPool.length
  saveRegistry()

  // fire-and-forget（startServe 内部可能因占用/校验失败换端口）
  void startServe(entry)

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
