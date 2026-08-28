/**
 * ConnectScreen — 连接 Bridge 服务器的登录界面
 *
 * 用户输入 WebSocket URL 和可选密码，连接至 OpenCode Agent。
 * 读取 useAuthStore 管理连接状态。
 */
import React, { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useAuthStore } from '../stores/authStore'
import { useProjectStore } from '../stores/projectStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

const DEFAULT_URL = 'ws://10.0.2.2:8080/ws'
const DEFAULT_PASSWORD = 'test123'
/** 自动登录使用较短的连接超时（秒），避免用户长时间等待不可达的地址 */
const AUTO_CONNECT_TIMEOUT_MS = 5000

export const ConnectScreen: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [urlInput, setUrlInput] = useState(DEFAULT_URL)
  const [passwordInput, setPasswordInput] = useState(DEFAULT_PASSWORD)
  const [directoryInput, setDirectoryInput] = useState('')
  const autoConnectDone = useRef(false)

  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)

  // Auto-connect with defaults on first mount (for dev/testing convenience)
  useEffect(() => {
    if (autoConnectDone.current) return
    autoConnectDone.current = true
    const timer = setTimeout(async () => {
      useAuthStore.getState().setBridgeUrl(DEFAULT_URL)
      useProjectStore.getState().setDirectory('')
      try {
        await useAuthStore.getState().login(DEFAULT_PASSWORD, AUTO_CONNECT_TIMEOUT_MS)
      } catch {
        // login() 内部已处理错误，此处仅防止未捕获异常
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  const handleConnect = () => {
    useAuthStore.getState().setBridgeUrl(urlInput)
    useProjectStore.getState().setDirectory(directoryInput)
    useAuthStore.getState().login(passwordInput || undefined)
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Mobile Agent Bridge</Text>
        <Text style={styles.subtitle}>Connect to your OpenCode agent</Text>

        <View style={styles.card}>
          <TextInput
            style={styles.input}
            placeholder="ws://192.168.1.100:8080/ws"
            placeholderTextColor={colors.textTertiary}
            value={urlInput}
            onChangeText={setUrlInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            style={styles.input}
            placeholder="password (optional)"
            placeholderTextColor={colors.textTertiary}
            value={passwordInput}
            onChangeText={setPasswordInput}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder="project directory (e.g. /home/user/project)"
            placeholderTextColor={colors.textTertiary}
            value={directoryInput}
            onChangeText={setDirectoryInput}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleConnect}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#eee" />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: 32,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
  },
  input: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    marginBottom: 12,
  },
  error: {
    color: '#e94560',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#e94560',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.textOnPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
})
