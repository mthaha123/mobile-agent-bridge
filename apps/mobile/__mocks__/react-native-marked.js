const React = require('react')
const { View, Text } = require('react-native')

function useMarkdown(content) {
  return React.createElement(Text, null, String(content))
}

/** 测试环境的 Renderer 桩：MarkdownRenderer 会继承并覆写 table() */
class Renderer {
  table() {
    return null
  }

  getKey() {
    return 'mock-marked-key'
  }
}

module.exports = {
  __esModule: true,
  useMarkdown,
  Renderer,
  Markdown: ({ content, ...rest }) => useMarkdown(content),
}
