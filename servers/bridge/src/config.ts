/**
 * Bridge 运行配置解析（生产/测试隔离用）
 *
 * 目标：同一份代码可通过环境变量区分生产与测试实例，互不干扰：
 *   - 端口：BRIDGE_PORT / BRIDGE_SERVE_PORT_POOL
 *   - 数据：BRIDGE_DATA_DIR（注册表 projects.json 落盘目录）
 *
 * 所有解析函数均为纯函数，便于单测。
 */
import { join, resolve, isAbsolute } from "path"

/** serve 端口池默认值（与历史行为一致） */
export const DEFAULT_SERVE_PORT_POOL = [4100, 4101, 4102, 4103, 4104]

/**
 * 解析 serve 端口池：逗号分隔，去重、过滤非法值。
 * 任一项非法则忽略该项；全部非法/为空则回退默认池。
 */
export function parseServePortPool(raw: string | undefined): number[] {
  if (!raw || !raw.trim()) return [...DEFAULT_SERVE_PORT_POOL]
  const seen = new Set<number>()
  const out: number[] = []
  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10)
    if (!Number.isInteger(n) || n < 1 || n > 65535) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out.length ? out : [...DEFAULT_SERVE_PORT_POOL]
}

/**
 * 解析 bridge 数据目录。
 * 优先 BRIDGE_DATA_DIR（相对路径按 cwd 解析）；未设置则用默认 <projectRoot>/servers/bridge/data。
 */
export function resolveDataDir(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = (env.BRIDGE_DATA_DIR || "").trim()
  if (!override) return join(projectRoot, "servers", "bridge", "data")
  return isAbsolute(override) ? resolve(override) : resolve(process.cwd(), override)
}

/** 解析 bridge 监听端口（默认 8080） */
export function resolveBridgePort(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.BRIDGE_PORT || "", 10)
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : 8080
}

/** 解析 OpenCode 后端地址（默认 http://localhost:4096） */
export function resolveOpenCodeUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OPENCODE_URL || "http://localhost:4096").trim() || "http://localhost:4096"
}
