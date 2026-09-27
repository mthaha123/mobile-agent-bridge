/**
 * uploadFile — 分块上传编排层单元测试（方案 B：readStream 流式读取）
 *
 * 背景：整读 base64 方案在 50MB 目标下被设备实测证伪——
 *   react-native-blob-util readFile('base64') 在 Java 层一次性
 *   Base64.encodeToString(46MB) → 123MB String → Java heap OOM 杀进程
 *   （2026-09-27 logcat: ReactNativeBlobUtilFS.readFile:287）。
 * 本版本改为 fs.readStream 分块（bufferSize=65536，tick=0 不 sleep），
 * 单块 Java 内存 ~65KB，服务端协议不变（每块独立标准 base64，逐块解码拼接）。
 *
 * 客户端以注入 fake（UploadClient + fake stream）测试。
 */
import ReactNativeBlobUtil from 'react-native-blob-util'
import { uploadFile, base64ByteLength, UploadClient } from '../src/services/uploadFile'

const blobUtilModule = require('react-native-blob-util')
const makeReadStream = blobUtilModule._makeReadStream

function makeUploadClient(
  overrides: Partial<Record<keyof UploadClient, jest.Mock>> = {},
) {
  return {
    uploadBegin: jest.fn().mockResolvedValue({ uploadId: 'up1', chunkSize: 262144 }),
    uploadChunk: jest.fn().mockResolvedValue({ received: 0, total: 0 }),
    uploadFinish: jest.fn().mockResolvedValue({ path: '/dir/hello.txt', size: 10 }),
    uploadAbort: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as UploadClient & Record<string, jest.Mock>
}

/** 设置 stat + readStream 的一次性实现 */
function setupStream(chunks: string[], opts: { error?: Error } = {}, size = 10) {
  const blobFs = ReactNativeBlobUtil.fs
  ;(blobFs.stat as jest.Mock).mockResolvedValueOnce({
    size, type: 'file', filename: 'x', path: '/mock/x', lastModified: 0,
  })
  ;(blobFs.readStream as jest.Mock).mockResolvedValueOnce(
    makeReadStream(chunks, opts),
  )
}

describe('base64ByteLength', () => {
  it('无 padding', () => {
    expect(base64ByteLength('YWJj')).toBe(3) // 'abc'
  })
  it('1 字节 padding', () => {
    expect(base64ByteLength('aGVsbG8=')).toBe(5) // 'hello'
  })
  it('2 字节 padding', () => {
    expect(base64ByteLength('YQ==')).toBe(1) // 'a'
  })
})

describe('uploadFile（流式）', () => {
  const C1 = Buffer.from('hello ').toString('base64') // 'hello ' = 6
  const C2 = Buffer.from('world').toString('base64') //  'world' = 5  → size 11

  beforeEach(() => {
    // reset 而非 clear：清掉 mockResolvedValueOnce 队列，防止 begin-fail 等
    // 未消费的 once 实现泄漏给后续用例（每个用例都自带 setupStream）
    jest.resetAllMocks()
  })

  it('stat size → begin，流块按序原样转发 → finish', async () => {
    const client = makeUploadClient()
    setupStream([C1, C2], {}, 11)

    const result = await uploadFile(client, '/mock/cache/hello.txt', { dir: '/dir', name: 'hello.txt' })

    expect(client.uploadBegin).toHaveBeenCalledWith({
      dir: '/dir', name: 'hello.txt', size: 11, overwrite: false,
    })
    expect(client.uploadChunk).toHaveBeenCalledTimes(2)
    expect(client.uploadChunk).toHaveBeenNthCalledWith(1, 'up1', 0, C1)
    expect(client.uploadChunk).toHaveBeenNthCalledWith(2, 'up1', 1, C2)
    expect(client.uploadFinish).toHaveBeenCalledWith('up1')
    expect(client.uploadAbort).not.toHaveBeenCalled()
    expect(result).toEqual({ path: '/dir/hello.txt', size: 10 })
  })

  it('onProgress 按解码字节累计（total=stat size），onUploadId 回传', async () => {
    const client = makeUploadClient()
    setupStream([C1, C2], {}, 11)
    const progress: Array<{ name: string; sent: number; total: number }> = []
    let seenId: string | undefined

    await uploadFile(client, '/mock/cache/hello.txt', { dir: '/dir', name: 'hello.txt' }, {
      onProgress: (p) => progress.push(p),
      onUploadId: (id) => { seenId = id },
    })

    expect(seenId).toBe('up1')
    expect(progress).toHaveLength(2)
    expect(progress[0]).toEqual({ name: 'hello.txt', sent: 6, total: 11 })
    expect(progress[1]).toEqual({ name: 'hello.txt', sent: 11, total: 11 })
  })

  it('chunk 失败时 abort 后重抛原错误（后续流块被忽略）', async () => {
    const client = makeUploadClient({
      uploadChunk: jest.fn().mockRejectedValue(new Error('boom')),
    })
    setupStream([C1, C2], {}, 11)

    await expect(
      uploadFile(client, '/mock/cache/x', { dir: '/d', name: 'x' }),
    ).rejects.toThrow('boom')
    expect(client.uploadAbort).toHaveBeenCalledWith('up1')
    expect(client.uploadFinish).not.toHaveBeenCalled()
  })

  it('begin 失败时不调用 abort（会话未建立）', async () => {
    const client = makeUploadClient({
      uploadBegin: jest.fn().mockRejectedValue(new Error('EEXIST: already exists')),
    })
    setupStream([C1], {}, 11)

    await expect(
      uploadFile(client, '/mock/cache/x', { dir: '/d', name: 'x' }, { overwrite: true }),
    ).rejects.toThrow('EEXIST')
    expect(client.uploadChunk).not.toHaveBeenCalled()
    expect(client.uploadAbort).not.toHaveBeenCalled()
  })

  it('overwrite 透传给 uploadBegin', async () => {
    const client = makeUploadClient()
    setupStream([C1], {}, 6)

    await uploadFile(client, '/mock/x', { dir: '/d', name: 'x' }, { overwrite: true })
    expect(client.uploadBegin).toHaveBeenCalledWith({
      dir: '/d', name: 'x', size: 6, overwrite: true,
    })
  })

  it('空文件（stat size 0、无流块）直接 begin→finish', async () => {
    const client = makeUploadClient()
    setupStream([], {}, 0)

    await uploadFile(client, '/mock/empty', { dir: '/d', name: 'empty.txt' })
    expect(client.uploadBegin).toHaveBeenCalledWith(expect.objectContaining({ size: 0 }))
    expect(client.uploadChunk).not.toHaveBeenCalled()
    expect(client.uploadFinish).toHaveBeenCalledWith('up1')
  })

  it('流 error → abort 后重抛', async () => {
    const client = makeUploadClient()
    setupStream([], { error: new Error('stream broke') }, 11)

    await expect(
      uploadFile(client, '/mock/x', { dir: '/d', name: 'x' }),
    ).rejects.toThrow('stream broke')
    expect(client.uploadAbort).toHaveBeenCalledWith('up1')
    expect(client.uploadFinish).not.toHaveBeenCalled()
  })

  it('stat 失败 → 不 begin 不 abort（流未开始）', async () => {
    const client = makeUploadClient()
    ;(ReactNativeBlobUtil.fs.stat as jest.Mock).mockRejectedValueOnce(
      new Error('ENOENT'),
    )

    await expect(
      uploadFile(client, '/mock/gone', { dir: '/d', name: 'gone.txt' }),
    ).rejects.toThrow('ENOENT')
    expect(client.uploadBegin).not.toHaveBeenCalled()
    expect(client.uploadAbort).not.toHaveBeenCalled()
  })
})
