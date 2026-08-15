import React, { useEffect } from 'react'
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native'
import { AppProvider } from './src/components/AppProvider'
import { MainLayout } from './src/components/MainLayout'
import { ConnectScreen } from './src/screens/ConnectScreen'

import { useAuthStore } from './src/stores/authStore'
import { useUiStore } from './src/stores/uiStore'
import { ThemeProvider, useThemeColors, useThemeMode } from './src/theme/ThemeContext'

const AppContent: React.FC = () => {
  const screen = useUiStore((s) => s.screen)
  const setScreen = useUiStore((s) => s.setScreen)
  const authenticated = useAuthStore((s) => s.authenticated)
  const colors = useThemeColors()
  const mode = useThemeMode()

  useEffect(() => {
    if (authenticated && screen === 'connect') {
      setScreen('main')
    } else if (!authenticated && screen === 'main') {
      setScreen('connect')
    }
  }, [authenticated, screen, setScreen])

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={mode === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.background} />

      {screen === 'connect' && <ConnectScreen />}
      {screen === 'main' && <MainLayout />}

    </SafeAreaView>
  )
}

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
})

export default App
