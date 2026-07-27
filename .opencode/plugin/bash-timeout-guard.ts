import type { Plugin } from "@opencode-ai/plugin"

const MAX_TIMEOUT_MS = 180_000

export const BashTimeoutGuard: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "bash") {
        if (output.args.timeout == null || output.args.timeout > MAX_TIMEOUT_MS) {
          throw new Error(
            `bash timeout 不能超过 ${MAX_TIMEOUT_MS / 1000}s（当前 ${output.args.timeout ? `${output.args.timeout / 1000}s` : "未设置"}）。`
            + `\n长任务需改用后台方式：Start-Process -WindowStyle Hidden 或 Start-Job，`
            + `\n日志检查用短查询（timeout ≤ 15s）轮询。`
          )
        }
      }
    },
  }
}
