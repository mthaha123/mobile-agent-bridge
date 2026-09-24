/**
 * uploadFile — 分块上传编排层
 *
 * 流程：整读本地文件为 base64 → file.upload.begin（服务端返回 chunkSize）
 *       → 按 chunkSize 切片顺序单发 → finish。
 * 传输层（BridgeClient）通过参数注入，便于单测。
 *
 * 内存说明：react-native-blob-util 无范围读 API（已验证 index.d.ts 只有
 * readFile/readStream 且 readStream 不支持 offset/length），故整读切片；
 * 默认 5MB 上限（BRIDGE_MAX_UPLOAD_BYTES）下 base64 ≈ 6.7MB，内存可控。
 * chunkSize 必须是 4 的倍数（服务端 UPLOAD_CHUNK_SIZE_CHARS 保证），
 * 切片边界才落在 base64 组边界上，每块可独立解码。
 */
import ReactNativeBlobUtil from 'react-native-blob-util'

export interface UploadTarget {
  dir: string
  name: string
}

export interface UploadProgress {
  name: string
  sent: number
  total: number
}

export interface UploadClient {
  uploadBegin(params: {
    dir: string
    name: string
    size: number
    overwrite?: boolean
  }): Promise<{ uploadId: string; chunkSize: number }>
  uploadChunk(uploadId: string, index: number, data: string): Promise<{ received: number; total: number }>
  uploadFinish(uploadId: string): Promise<{ path: string; size: number }>
  uploadAbort(uploadId: string): Promise<{ ok: boolean }>
}

export interface UploadOptions {
  overwrite?: boolean
  onProgress?: (p: UploadProgress) => void
  /** 回传 uploadId，供 UI 取消按钮调用 uploadAbort */
  onUploadId?: (uploadId: string) => void
}

/** base64 字符串 → 解码后字节数（处理 '==' / '=' padding） */
export function base64ByteLength(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

export async function uploadFile(
  client: UploadClient,
  localUri: string,
  target: UploadTarget,
  opts: UploadOptions = {},
): Promise<{ path: string; size: number }> {
  const b64: string = await ReactNativeBlobUtil.fs.readFile(localUri, 'base64')
  const size = base64ByteLength(b64)

  const { uploadId, chunkSize } = await client.uploadBegin({
    dir: target.dir,
    name: target.name,
    size,
    overwrite: opts.overwrite ?? false,
  })
  opts.onUploadId?.(uploadId)

  try {
    let index = 0
    for (let i = 0; i < b64.length; i += chunkSize) {
      const chunk = b64.slice(i, i + chunkSize)
      await client.uploadChunk(uploadId, index, chunk) // 顺序单发：等 ack 再发下一块
      index += 1
      opts.onProgress?.({
        name: target.name,
        sent: Math.min(i + chunkSize, b64.length),
        total: b64.length,
      })
    }
    return await client.uploadFinish(uploadId)
  } catch (err) {
    // 任何中途失败：尽力清理服务端会话（abort 幂等），再重抛原错误
    await client.uploadAbort(uploadId).catch(() => {})
    throw err
  }
}
