/**
 * Auto-mock for react-native-blob-util — used by Jest before test files load.
 * 带 __esModule 让 ESM 默认导入（interop）正确解到 default；
 * 旧式 require().default.fs 访问同样不受影响。
 */
module.exports = {
  __esModule: true,
  default: {
    fs: {
      dirs: {
        DownloadDir: '/mock/downloads',
        DocumentDir: '/mock/documents',
        CacheDir: '/mock/cache',
      },
      writeFile: jest.fn().mockResolvedValue('/mock/downloads/test.bin'),
      readFile: jest.fn().mockResolvedValue(''),
      unlink: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn().mockResolvedValue(false),
      mkdir: jest.fn().mockResolvedValue(undefined),
      ls: jest.fn().mockResolvedValue([]),
    },
  },
}
