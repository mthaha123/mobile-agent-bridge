import React, { useCallback, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { TextStyle, ViewStyle } from 'react-native'

interface MarkdownCodeBlockProps {
  /** 代码块纯文本（react-native-marked Renderer.code 的 text 参数） */
  text: string
  /** 代码块容器样式（来自 markdown 主题，透传给 contentContainerStyle） */
  containerStyle?: ViewStyle
  /** 代码文本样式（来自 markdown 主题，透传给 Text） */
  textStyle?: TextStyle
}

/**
 * 代码块渲染组件（替代 react-native-marked 内置 code() 的默认实现）。
 *
 * 内置实现只包了横向 ScrollView，缺两个 Android 嵌套滚动的关键点：
 * 1. 未开 nestedScrollEnabled → 横向拖动常被外层 inverted FlatList 抢走，
 *    代码块溢出却滑不动（与 MarkdownTable 修复前同源的手势协商问题）；
 * 2. 无论内容是否超宽都显示横向滚动条。
 *
 * 本组件沿用 MarkdownTable 已验证的标准做法（横向 ScrollView 体系）：
 * - horizontal ScrollView + nestedScrollEnabled（RN 官方 Android 嵌套滚动机制）；
 * - 仅当内容实测宽度超出容器时显示横向滚动指示条；
 * - 代码文本包一层 View（避免 "Cannot add a child that doesn't have a YogaNode"
 *   错误，与库默认实现一致）。
 */
export const MarkdownCodeBlock: React.FC<MarkdownCodeBlockProps> = ({
  text,
  containerStyle,
  textStyle,
}) => {
  const [containerWidth, setContainerWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width
    if (w > 0) setContainerWidth(w)
  }, [])
  const onContentSizeChange = useCallback((w: number) => {
    if (w > 0) setContentWidth(w)
  }, [])
  const overflow = containerWidth > 0 && contentWidth > containerWidth + 1

  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={overflow}
      onLayout={onLayout}
      onContentSizeChange={onContentSizeChange}
      contentContainerStyle={containerStyle}
      testID="md-code-block"
    >
      {/* 包一层 View 避免 "Cannot add a child that doesn't have a YogaNode..." 错误 */}
      <View>
        <Text selectable style={textStyle}>
          {text}
        </Text>
      </View>
    </ScrollView>
  )
}
