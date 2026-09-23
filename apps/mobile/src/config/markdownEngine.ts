/**
 * Markdown 渲染引擎开关（M0 决策后翻转，见设计文档 §6）。
 * legacy = react-native-marked 冻结块三连优化（现网）
 * native = react-native-nitro-markdown（原生 C++ 解析 + session 增量流式）
 */
export type MarkdownEngine = 'legacy' | 'native'

export const MARKDOWN_ENGINE: MarkdownEngine = 'legacy'
