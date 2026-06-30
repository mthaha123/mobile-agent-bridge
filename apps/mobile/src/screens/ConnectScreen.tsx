/**
 * ConnectScreen — 连接 Bridge 服务器的登录界面
 *
 * 用户输入 WebSocket URL 和可选密码，连接至 OpenCode Agent。
 * 读取 useAuthStore 管理连接状态。
 */
import React, { useState } from 'react'
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

export const ConnectScreen: React.FC = () => {
  const [urlInput, setUrlInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [directoryInput, setDirectoryInput] = useState('')

  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)

  const handleConnect = () => {
    useAuthStore.getState().setBridgeUrl(urlInput)
    useAuthStore.getState().setDirectory(directoryInput)
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
            placeholderTextColor="#555"
            value={urlInput}
            onChangeText={setUrlInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            style={styles.input}
            placeholder="password (optional)"
            placeholderTextColor="#555"
            value={passwordInput}
            onChangeText={setPasswordInput}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder="project directory (e.g. /home/user/project)"
            placeholderTextColor="#555"
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#eee',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#999',
    textAlign: 'center',
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 20,
  },
  input: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#eee',
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
    color: '#eee',
    fontSize: 16,
    fontWeight: '600',
  },
})
