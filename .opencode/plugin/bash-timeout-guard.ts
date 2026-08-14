import type { Plugin } from "@opencode-ai/plugin"

const MAX_TIMEOUT_MS = 180_000

// ── 危险进程派发模式检测 ──────────────────────────────────────────────
// AGENTS.md 核心约束：禁止 `spawn(cmd, { detached: true, stdio: pipe })` 派生长驻进程。
// detached + stdio:pipe 会让子进程持有管道句柄，bash 工具层等待管道 EOF 永不收敛
// → 工具调用挂起（静默）/ 被强制中断。长驻进程必须用 Start-Process -WindowStyle Hidden。
const DANGEROUS_SPAWN =
  /spawn\s*\([\s\S]{0,800}?detached\s*:\s*true[\s\S]{0,800}?stdio\s*:\s*[\s\S]{0,300}?["']pipe["']/

const BLOCK_HINT =
  `该命令包含 AGENTS.md 禁止的危险进程派发模式（spawn + detached:true + stdio:pipe）。` +
  `detached 子进程持有管道句柄会导致 bash 工具静默挂起。` +
  `请改用 Start-Process -WindowStyle Hidden 启动长驻进程（日志写 logs/build/），` +
  `或用短查询轮询检查结果，禁止 spawn(detached) + stdio:pipe。`

function isDangerousSpawn(command: string): boolean {
  return DANGEROUS_SPAWN.test(command)
}

function blockCommand(hint: string): string {
  const safe = hint.replace(/'/g, "''")
  return `Write-Output '[强制阻断] ${safe}'; exit 99`
}

export const BashTimeoutGuard: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      // 危险模式：改写命令，执行前即失败并给出指引
      if (typeof output.args.command === "string" && isDangerousSpawn(output.args.command)) {
        console.log(`[BashTimeoutGuard] 检测到危险 spawn 模式，已强制阻断`)
        output.args.command = blockCommand(BLOCK_HINT)
        return
      }

      const original = output.args.timeout
      const capped = original == null || original > MAX_TIMEOUT_MS

      if (original == null) {
        output.args.timeout = MAX_TIMEOUT_MS
      } else if (original > MAX_TIMEOUT_MS) {
        output.args.timeout = MAX_TIMEOUT_MS
      }

      // 返回修改信息给 agent（仅提示，不阻止执行）
      if (capped) {
        console.log(
          `[BashTimeoutGuard] timeout ${original ? `${original / 1000}s` : "未设置"} → ${MAX_TIMEOUT_MS / 1000}s（cap）`
        )
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "bash") return

      // bash 工具超时返回 "Command exceeded timeout of X ms"；opencode 已强制中止进程
      const isTimeout = typeof output.output === "string" && output.output.includes("Command exceeded timeout")

      if (isTimeout) {
        const reminder =
          `\n\n[超时] 该 bash 命令运行超过 ${MAX_TIMEOUT_MS / 1000}s，已被强制终止。` +
          `请勿让 bash 阻塞超过 ${MAX_TIMEOUT_MS / 1000}s：改为短查询轮询或 fire-and-forget 后台任务。`
        output.output = `${output.output}${reminder}`
        console.log(`[BashTimeoutGuard] bash 超时已被强制终止（>${MAX_TIMEOUT_MS / 1000}s）`)
      }
    },
  }
}
