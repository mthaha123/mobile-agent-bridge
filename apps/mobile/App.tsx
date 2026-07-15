import React, { useEffect } from 'react'
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native'
import { AppProvider } from './src/components/AppProvider'
import { ConnectScreen } from './src/screens/ConnectScreen'
import { SessionsScreen } from './src/screens/SessionsScreen'
import { ChatScreen } from './src/screens/ChatScreen'
import { FileBrowserScreen } from './src/screens/FileBrowserScreen'
import { ToolApprovalSheet } from './src/screens/ToolApprovalSheet'
import { QuestionSheet } from './src/screens/QuestionSheet'
import { useAuthStore } from './src/stores/authStore'
import { useUiStore } from './src/stores/uiStore'

const App: React.FC = () => {
  const screen = useUiStore((s) => s.screen)
  const setScreen = useUiStore((s) => s.setScreen)
  const authenticated = useAuthStore((s) => s.authenticated)

  useEffect(() => {
    if (authenticated && screen === 'connect') {
      setScreen('sessions')
    }
  }, [authenticated, screen, setScreen])

  return (
    <AppProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />

        {screen === 'connect' && <ConnectScreen />}
        {screen === 'sessions' && <SessionsScreen />}
        {screen === 'chat' && <ChatScreen />}
        {screen === 'filebrowser' && <FileBrowserScreen />}

        <ToolApprovalSheet />
        <QuestionSheet />
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
