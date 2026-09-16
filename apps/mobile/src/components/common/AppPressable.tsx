import React from 'react'
import { Pressable, type PressableProps } from 'react-native'

/**
 * 列表内统一点击原语。
 *
 * 历史背景：RN 新架构下 core Touchable/Pressability 在 inverted FlatList
 * + transform 场景会误判 LEAVE_PRESS_RECT（"划得动、点不动"），
 * 需要 RNGH 绕开。P3 已去除 inverted，该根因消除，
 * 回退到核心 Pressable 保持简洁。
 *
 * 约定：所有 MessageList cell 内的可点击元素一律用 AppPressable，
 * 保留统一的替换入口以便未来需要时可一键切回 RNGH。
 */
export const AppPressable: React.FC<PressableProps> = (props) => (
  <Pressable {...props} />
)
