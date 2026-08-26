import React, { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native'
import { useUiStore, Tab } from '../stores/uiStore'
import { useAuthStore } from '../stores/authStore'
import { SessionsScreen } from '../screens/SessionsScreen'
import { ChatScreen } from '../screens/ChatScreen'
import { FileBrowserScreen } from '../screens/FileBrowserScreen'
import { FileViewerScreen } from '../screens/FileViewerScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { useThemeColors } from '../theme/ThemeContext'
import { ThemeColors } from '../theme/colors'

/** Tab bar 总高度（含 padding/border）。供 ChatScreen 计算 iOS 键盘 offset 使用。 */
export const TAB_BAR_HEIGHT = 60

/**
 * 断连横幅延迟显示窗口：回前台秒连通常 <0.5s 恢复，
 * 短暂断连不闪横幅，超过该窗口仍未恢复才提示。
 */
const BANNER_DELAY_MS = 1500

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

  // 横幅防闪烁：断开后延迟 BANNER_DELAY_MS 才显示，恢复即隐藏。
  // 回前台秒连（AppState → reconnectNow）通常在几百毫秒内完成，
  // 横幅不应闪现打扰；只有真正持续断连才提示。
  // 注意：初始值恒为 false——挂载时已断开（冷启动/回前台）同样走延迟窗口。
  const [bannerVisible, setBannerVisible] = useState(false)
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearBannerTimer = () => {
    if (bannerTimerRef.current) {
      clearTimeout(bannerTimerRef.current)
      bannerTimerRef.current = null
    }
  }

  useEffect(() => {
    clearBannerTimer()
    if (!client) {
      // 无 client：维持原行为直接显示断连横幅
      setBannerVisible(true)
      return
    }
    setBannerVisible(false)
    if (!client.connected) {
      bannerTimerRef.current = setTimeout(() => setBannerVisible(true), BANNER_DELAY_MS)
    }
    const offConnected = client.on('connected', () => {
      clearBannerTimer()
      setBannerVisible(false)
    })
    const offDisconnected = client.on('disconnected', () => {
      clearBannerTimer()
      bannerTimerRef.current = setTimeout(() => setBannerVisible(true), BANNER_DELAY_MS)
    })
    return () => {
      clearBannerTimer()
      offConnected()
      offDisconnected()
    }
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
    <SafeAreaView style={styles.root}>
      {bannerVisible && (
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
    </SafeAreaView>
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
