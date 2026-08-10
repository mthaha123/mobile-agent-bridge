/**
 * Auto-mock for react-native-fs — used by Jest.
 * Provides path constants and writeFile/mkdir for FileBrowser download tests.
 */
module.exports = {
  DocumentDirectoryPath: '/mock/documents',
  DownloadDirectoryPath: '/mock/downloads',
  ExternalStorageDirectoryPath: '/mock/external',
  CachesDirectoryPath: '/mock/caches',
  writeFile: jest.fn().mockResolvedValue(true),
  mkdir: jest.fn().mockResolvedValue(true),
  readFile: jest.fn().mockResolvedValue(''),
  exists: jest.fn().mockResolvedValue(false),
  unlink: jest.fn().mockResolvedValue(true),
}
