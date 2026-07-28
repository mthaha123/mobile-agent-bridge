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
  }
}
