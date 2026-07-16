import React, { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useUiStore, Tab } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { SessionsScreen } from '../screens/SessionsScreen'
import { ChatScreen } from '../screens/ChatScreen'
import { FileBrowserScreen } from '../screens/FileBrowserScreen'
import { SettingsScreen } from '../screens/SettingsScreen'

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: 'chat', icon: '💬', label: 'Chat' },
  { key: 'files', icon: '📁', label: 'Files' },
  { key: 'settings', icon: '⚙️', label: 'Settings' },
]

export const MainLayout: React.FC = () => {
  const activeTab = useUiStore((s) => s.activeTab)
  const chatSubScreen = useUiStore((s) => s.chatSubScreen)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const client = useAuthStore((s) => s.client)

  const [connected, setConnected] = useState(() => client?.connected ?? true)

  useEffect(() => {
    if (!client) return
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
        return <FileBrowserScreen />
      case 'settings':
        return <SettingsScreen />
    }
  }

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
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  banner: {
    backgroundColor: '#c0392b',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  bannerText: {
    color: '#fff',
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
    borderTopColor: '#16213e',
    backgroundColor: '#0f0f23',
    paddingBottom: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: '#16213e',
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
    color: '#888',
  },
  tabLabelActive: {
    color: '#4a9eff',
    fontWeight: '600',
  },
})
