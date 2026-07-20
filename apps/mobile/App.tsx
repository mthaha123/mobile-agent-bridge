import React, { useEffect } from 'react'
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native'
import { AppProvider } from './src/components/AppProvider'
import { MainLayout } from './src/components/MainLayout'
import { ConnectScreen } from './src/screens/ConnectScreen'
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
      setScreen('main')
    } else if (!authenticated && screen === 'main') {
      setScreen('connect')
    }
  }, [authenticated, screen, setScreen])

  return (
    <AppProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />

        {screen === 'connect' && <ConnectScreen />}
        {screen === 'main' && <MainLayout />}

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
