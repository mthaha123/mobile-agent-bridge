/**
 * portUtils — serve 端口探测 / 归属校验 / 候选排序（Windows 安全）
 *
 * 三个关键点：
 *  1) Node 在 Windows 上默认给监听套接字设 SO_REUSEADDR，导致「已占用」端口也能 bind 成功
 *     → 探测会误判为空闲，甚至两个进程绑同一端口。探测必须 `exclusive:true`（SO_EXCLUSIVEADDRUSE）。
 *  2) serve 绑 127.0.0.1，探测也必须用同一 host，否则 ::/0.0.0.0 与 127.0.0.1 结果不一致。
 *  3) 占用端口可能是「僵尸句柄」：持有 PID 已死但端口不释放 → 需单独识别并告警（彻底释放需重启 OS）。
 */
import net from "net"
import { execSync } from "child_process"

/** serve 绑定 / 探测的主机 */
export const SERVE_HOST = "127.0.0.1"

/** 端口状态分类 */
export type ServePortState = "free" | "ours" | "foreign" | "zombie"

/**
 * 独占探测端口是否空闲（可安全 bind）。
 * `exclusive:true` 在 Windows 走 SO_EXCLUSIVEADDRUSE，能真实反映「是否被占用」。
 */
export function probePortFree(port: number, host: string = SERVE_HOST): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    let settled = false
    const done = (free: boolean) => {
      if (settled) return
      settled = true
      resolve(free)
    }
    server.once("error", () => done(false))
    server.once("listening", () => server.close(() => done(true)))
    try {
      server.listen({ port, host, exclusive: true })
    } catch {
      done(false)
    }
  })
}

/**
 * 纯函数：从 `netstat -ano` 输出解析「监听指定端口」的 PID。
 * 本地地址列必须精确以 `:port` 结尾，避免 `:4100` 误命中 `:41000`。
 */
export function parseListeningPids(netstatOutput: string, port: number): number[] {
  const pids = new Set<number>()
  const suffix = `:${port}`
  for (const line of netstatOutput.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5) continue
    if (!cols[1].endsWith(suffix)) continue
    const pid = parseInt(cols[cols.length - 1], 10)
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids]
}

/** 查询监听指定端口的全部 PID */
export function listeningPids(port: number): number[] {
  try {
    const out = execSync("netstat -ano", { encoding: "utf8", timeout: 5000, windowsHide: true })
    return parseListeningPids(out, port)
  } catch {
    return []
  }
}

/** 查询监听指定端口的 PID（取首个），无则 null */
export function findListeningPid(port: number): number | null {
  const pids = listeningPids(port)
  return pids.length ? pids[0] : null
}

/**
 * 进程是否存活。
 * 仅用于判定「僵尸端口」——PID 复用无法区分，但足以区分「持有者还在」与「持有者已死」。
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM：进程存在但无权限；ESRCH：不存在
    return (err as NodeJS.ErrnoException)?.code === "EPERM"
  }
}

/**
 * 分类端口状态：
 *  - free    : 可 bind
 *  - ours    : 被 ownerPid 占用（本次启动的 serve 已就位）
 *  - zombie  : 占用但持有 PID 已死（泄漏句柄，需重启 OS 才能释放）
 *  - foreign : 被其他活进程占用
 */
export async function classifyServePort(port: number, ownerPid?: number): Promise<ServePortState> {
  if (await probePortFree(port)) return "free"
  const pid = findListeningPid(port)
  if (pid === null) return "foreign"
  if (ownerPid !== undefined && pid === ownerPid) return "ours"
  return isProcessAlive(pid) ? "foreign" : "zombie"
}

/**
 * 纯函数：按轮转顺序给出候选端口（排除已用 + 黑名单）。
 * 轮转可避免每次都从池首撞同一个坏端口。
 */
export function candidateOrder(
  pool: number[],
  opts: { used?: Iterable<number>; exclude?: Iterable<number>; cursor?: number } = {},
): number[] {
  const used = new Set(opts.used ?? [])
  const exclude = new Set(opts.exclude ?? [])
  const n = pool.length
  if (n === 0) return []
  const start = (((opts.cursor ?? 0) % n) + n) % n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const p = pool[(start + i) % n]
    if (used.has(p) || exclude.has(p)) continue
    out.push(p)
  }
  return out
}
