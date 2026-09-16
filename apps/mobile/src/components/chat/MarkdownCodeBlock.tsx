import React from 'react'
import { Clipboard, Text, View } from 'react-native'
import type { TextStyle, ViewStyle } from 'react-native'
import { AppPressable } from '../common/AppPressable'
import { HorizontalScrollBox } from '../common/HorizontalScrollBox'
import { useThemeColors } from '../../theme/ThemeContext'

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
 * 历史问题与对策：
 * 1. 未开 nestedScrollEnabled → 横向拖动被外层 inverted FlatList 抢走
 *    （已修：horizontal ScrollView + nestedScrollEnabled，对齐 MarkdownTable 标准方案）
 * 2. 文本 selectable → Android 原生文本选择手势参与触摸分发，
 *    与横向 pan 竞争导致"滑动很难触发"（对照组：同环境的 MarkdownTable
 *    单元格不可选中、滑动正常）。已移除 selectable，复制能力改由右上角
 *    Copy 按钮显式提供。
 * 3. 仅当内容实测超宽时显示横向滚动指示条。
 */
export const MarkdownCodeBlock: React.FC<MarkdownCodeBlockProps> = ({
  text,
  containerStyle,
  textStyle,
}) => {
  const colors = useThemeColors()

  return (
    <View>
      <HorizontalScrollBox
        contentContainerStyle={containerStyle}
        testID="md-code-block"
      >
        {/* 包一层 View 避免 "Cannot add a child that doesn't have a YogaNode..." 错误 */}
        <View>
          {/* selectable 会挂载 Android 文本选择手势、抢横向 pan —— 保持 false */}
          <Text selectable={false} style={textStyle}>
            {text}
          </Text>
        </View>
      </HorizontalScrollBox>
      <AppPressable
        style={[styles.copyBtn, { backgroundColor: colors.surfaceVariant }]}
        onPress={() => { Clipboard.setString(text) }}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        testID="md-code-copy"
      >
        <Text style={[styles.copyText, { color: colors.textSecondary }]}>Copy</Text>
      </AppPressable>
    </View>
  )
}

const styles = {
  copyBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  } as ViewStyle,
  copyText: {
    fontSize: 11,
    fontWeight: '600',
  } as TextStyle,
}
