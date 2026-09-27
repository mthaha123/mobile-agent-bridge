/**
 * Auto-mock for react-native-blob-util — used by Jest before test files load.
 * 带 __esModule 让 ESM 默认导入（interop）正确解到 default；
 * 旧式 require().default.fs 访问同样不受影响。
 */
module.exports = {
  __esModule: true,
  /**
   * 构造 fake readStream（同步发射，测试确定性用）：
   *   _makeReadStream(['b64...', ...])        —— open() 依次 onData 后 onEnd
   *   _makeReadStream([], { error: err })     —— open() 直接 onError
   *   _makeReadStream(['a'], { pauseAfter: 1 }) —— 暂不支持；保持简单
   */
  _makeReadStream(chunks, opts = {}) {
    let onData = () => {}
    let onEnd = () => {}
    let onError = () => {}
    const stream = {
      closed: false,
      onData(fn) { onData = fn },
      onEnd(fn) { onEnd = fn },
      onError(fn) { onError = fn },
      open() {
        if (opts.error) {
          stream.closed = true
          onError(opts.error)
          return
        }
        for (const c of chunks) onData(c)
        stream.closed = true
        onEnd()
      },
    }
    return stream
  },
  default: {
    fs: {
      dirs: {
        DownloadDir: '/mock/downloads',
        DocumentDir: '/mock/documents',
        CacheDir: '/mock/cache',
      },
      writeFile: jest.fn().mockResolvedValue('/mock/downloads/test.bin'),
      readFile: jest.fn().mockResolvedValue(''),
      stat: jest.fn().mockResolvedValue({
        size: 11,
        type: 'file',
        filename: 'hello.txt',
        path: '/mock/cache/hello.txt',
        lastModified: 0,
      }),
      // 默认流：单块 'hello world' 的 base64，open() 同步发射后 end（真实实现为异步 native 事件）
      readStream: jest.fn(() =>
        Promise.resolve(module.exports._makeReadStream(['aGVsbG8gd29ybGQ='])),
      ),
      unlink: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      mkdir: jest.fn().mockResolvedValue(undefined),
      ls: jest.fn().mockResolvedValue([]),
    },
    android: {
      actionViewIntent: jest.fn().mockResolvedValue(true),
    },
  },
}
