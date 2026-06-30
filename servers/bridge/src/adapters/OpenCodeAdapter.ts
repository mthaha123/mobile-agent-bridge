import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"

/**
 * OpenCode SDK 适配器
 *
 * 封装 @opencode-ai/sdk v2，管理 OpencodeClient 生命周期。
 * Bridge 持有唯一活跃 client，通过 setupProject 创建。
 */
export class OpenCodeBackend {
  public sdk: OpencodeClient | null = null
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /** 创建 SDK client（绑定 directory） */
  createClient(directory: string): void {
    this.sdk?.global.dispose().catch(() => {})
    this.sdk = createOpencodeClient({
      baseUrl: this.baseUrl,
      directory,
    })
  }

  /** 销毁当前 client */
  dispose(): void {
    if (this.sdk) {
      this.sdk.global.dispose().catch(() => {})
      this.sdk = null
    }
  }
}

let _backend: OpenCodeBackend | null = null

export function initBackend(baseUrl: string): OpenCodeBackend {
  _backend = new OpenCodeBackend(baseUrl)
  return _backend
}

export function getBackend(): OpenCodeBackend {
  if (!_backend) throw new Error("OpenCodeBackend not initialized")
  return _backend
}
