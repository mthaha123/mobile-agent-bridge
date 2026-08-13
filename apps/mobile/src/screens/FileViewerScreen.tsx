/**
 * FileViewerScreen — 全屏文件查看器
 *
 * 独立于文件浏览器的沉浸式阅读页：
 * - 文本/代码：行号 + 等宽字体，字号可调，可复制/下载
 * - Markdown：默认渲染，一键切换查看源码
 * - 图片：全屏查看 + 下载
 */
import React from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Share,
  Alert,
  Image,
} from 'react-native'
import { useFileStore } from '../stores/fileStore'
import { useAuthStore } from '../stores/authStore'
import { useUiStore } from '../stores/uiStore'
import { MarkdownRenderer } from '../components/chat/MarkdownRenderer'
import ReactNativeBlobUtil from 'react-native-blob-util'

const MAX_FONT = 24
const MIN_FONT = 10

const MIME_TYPES: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', js: 'application/javascript',
  ts: 'text/plain', tsx: 'text/plain', html: 'text/html', css: 'text/css', xml: 'text/xml',
  csv: 'text/csv', log: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', heic: 'image/heic', avif: 'image/avif',
}

const getMimeType = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[ext] || 'application/octet-stream'
}

export const FileViewerScreen: React.FC = () => {
  const currentFile = useFileStore((s) => s.currentFile)
  const viewerMode = useFileStore((s) => s.viewerMode)
  const viewerImage = useFileStore((s) => s.viewerImage)
  const viewerFontSize = useFileStore((s) => s.viewerFontSize)
  const viewerShowLineNumbers = useFileStore((s) => s.viewerShowLineNumbers)
  const viewerShowSource = useFileStore((s) => s.viewerShowSource)
  const viewerWrap = useFileStore((s) => s.viewerWrap)
  const closeViewer = useFileStore((s) => s.closeViewer)
  const setViewerFontSize = useFileStore((s) => s.setViewerFontSize)
  const toggleLineNumbers = useFileStore((s) => s.toggleLineNumbers)
  const toggleViewerSource = useFileStore((s) => s.toggleViewerSource)
  const toggleViewerWrap = useFileStore((s) => s.toggleViewerWrap)
  const setLoading = useFileStore((s) => s.setLoading)

  const client = useAuthStore((s) => s.client)
  const popViewer = useUiStore((s) => s.popViewer)

  const isMarkdown = (path: string) => path.toLowerCase().endsWith('.md')
  const showRendered = isMarkdown(currentFile?.path || '') && !viewerShowSource

  const handleClose = () => {
    closeViewer()
    popViewer()
  }

  const handleCopy = async () => {
    if (!currentFile?.content) return
    try {
      await Share.share({ message: currentFile.content })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '复制失败'
      Alert.alert('Error', msg)
    }
  }

  const handleDownload = async () => {
    if (!currentFile && !viewerImage) return
    const name = currentFile ? currentFile.path.split(/[/\\]/).pop() || 'file' : viewerImage?.name || 'image'
    setLoading(true)
    try {
      let content: string
      if (currentFile) {
        const data = await client?.readFile(currentFile.path, 'base64')
        if (!data?.content) throw new Error('读取文件失败')
        content = data.content
      } else {
        // 图片来自 base64 data URI（data:image/png;base64,xxxx）
        const m = viewerImage?.uri.match(/^data:[^;]+;base64,(.+)$/)
        if (!m) throw new Error('图片数据无效')
        content = m[1]
      }
      const cachePath = ReactNativeBlobUtil.fs.dirs.CacheDir + '/' + name
      await ReactNativeBlobUtil.fs.writeFile(cachePath, content, 'base64')
      const uri = await ReactNativeBlobUtil.MediaCollection.createMediafile(
        { name, parentFolder: '', mimeType: getMimeType(name) },
        'Download',
      )
      await ReactNativeBlobUtil.MediaCollection.writeToMediafile(uri, cachePath)
      ReactNativeBlobUtil.fs.unlink(cachePath).catch(() => {})
      Alert.alert('下载成功', `已保存到公共 Download 目录`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      Alert.alert('下载失败', msg)
    } finally {
      setLoading(false)
    }
  }

  // 下载仅针对文本文件；图片走 image 分支的下载
  const renderText = () => {
    if (!currentFile) return null
    if (showRendered) {
      return (
        <View style={styles.renderedWrap}>
          <MarkdownRenderer content={currentFile.content} />
        </View>
      )
    }

    const lines = currentFile.content.split('\n')
    if (viewerWrap) {
      return (
        <ScrollView style={styles.codeScroll}>
          {lines.map((line, i) => (
            <View key={i} style={styles.codeLine}>
              {viewerShowLineNumbers && (
                <Text style={[styles.lineNumber, { fontSize: viewerFontSize - 2 }]}>
                  {i + 1}
                </Text>
              )}
              <Text style={[styles.codeContent, { fontSize: viewerFontSize }]}>
                {line.length > 0 ? line : ' '}
              </Text>
            </View>
          ))}
        </ScrollView>
      )
    }
    // 不换行模式：横向滚动，长行保持一行
    const maxLineWidth = lines.reduce((m, l) => Math.max(m, l.length), 0)
    return (
      <ScrollView style={styles.codeScroll} contentContainerStyle={{ paddingBottom: 8 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator style={styles.noWrapScroll}>
          <View>
            {lines.map((line, i) => (
              <View key={i} style={styles.noWrapLine}>
                {viewerShowLineNumbers && (
                  <Text style={[styles.noWrapLineNumber, { fontSize: viewerFontSize - 2 }]}>
                    {i + 1}
                  </Text>
                )}
                <Text
                  style={[
                    maxLineWidth > 200 ? styles.codeContentNoWrapLong : styles.codeContentNoWrap,
                    { fontSize: viewerFontSize },
                  ]}
                >
                  {line.length > 0 ? line : ' '}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </ScrollView>
    )
  }

  const renderImage = () => {
    if (!viewerImage) return null
    return (
      <Image
        source={{ uri: viewerImage.uri }}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel={viewerImage.name}
      />
    )
  }

  const fileName = currentFile?.path.split(/[/\\]/).pop()
    || viewerImage?.name
    || ''

  const canToggleSource = isMarkdown(currentFile?.path || '')

  return (
    <View style={styles.container}>
      {/* 顶栏 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleClose} style={styles.headerBtn} accessibilityLabel="Close viewer">
          <Text style={styles.headerBack}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{fileName}</Text>
        <View style={styles.headerActions}>
          {canToggleSource && (
            <TouchableOpacity onPress={toggleViewerSource} style={styles.headerBtn}>
              <Text style={styles.headerActionText}>{viewerShowSource ? '渲染' : '源码'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setViewerFontSize(viewerFontSize - 1)} style={styles.headerBtn}>
            <Text style={styles.headerActionText}>A−</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewerFontSize(viewerFontSize + 1)} style={styles.headerBtn}>
            <Text style={styles.headerActionText}>A+</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 内容区 */}
      <View style={styles.content}>
        {viewerMode === 'image' ? renderImage() : renderText()}
      </View>

      {/* 底栏 */}
      <View style={styles.footer}>
        <Text style={styles.footerInfo}>
          {currentFile ? `${currentFile.content.split('\n').length} 行 • ${formatSize(currentFile.size)} • ${currentFile.encoding || 'UTF-8'}` : viewerImage?.name || ''}
        </Text>
        <View style={styles.footerActions}>
          {viewerMode === 'text' && (
            <TouchableOpacity onPress={toggleLineNumbers} style={styles.footerBtn}>
              <Text style={styles.footerBtnText}>{viewerShowLineNumbers ? '行号开' : '行号关'}</Text>
            </TouchableOpacity>
          )}
          {viewerMode === 'text' && !showRendered && (
            <TouchableOpacity onPress={toggleViewerWrap} style={styles.footerBtn}>
              <Text style={styles.footerBtnText}>{viewerWrap ? '不换行' : '换行'}</Text>
            </TouchableOpacity>
          )}
          {viewerMode === 'text' && (
            <TouchableOpacity onPress={handleCopy} style={styles.footerBtn}>
              <Text style={styles.footerBtnText}>复制</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleDownload} style={styles.footerBtn}>
            <Text style={styles.footerBtnText}>⬇ 下载</Text>
          </TouchableOpacity>
        </View>
      </View>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#0f3460',
    borderBottomWidth: 1,
    borderBottomColor: '#16213e',
  },
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  headerBack: {
    color: '#4a9eff',
    fontSize: 20,
    fontWeight: '600',
  },
  headerTitle: {
    flex: 1,
    color: '#eee',
    fontSize: 15,
    fontWeight: '600',
    marginHorizontal: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActionText: {
    color: '#4a9eff',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  codeScroll: {
    flex: 1,
    backgroundColor: '#16213e',
  },
  codeLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  lineNumber: {
    color: '#6b7a99',
    fontFamily: 'monospace',
    width: 48,
    textAlign: 'right',
    marginRight: 12,
    lineHeight: 22,
  },
  codeContent: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flex: 1,
    lineHeight: 22,
  },
  noWrapScroll: {
    backgroundColor: '#16213e',
  },
  noWrapLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 1,
    minWidth: '100%',
  },
  noWrapLineNumber: {
    color: '#6b7a99',
    fontFamily: 'monospace',
    width: 48,
    textAlign: 'right',
    marginRight: 12,
    lineHeight: 22,
  },
  codeContentNoWrap: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flexShrink: 0,
    lineHeight: 22,
  },
  codeContentNoWrapLong: {
    color: '#d4d4d4',
    fontFamily: 'monospace',
    flexShrink: 0,
    lineHeight: 22,
    minWidth: 1200,
  },
  renderedWrap: {
    padding: 16,
  },
  image: {
    flex: 1,
    width: '100%',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#0f0f23',
    borderTopWidth: 1,
    borderTopColor: '#16213e',
  },
  footerInfo: {
    color: '#888',
    fontSize: 12,
    flex: 1,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerBtn: {
    marginLeft: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  footerBtnText: {
    color: '#4a9eff',
    fontSize: 13,
    fontWeight: '600',
  },
})
