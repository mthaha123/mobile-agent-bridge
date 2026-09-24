/**
 * uploadFile — 分块上传编排层单元测试
 * 覆盖：chunk 切片、进度回调、onUploadId 回传、失败 abort、overwrite 透传。
 * 客户端以注入 fake（UploadClient）测试，读文件走 blob-util mock（readFile → base64）。
 */
import ReactNativeBlobUtil from 'react-native-blob-util'
import { uploadFile, base64ByteLength, UploadClient } from '../src/services/uploadFile'

function makeUploadClient(
  overrides: Partial<Record<keyof UploadClient, jest.Mock>> = {},
) {
  return {
    uploadBegin: jest.fn().mockResolvedValue({ uploadId: 'up1', chunkSize: 8 }),
    uploadChunk: jest.fn().mockResolvedValue({ received: 0, total: 0 }),
    uploadFinish: jest.fn().mockResolvedValue({ path: '/dir/hello.txt', size: 11 }),
    uploadAbort: jest.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as UploadClient & Record<string, jest.Mock>
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

describe('uploadFile', () => {
  const B64 = Buffer.from('hello world').toString('base64') // 16 chars

  beforeEach(() => {
    ;(ReactNativeBlobUtil.fs.readFile as jest.Mock).mockResolvedValue(B64)
  })

  it('按服务端 chunkSize 切片并顺序上传（chunkSize=8 → 2 块）', async () => {
    const client = makeUploadClient()
    await uploadFile(client, 'file:///mock/cache/hello.txt', { dir: '/dir', name: 'hello.txt' })

    expect(client.uploadBegin).toHaveBeenCalledWith({
      dir: '/dir', name: 'hello.txt', size: 11, overwrite: false,
    })
    expect(client.uploadChunk).toHaveBeenCalledTimes(2)
    expect(client.uploadChunk).toHaveBeenNthCalledWith(1, 'up1', 0, B64.slice(0, 8))
    expect(client.uploadChunk).toHaveBeenNthCalledWith(2, 'up1', 1, B64.slice(8))
    expect(client.uploadFinish).toHaveBeenCalledWith('up1')
    expect(client.uploadAbort).not.toHaveBeenCalled()
  })

  it('onProgress 汇报 sent/total，onUploadId 回传 uploadId', async () => {
    const client = makeUploadClient()
    const progress: Array<{ name: string; sent: number; total: number }> = []
    let seenId: string | undefined

    const result = await uploadFile(client, 'file:///mock/cache/hello.txt', { dir: '/dir', name: 'hello.txt' }, {
      onProgress: (p) => progress.push(p),
      onUploadId: (id) => { seenId = id },
    })

    expect(seenId).toBe('up1')
    expect(progress).toHaveLength(2)
    expect(progress[0].sent).toBe(8)
    expect(progress[1]).toEqual({ name: 'hello.txt', sent: 16, total: 16 })
    expect(result).toEqual({ path: '/dir/hello.txt', size: 11 })
  })

  it('chunk 失败时 abort 后重抛原错误', async () => {
    const client = makeUploadClient({
      uploadChunk: jest.fn().mockRejectedValue(new Error('boom')),
    })
    await expect(
      uploadFile(client, 'file:///x', { dir: '/d', name: 'x' }),
    ).rejects.toThrow('boom')
    expect(client.uploadAbort).toHaveBeenCalledWith('up1')
    expect(client.uploadFinish).not.toHaveBeenCalled()
  })

  it('begin 失败时不调用 abort（会话未建立）', async () => {
    const client = makeUploadClient({
      uploadBegin: jest.fn().mockRejectedValue(new Error('EEXIST: already exists')),
    })
    await expect(
      uploadFile(client, 'file:///x', { dir: '/d', name: 'x' }, { overwrite: true }),
    ).rejects.toThrow('EEXIST')
    expect(client.uploadAbort).not.toHaveBeenCalled()
  })

  it('overwrite 透传给 uploadBegin', async () => {
    const client = makeUploadClient()
    await uploadFile(client, 'file:///x', { dir: '/d', name: 'x' }, { overwrite: true })
    expect(client.uploadBegin).toHaveBeenCalledWith({
      dir: '/d', name: 'x', size: 11, overwrite: true,
    })
  })

  it('空文件（base64 为空串）直接 begin→finish，无 chunk', async () => {
    ;(ReactNativeBlobUtil.fs.readFile as jest.Mock).mockResolvedValue('')
    const client = makeUploadClient()
    await uploadFile(client, 'file:///empty', { dir: '/d', name: 'empty.txt' })
    expect(client.uploadBegin).toHaveBeenCalledWith(expect.objectContaining({ size: 0 }))
    expect(client.uploadChunk).not.toHaveBeenCalled()
    expect(client.uploadFinish).toHaveBeenCalledWith('up1')
  })
})
