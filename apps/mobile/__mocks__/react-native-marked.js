const React = require('react')
const { View, Text } = require('react-native')

function useMarkdown(content) {
  return React.createElement(Text, null, String(content))
}

module.exports = {
  __esModule: true,
  useMarkdown,
  Markdown: ({ content, ...rest }) => useMarkdown(content),
}
