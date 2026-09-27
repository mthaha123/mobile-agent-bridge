/**
 * uploadFile — 分块上传编排层（方案 B：readStream 流式读取）
 *
 * 流程：fs.stat 取 size → file.upload.begin → fs.readStream(base64) 分块
 *       → 顺序单发 file.upload.chunk → file.upload.finish。
 * 传输层（BridgeClient）通过参数注入，便于单测。
 *
 * 为什么不是整读（2026-09-27 设备实测证伪）：
 *   react-native-blob-util 的 readFile('base64') 在【Java 层】一次性
 *   Base64.encodeToString(46MB 文件) → 123MB String → 超 192MB Java heap
 *   → OOM FATAL 杀进程（logcat: ReactNativeBlobUtilFS.readFile:287,
 *   OutOfMemoryError: Failed to allocate a 123032976 byte allocation）。
 *   Hermes(UTF-16) 侧还会再放大一倍，50MB 目标下整读方案不可行。
 *
 * 流式参数选择（依据 ReactNativeBlobUtilStream.java 源码）：
 *   - bufferSize=65536：Java 每次读 64KB → 独立 Base64.encodeToString（含
 *     padding，服务端逐块 Buffer.from 解码拼接天然兼容）；单块 Java 内存
 *     ~65KB+87KB String，远离 OOM；44MB ≈ 704 个 WS 帧。
 *   - tick=0：Java 每块后 `if (tick > 0) SystemClock.sleep(tick)` —— 传 0
 *     关闭休眠（默认 10ms × 上万块会拖到超时）。
 *   - 服务端 UPLOAD_CHUNK_SIZE_CHARS=262144 是单帧上限，87384 字符远低于它。
 *
 * 无背压原语（readStream 没有 pause/destroy）：上传失败时置 fatal 忽略
 * 后续流块，native 读到自然 EOF 即退订；本地盘读与回环 WS 同量级，队列
 * 实测有界（设备端 44MB 实测通过）。
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

/** 流式读取参数：64KB/块、tick=0（详见文件头注释） */
const STREAM_BUFFER_SIZE = 65536
const STREAM_TICK = 0

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
  // 1) 真实文件大小（begin 的声明值，服务端 finish 时按它校验总字节）
  const stat = await ReactNativeBlobUtil.fs.stat(localUri)
  const size = Number(stat.size)
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`无法读取文件大小: ${localUri}`)
  }

  // 2) begin（在 try 外：会话未建立时失败无需 abort）
  const { uploadId } = await client.uploadBegin({
    dir: target.dir,
    name: target.name,
    size,
    overwrite: opts.overwrite ?? false,
  })
  opts.onUploadId?.(uploadId)

  try {
    let index = 0
    let sent = 0
    let chain: Promise<void> = Promise.resolve()
    let fatal: unknown = null
    let ended = false
    let settled = false

    const stream = await ReactNativeBlobUtil.fs.readStream(
      localUri,
      'base64',
      STREAM_BUFFER_SIZE,
      STREAM_TICK,
    )

    await new Promise<void>((resolve, reject) => {
      // end/error 后等串行链排空，再按 fatal 决定成败
      const drain = () => {
        if (settled || !ended) return
        chain.then(() => {
          if (settled) return
          settled = true
          if (fatal) reject(fatal as Error)
          else resolve()
        })
      }

      stream.onData((chunk) => {
        if (fatal) return // 失败后忽略后续流块（native 无 destroy，读到 EOF 自退）
        const data = typeof chunk === 'string' ? chunk : String(chunk)
        chain = chain
          .then(async () => {
            if (fatal) return
            await client.uploadChunk(uploadId, index, data)
            index += 1
            sent += base64ByteLength(data)
            opts.onProgress?.({ name: target.name, sent, total: size })
          })
          .catch((err) => { fatal = fatal ?? err })
      })
      stream.onError((err) => {
        fatal = fatal ?? err
        ended = true
        drain()
      })
      stream.onEnd(() => {
        ended = true
        drain()
      })
      stream.open() // executor 内同步 throw → 本 promise reject
    })

    return await client.uploadFinish(uploadId)
  } catch (err) {
    // 任何中途失败：尽力清理服务端会话（abort 幂等），再重抛原错误
    await client.uploadAbort(uploadId).catch(() => {})
    throw err
  }
}
