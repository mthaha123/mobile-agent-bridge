#!/usr/bin/env node
/**
 * 端口段单一事实来源（生产 / 开发测试严格分段，禁止跨段顺位）
 *
 * 生产段（与隧道绑定，固定）:
 *   8080        生产 bridge
 *   4097        生产默认 opencode serve
 *   4100-4109   生产项目 serve 端口池（10，冗余；目标并发 5）
 *
 * 开发/测试段（完全独立，离生产 >1.5 万端口，杜绝"顺位使用"串段）:
 *   19985       开发/测试 bridge（= E2E 真实链路测试桥 TEST_BRIDGE_PORT）
 *   19986       开发默认 opencode serve
 *   19990-19999 开发项目 serve 端口池
 *   （E2E 脚本中额外的 opencode 用 44xx，bridge 用 19876/2000x，均在生产段之外）
 *
 * 规则：任何一个进程配置的端口必须【全部落在同一段】。
 * 混用生产段与开发段 → 视为配置错误，启动脚本会拒绝执行。
 */

/** 生产段保留端口 */
export const PROD_PORTS = [8080, 4097, 4100, 4101, 4102, 4103, 4104, 4105, 4106, 4107, 4108, 4109]

/** 开发/测试段保留端口 */
export const DEV_PORTS = [
  19985, 19986,
  19990, 19991, 19992, 19993, 19994, 19995, 19996, 19997, 19998, 19999,
]

export function isProdPort(port) {
  return PROD_PORTS.includes(Number(port))
}

export function isDevPort(port) {
  return DEV_PORTS.includes(Number(port))
}

/** 端口归类：'prod' | 'dev' | 'other' */
export function classifyPort(port) {
  const n = Number(port)
  if (isProdPort(n)) return "prod"
  if (isDevPort(n)) return "dev"
  return "other"
}

/**
 * 校验一组端口是否全部同段（prod 或 dev）；混段或空则不通过。
 * @returns {{ ok: boolean, env: 'prod'|'dev'|'mixed'|'none', offenders: Array<{port:number, env:string}> }}
 */
export function checkPortGroup(ports) {
  const list = ports.filter((p) => Number.isInteger(Number(p)) && Number(p) > 0)
  const classes = list.map((p) => ({ port: Number(p), env: classifyPort(p) }))
  const hasProd = classes.some((c) => c.env === "prod")
  const hasDev = classes.some((c) => c.env === "dev")
  if (hasProd && hasDev) return { ok: false, env: "mixed", offenders: classes }
  if (hasProd) return { ok: true, env: "prod", offenders: [] }
  if (hasDev) return { ok: true, env: "dev", offenders: [] }
  return { ok: true, env: "none", offenders: [] }
}

export const DEFAULT_TEST_BRIDGE_PORT = 19985
export const DEFAULT_MOCK_BRIDGE_PORT = 8081
export const DEFAULT_MOCK_PUSH_PORT = 18081

/** 真实链路测试桥端口（可用 TEST_BRIDGE_PORT 覆盖） */
export const TEST_BRIDGE_PORT = Number(process.env.TEST_BRIDGE_PORT || DEFAULT_TEST_BRIDGE_PORT)

/** 手机端（Android 模拟器）访问宿主的地址前缀 */
export const EMULATOR_HOST = process.env.EMULATOR_HOST || "10.0.2.2"

/**
 * 断言端口不是生产端口；命中即抛错。
 * @throws {Error}
 */
export function assertTestPort(port, label) {
  if (isProdPort(port)) {
    throw new Error(
      `[隔离守卫] ${label}=${port} 命中生产端口（禁用: ${PROD_PORTS.join(", ")}），已拒绝执行。` +
      ` 请改用非生产端口（如 TEST_BRIDGE_PORT=${DEFAULT_TEST_BRIDGE_PORT}）。`,
    )
  }
  return port
}
