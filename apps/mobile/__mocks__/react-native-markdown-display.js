const React = require('react')
const { View, Text } = require('react-native')

let lastProps = null

const MockMarkdown = (props) => {
  lastProps = props
  const { children, style, ...rest } = props
  return React.createElement(View, { style },
    typeof children === 'string'
      ? React.createElement(Text, null, children)
      : children,
  )
}
MockMarkdown.displayName = 'Markdown'

function getLastProps() {
  return lastProps
}

module.exports = {
  __esModule: true,
  default: MockMarkdown,
  Markdown: MockMarkdown,
  getUniqueID: () => 'mock-id',
  openUrl: jest.fn(),
  __getLastProps: getLastProps,
}
