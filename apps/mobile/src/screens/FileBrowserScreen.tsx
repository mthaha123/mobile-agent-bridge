import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native'
import { useFileStore, FileInfo, SearchResult } from '../stores/fileStore'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { useUiStore } from '../stores/uiStore'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'heic', 'avif']

const MIME_TYPES: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', js: 'application/javascript',
  ts: 'text/plain', tsx: 'text/plain', html: 'text/html', css: 'text/css', xml: 'text/xml',
  csv: 'text/csv', log: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml', pdf: 'application/pdf',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar', apk: 'application/vnd.android.package-archive',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', heic: 'image/heic', avif: 'image/avif',
}

const getMimeType = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[ext] || 'application/octet-stream'
}

export const FileBrowserScreen: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const {
    currentPath,
    files,
    searchResults,
    searchQuery,
    loading,
    error,
    setCurrentPath,
    setFiles,
    setSearchResults,
    setSearchQuery,
    setLoading,
    setError,
    goUp,
    enterDirectory,
  } = useFileStore()

  const client = useAuthStore((s) => s.client)
  const projectDir = useProjectStore((s) => s.directory)
  const openTextViewer = useFileStore((s) => s.openTextViewer)
  const openImageViewer = useFileStore((s) => s.openImageViewer)
  const pushViewer = useUiStore((s) => s.pushViewer)

  const [fileInfoTarget, setFileInfoTarget] = useState<FileInfo | null>(null)

  const loadSeqRef = useRef(0)

  const loadDirectory = useCallback(async (path: string) => {
    if (!client) return

    const seq = ++loadSeqRef.current
    setLoading(true)
    setError(null)

    try {
      const files = await client.listFiles(path)
      // 只接受最新一次请求的结果，丢弃过期响应（避免竞态覆盖）
      if (seq !== loadSeqRef.current) return
      setFiles(files)
    } catch (err: unknown) {
      if (seq !== loadSeqRef.current) return
      const msg = err instanceof Error ? err.message : 'Failed to load directory'
      setError(msg)
      Alert.alert('Error', msg)
    } finally {
      if (seq === loadSeqRef.current) setLoading(false)
    }
  }, [client, setFiles, setLoading, setError])

  useEffect(() => {
    const initialPath = projectDir || '/'
    setCurrentPath(initialPath)
  }, [projectDir])

  useEffect(() => {
    if (currentPath) {
      loadDirectory(currentPath)
    }
  }, [currentPath])

  const handleFilePress = async (file: FileInfo) => {
    if (file.type === 'directory') {
      enterDirectory(file.name)
    } else if (file.type === 'file') {
      // 图片文件 → 全屏查看器
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      if (IMAGE_EXTS.includes(ext)) {
        setLoading(true)
        try {
          const data = await client?.readFile(currentPath + '/' + file.name, 'base64')
          if (data?.base64) {
            const mime = data.mimeType || 'image/png'
            openImageViewer({ uri: `data:${mime};base64,${data.content}`, name: file.name })
            pushViewer()
          }
        } catch (err: unknown) {
          Alert.alert('Error', err instanceof Error ? err.message : 'Failed to preview image')
        } finally {
          setLoading(false)
        }
        return
      }
      setLoading(true)
      try {
        const content = await client?.readFile(currentPath + '/' + file.name)
        if (content) {
          openTextViewer(content)
          pushViewer()
        }
      } catch (err: unknown) {
        Alert.alert('Error', err instanceof Error ? err.message : 'Failed to read file')
      } finally {
        setLoading(false)
      }
    }
  }

  const handleFileLongPress = (file: FileInfo) => {
    setFileInfoTarget(file)
  }

  // 下载文件：读取 base64 → 写入公共 Download 目录（Android MediaStore，用户可在文件管理器看到）
  const handleDownload = async (file: FileInfo) => {
    if (!client) return
    if (file.type !== 'file') {
      Alert.alert('下载', '仅支持下载文件')
      return
    }
    const filePath = currentPath + '/' + file.name
    setLoading(true)
    try {
      const data = await client.readFile(filePath, 'base64')
      if (!data?.content) throw new Error('读取文件失败')
      // 1. base64 先写入 app 缓存
      const cachePath = ReactNativeBlobUtil.fs.dirs.CacheDir + '/' + file.name
      await ReactNativeBlobUtil.fs.writeFile(cachePath, data.content, 'base64')
      // 2. 在公共 Download 集合创建条目
      const uri = await ReactNativeBlobUtil.MediaCollection.createMediafile(
        { name: file.name, parentFolder: '', mimeType: getMimeType(file.name) },
        'Download',
      )
      // 3. 把缓存内容写入 MediaStore 条目
      await ReactNativeBlobUtil.MediaCollection.writeToMediafile(uri, cachePath)
      // 4. 清理缓存
      ReactNativeBlobUtil.fs.unlink(cachePath).catch(() => {})
      Alert.alert('下载成功', `已保存到公共 Download 目录`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      Alert.alert('下载失败', msg)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim() || !client) return

    setLoading(true)
    setError(null)

    try {
      const results = await client.searchFiles(searchQuery, { dirs: [currentPath] })
      setSearchResults(results)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Search failed'
      setError(msg)
      Alert.alert('Error', msg)
    } finally {
      setLoading(false)
    }
  }

  const renderFileItem = ({ item }: { item: FileInfo }) => (
    <TouchableOpacity
      style={styles.fileItem}
      onPress={() => handleFilePress(item)}
      onLongPress={() => handleFileLongPress(item)}
    >
      <Text style={styles.fileIcon}>
        {item.type === 'directory' ? '📁' : item.type === 'symlink' ? '🔗' : '📄'}
      </Text>
      <View style={styles.fileInfo}>
        <Text style={styles.fileName}>{item.name}</Text>
        <Text style={styles.fileMeta}>
          {item.type === 'directory' ? 'Directory' : formatSize(item.size)}
          {item.permissions ? ` • ${item.permissions}` : ''}
        </Text>
      </View>
      {item.type === 'directory' && <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
  )

  const renderSearchResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      style={styles.searchResult}
      onPress={() => {
        Alert.alert('File', `${item.file}:${item.line}`)
      }}
    >
      <Text style={styles.searchFile}>{item.file}</Text>
      <Text style={styles.searchLine}>Line {item.line}</Text>
      <Text style={styles.searchContent} numberOfLines={2}>
        {item.content}
      </Text>
    </TouchableOpacity>
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {currentPath}
        </Text>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search files..."
          placeholderTextColor={colors.textTertiary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>Search</Text>
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {searchResults.length > 0 && !loading && (
        <FlatList
          data={searchResults}
          renderItem={renderSearchResult}
          keyExtractor={(item, index) => `${item.file}-${item.line}-${index}`}
          style={styles.list}
        />
      )}

      {!loading && searchResults.length === 0 && (
        <FlatList
          data={files}
          renderItem={renderFileItem}
          keyExtractor={(item) => item.name}
          style={styles.list}
          ListHeaderComponent={
            currentPath !== '/' && !/^[A-Za-z]:\/?$/.test(currentPath) ? (
              <TouchableOpacity style={styles.fileItem} onPress={goUp}>
                <Text style={styles.fileIcon}>📁</Text>
                <View style={styles.fileInfo}>
                  <Text style={styles.fileName}>..</Text>
                  <Text style={styles.fileMeta}>Parent Directory</Text>
                </View>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      <Modal
        visible={!!fileInfoTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setFileInfoTarget(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setFileInfoTarget(null)}
        >
          <View style={styles.fileInfoModal}>
            <Text style={styles.fileInfoTitle}>
              {fileInfoTarget?.type === 'directory' ? '📁' : fileInfoTarget?.type === 'symlink' ? '🔗' : '📄'}{' '}
              {fileInfoTarget?.name}
            </Text>
            <View style={styles.fileInfoRow}>
              <Text style={styles.fileInfoLabel}>Path</Text>
              <Text style={styles.fileInfoValue}>{currentPath}/{fileInfoTarget?.name}</Text>
            </View>
            <View style={styles.fileInfoRow}>
              <Text style={styles.fileInfoLabel}>Type</Text>
              <Text style={styles.fileInfoValue}>{fileInfoTarget?.type}</Text>
            </View>
            {fileInfoTarget?.type !== 'directory' && (
              <View style={styles.fileInfoRow}>
                <Text style={styles.fileInfoLabel}>Size</Text>
                <Text style={styles.fileInfoValue}>{formatSize(fileInfoTarget?.size || 0)}</Text>
              </View>
            )}
            {fileInfoTarget?.modified && (
              <View style={styles.fileInfoRow}>
                <Text style={styles.fileInfoLabel}>Modified</Text>
                <Text style={styles.fileInfoValue}>{fileInfoTarget.modified}</Text>
              </View>
            )}
            {fileInfoTarget?.permissions && (
              <View style={styles.fileInfoRow}>
                <Text style={styles.fileInfoLabel}>Permissions</Text>
                <Text style={styles.fileInfoValue}>{fileInfoTarget.permissions}</Text>
              </View>
            )}
            {fileInfoTarget?.type !== 'directory' && (
              <TouchableOpacity
                style={styles.fileInfoAction}
                onPress={() => {
                  const target = fileInfoTarget
                  setFileInfoTarget(null)
                  if (target) handleFilePress(target)
                }}
              >
                <Text style={styles.fileInfoActionText}>Open File</Text>
              </TouchableOpacity>
            )}
            {fileInfoTarget?.type !== 'directory' && (
              <TouchableOpacity
                style={[styles.fileInfoAction, styles.downloadAction]}
                onPress={() => {
                  const target = fileInfoTarget
                  setFileInfoTarget(null)
                  if (target) handleDownload(target)
                }}
              >
                <Text style={styles.fileInfoActionText}>⬇ Download</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.surfaceVariant,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    marginRight: 12,
  },
  backText: {
    color: colors.primary,
    fontSize: 16,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 10,
    color: colors.text,
    marginRight: 8,
  },
  searchButton: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: colors.textOnPrimary,
    fontWeight: '600',
  },
  list: {
    flex: 1,
  },
  fileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fileIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    color: colors.text,
    fontSize: 16,
  },
  fileMeta: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  chevron: {
    color: colors.textTertiary,
    fontSize: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    padding: 12,
    backgroundColor: '#3a1a1a',
  },
  errorText: {
    color: '#ff6b6b',
  },
  searchResult: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchFile: {
    color: colors.primary,
    fontSize: 14,
  },
  searchLine: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  searchContent: {
    color: colors.text,
    fontSize: 14,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  fileInfoModal: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 20,
    width: '85%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  fileInfoTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  fileInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  fileInfoLabel: {
    color: colors.textTertiary,
    fontSize: 14,
    flex: 1,
  },
  fileInfoValue: {
    color: colors.text,
    fontSize: 14,
    flex: 2,
    textAlign: 'right',
  },
  fileInfoAction: {
    marginTop: 16,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  fileInfoActionText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '500',
  },
  downloadAction: {
    marginTop: 8,
  },
})
