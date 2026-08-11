/**
 * Auto-mock for react-native-blob-util — used by Jest before test files load.
 */
module.exports = {
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
