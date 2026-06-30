/**
 * Mobile Agent Bridge — App 入口
 *
 * 页面导航：ConnectScreen → SessionsScreen → ChatScreen
 * ToolApprovalSheet 覆盖在所有页面上层
 */
import React, { useState, useEffect, useCallback } from 'react'
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native'
import { AppProvider } from './src/components/AppProvider'
import { ConnectScreen } from './src/screens/ConnectScreen'
import { SessionsScreen } from './src/screens/SessionsScreen'
import { ChatScreen } from './src/screens/ChatScreen'
import { ToolApprovalSheet } from './src/screens/ToolApprovalSheet'
import { useAuthStore } from './src/stores/authStore'
import { useChatStore } from './src/stores/chatStore'

type Screen = 'connect' | 'sessions' | 'chat'

const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('connect')
  const authenticated = useAuthStore((s) => s.authenticated)

  // 登录成功后自动跳到会话列表
  useEffect(() => {
    if (authenticated && screen === 'connect') {
      setScreen('sessions')
    }
  }, [authenticated, screen])

  const handleNavigateToChat = useCallback((sessionId: string) => {
    useChatStore.getState().setActiveSession(sessionId)
    setScreen('chat')
  }, [])

  const handleBackToConnect = useCallback(() => {
    useAuthStore.getState().logout()
    setScreen('connect')
  }, [])

  const handleNavigateToSessions = useCallback(() => {
    setScreen('sessions')
  }, [])

  return (
    <AppProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />

        {screen === 'connect' && <ConnectScreen />}

        {screen === 'sessions' && (
          <SessionsScreen
            onNavigateToChat={handleNavigateToChat}
            onBack={handleBackToConnect}
          />
        )}

        {screen === 'chat' && (
          <ChatScreen onNavigateToSessions={handleNavigateToSessions} />
        )}

        <ToolApprovalSheet />
      </SafeAreaView>
    </AppProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
})

export default App
