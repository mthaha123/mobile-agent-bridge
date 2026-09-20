/**
 * ConnectScreen — 连接 Bridge 服务器的登录界面
 *
 * 用户输入 WebSocket URL 和可选密码，连接至 OpenCode Agent。
 * 读取 useAuthStore 管理连接状态。
 *
 * 连接必须由用户显式触发（无默认登录）：
 * 此前挂载后会拿硬编码的 `ws://10.0.2.2:8080/ws` + `test123` 自动登录，
 * 联调时极易误连到生产地址；现已移除该行为。
 * 输入框从 settingsStore 回填「上次真正用过的连接参数」（从未填过则为空），
 * 点 Connect 时把本次输入存盘，下次启动直接可用。
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
import { useSettingsStore } from '../stores/settingsStore'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

export const ConnectScreen: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const [urlInput, setUrlInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [directoryInput, setDirectoryInput] = useState('')
  const hydrated = useRef(false)

  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const settingsLoaded = useSettingsStore((s) => s.loaded)

  // 用磁盘上「上次真正用过的连接参数」回填输入框
  // （只回填一次，不覆盖用户正在输入的内容；从未连过则保持为空）
  useEffect(() => {
    if (!settingsLoaded || hydrated.current) return
    hydrated.current = true
    const saved = useSettingsStore.getState()
    if (saved.bridgeUrl) setUrlInput(saved.bridgeUrl)
    if (saved.bridgePassword) setPasswordInput(saved.bridgePassword)
    if (saved.projectDirectory) setDirectoryInput(saved.projectDirectory)
  }, [settingsLoaded])

  const handleConnect = () => {
    useAuthStore.getState().setBridgeUrl(urlInput)
    useProjectStore.getState().setDirectory(directoryInput)
    // 记住本次连接参数：下次启动回填（避免退回默认地址误连）
    void useSettingsStore.getState().saveConnection({
      url: urlInput,
      password: passwordInput,
      directory: directoryInput,
    })
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
