/**
 * HtmlPreviewModal — HTML 文件弹窗预览
 *
 * - Modal 浮层（底部升起），不整页跳转
 * - 渲染/源码切换，WebView 禁用 JS
 * - 外部打开：写入缓存 + ACTION_VIEW 交给系统浏览器/查看器
 */
import React, { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native'
import WebView from 'react-native-webview'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { useFileStore } from '../stores/fileStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

export const HtmlPreviewModal: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const file = useFileStore((s) => s.htmlPreviewFile)
  const showSource = useFileStore((s) => s.htmlPreviewSource)
  const close = useFileStore((s) => s.closeHtmlPreview)
  const toggleSource = useFileStore((s) => s.toggleHtmlPreviewSource)

  const [opening, setOpening] = useState(false)

  if (!file) return null

  const fileName = file.path.split(/[/\\]/).pop() || 'preview.html'

  const handleOpenExternal = async () => {
    if (opening) return
    setOpening(true)
    try {
      const cachePath = ReactNativeBlobUtil.fs.dirs.CacheDir + '/' + fileName
      await ReactNativeBlobUtil.fs.writeFile(cachePath, file.content, 'utf8')
      await ReactNativeBlobUtil.android.actionViewIntent(cachePath, 'text/html')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      Alert.alert('无法外部打开', msg)
    } finally {
      setOpening(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>{fileName}</Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.btn} onPress={toggleSource}>
                <Text style={styles.btnText}>{showSource ? '渲染' : '源码'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={handleOpenExternal} disabled={opening}>
                <Text style={styles.btnText}>{opening ? '打开中…' : '↗ 外部打开'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={close} accessibilityLabel="Close preview">
                <Text style={styles.btnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.body}>
            {showSource ? (
              <ScrollView style={styles.sourceScroll} contentContainerStyle={styles.sourceContent}>
                <Text style={styles.sourceText}>{file.content}</Text>
              </ScrollView>
            ) : (
              <WebView
                source={{ html: file.content }}
                originWhitelist={['*']}
                javaScriptEnabled={false}
                style={styles.webview}
              />
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    sheet: {
      height: '90%',
      backgroundColor: colors.background,
      borderTopLeftRadius: 12,
      borderTopRightRadius: 12,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.surfaceVariant,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      marginRight: 8,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    btn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      marginLeft: 4,
    },
    btnText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    body: {
      flex: 1,
    },
    webview: {
      flex: 1,
      backgroundColor: colors.background,
    },
    sourceScroll: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    sourceContent: {
      padding: 12,
    },
    sourceText: {
      color: colors.text,
      fontFamily: 'monospace',
      fontSize: 13,
    },
  })
