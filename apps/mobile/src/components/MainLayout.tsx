import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useUiStore, Tab } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { SessionsScreen } from '../screens/SessionsScreen'
import { ChatScreen } from '../screens/ChatScreen'
import { FileBrowserScreen } from '../screens/FileBrowserScreen'
import { FileViewerScreen } from '../screens/FileViewerScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'chat', icon: '💬', label: 'Chat' },
  { key: 'files', icon: '📁', label: 'Files' },
  { key: 'settings', icon: '⚙️', label: 'Settings' },
]

export const MainLayout: React.FC = () => {
  const colors = useThemeColors()
  const styles = makeStyles(colors)
  const activeTab = useUiStore((s) => s.activeTab)
  const chatSubScreen = useUiStore((s) => s.chatSubScreen)
  const filesSubScreen = useUiStore((s) => s.filesSubScreen)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const client = useAuthStore((s) => s.client)

  const [connected, setConnected] = useState(() => client?.connected ?? false)

  useEffect(() => {
    if (!client) {
      setConnected(false)
      return
    }
    setConnected(client.connected)
    const offConnected = client.on('connected', () => setConnected(true))
    const offDisconnected = client.on('disconnected', () => setConnected(false))
    return () => { offConnected(); offDisconnected() }
  }, [client])

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return chatSubScreen === 'sessions' ? <SessionsScreen /> : <ChatScreen />
      case 'files':
        return filesSubScreen === 'viewer' ? <FileViewerScreen /> : <FileBrowserScreen />
      case 'settings':
        return <SettingsScreen />
      default:
        return <SessionsScreen />
    }
  }

  // 全屏查看器：隐藏底部 tab bar
  const isFullscreenViewer = activeTab === 'files' && filesSubScreen === 'viewer'

  return (
    <View style={styles.root}>
      {!connected && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>⚠️ Connection lost — reconnecting…</Text>
        </View>
      )}

      <View style={styles.content}>
        {renderContent()}
      </View>

      {!isFullscreenViewer && (
        <View style={styles.tabBar}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, activeTab === t.key && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
            >
              <Text style={[styles.tabIcon, activeTab === t.key && styles.tabIconActive]}>
                {t.icon}
              </Text>
              <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  )
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    banner: {
      backgroundColor: colors.errorBg,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    bannerText: {
      color: colors.textOnPrimary,
      fontSize: 13,
      fontWeight: '500',
      textAlign: 'center',
    },
    content: {
      flex: 1,
    },
    tabBar: {
      flexDirection: 'row',
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.tabBar,
      paddingBottom: 4,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
    },
    tabActive: {
      backgroundColor: colors.surface,
    },
    tabIcon: {
      fontSize: 20,
      marginBottom: 2,
    },
    tabIconActive: {
      fontSize: 22,
    },
    tabLabel: {
      fontSize: 11,
      color: colors.textTertiary,
    },
    tabLabelActive: {
      color: colors.primary,
      fontWeight: '600',
    },
  })
