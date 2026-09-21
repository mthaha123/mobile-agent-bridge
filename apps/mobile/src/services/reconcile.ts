/**
 * 周期对账钩子（question / permission）。
 *
 * 背景：SSE/WS 不重放事件，通知一旦丢失，本地状态会永久缺失。消息路径已有
 * 「busy 期 5s 权威快照」兜底（chatStore.ensureStatusPolling），但
 * question/permission 此前只在「WS 重连 / App 回前台」时对账——前台运行中
 * 一旦静默丢事件（bridge SSE 转发停摆、僵尸半开等），就再没有任何弹框，
 * 只能重启 App 才恢复。
 *
 * 这里提供一个注册点：AppProvider 建立连接时把「双向对账实现」注册进来，
 * chatStore 的 busy 轮询 tick（5s）顺带调用 runReconcile()。未注册时为 no-op，
 * 因此单元测试里未挂 AppProvider 的场景不受影响。
 */
export type ReconcileHook = () => void | Promise<void>

let hook: ReconcileHook | null = null

export function setReconcileHook(fn: ReconcileHook | null): void {
  hook = fn
}

/** 触发一次对账（fire-and-forget；失败静默，不影响调用方轮询）。 */
export function runReconcile(): void {
  if (!hook) return
  try {
    void Promise.resolve(hook()).catch(() => {})
  } catch {
    // 钩子同步抛错：忽略，轮询照常
  }
}
