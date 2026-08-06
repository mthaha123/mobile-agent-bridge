import type { Plugin } from "@opencode-ai/plugin"

const MAX_TIMEOUT_MS = 180_000

export const BashTimeoutGuard: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

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
