import React from 'react'
import { View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

interface ClampBoxProps {
  /** 最大高度（超出即裁剪） */
  maxHeight: number
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}

/**
 * 限高裁剪容器 —— 刻意不提供滚动。
 *
 * 背景：ToolGroupCard 一级展开原本内嵌纵向 ScrollView，在 inverted FlatList 中
 * 过滚动时父列表方向反转（RN #29776），并与列表争夺纵向手势。这里只做裁剪：
 * 要看完整内容走 ToolDetailSheet（Modal，唯一纵向滚动所有者）。
 *
 * 约定（见 docs/plans/2026-09-12-chat-scroll-ownership-design.md）：
 * cell 内不得出现纵向 ScrollView；纵向滚动只归列表页 / Modal。
 */
export const ClampBox: React.FC<ClampBoxProps> = ({ maxHeight, children, style, testID }) => (
  <View style={[{ maxHeight, overflow: 'hidden' }, style]} testID={testID}>
    {children}
  </View>
)
