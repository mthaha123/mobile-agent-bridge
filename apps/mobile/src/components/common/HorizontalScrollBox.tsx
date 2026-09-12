import React, { useCallback, useState } from 'react'
import { ScrollView } from 'react-native'
import type { ViewStyle } from 'react-native'

interface HorizontalScrollBoxProps {
  children: React.ReactNode
  /**
   * 是否允许显示横向滚动指示条。
   * - true（默认）：内部按实测内容宽度自动判断，仅溢出时显示
   * - false：完全不显示（调用方自行管理，如代码块的 Copy 覆盖层）
   */
  showsIndicator?: boolean
  contentContainerStyle?: ViewStyle
  testID?: string
  /** 供调用方获取容器宽度 / 溢出状态（可选） */
  onLayoutWidth?: (width: number) => void
  onOverflowChange?: (overflow: boolean) => void
}

/**
 * 横向滚动统一容器（聊天 / 文件查看的所有横向内容）。
 *
 * 背景：Android 嵌套滚动要求父子都参与（child 是 NestedScrollingChild，
 * parent 是 NestedScrollingParent）。此前横向内容各自实现，部分漏加
 * `nestedScrollEnabled`，且父 FlatList 的 `nestedScrollEnabled` 也被移除，
 * 导致横向拖拽被父纵向列表吞掉 —— 表现为“只能上下滑、不能左右滑”。
 *
 * 约定：所有横向滚动一律走本组件；父列表（MessageList）必须保留
 * `nestedScrollEnabled`，嵌套滚动才会真正生效。
 */
export const HorizontalScrollBox: React.FC<HorizontalScrollBoxProps> = ({
  children,
  showsIndicator = true,
  contentContainerStyle,
  testID,
  onLayoutWidth,
  onOverflowChange,
}) => {
  const [containerWidth, setContainerWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)

  const overflow = containerWidth > 0 && contentWidth > containerWidth + 1

  const handleLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number } } }) => {
      const w = e.nativeEvent.layout.width
      if (w > 0) {
        setContainerWidth(w)
        onLayoutWidth?.(w)
      }
    },
    [onLayoutWidth],
  )

  const handleContentSizeChange = useCallback(
    (w: number) => {
      if (w > 0) {
        setContentWidth(w)
        onOverflowChange?.(containerWidth > 0 && w > containerWidth + 1)
      }
    },
    [containerWidth, onOverflowChange],
  )

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      directionalLockEnabled
      showsHorizontalScrollIndicator={showsIndicator && overflow}
      contentContainerStyle={contentContainerStyle}
      onLayout={handleLayout}
      onContentSizeChange={handleContentSizeChange}
      testID={testID}
    >
      {children}
    </ScrollView>
  )
}
