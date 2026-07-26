const React = require('react')

const MockMarkdown = (props) => {
  const { children, style, ...rest } = props
  return React.createElement(
    'Markdown',
    { ...rest },
    typeof children === 'string' ? children : null,
  )
}
MockMarkdown.displayName = 'Markdown'

module.exports = {
  __esModule: true,
  default: MockMarkdown,
  Markdown: MockMarkdown,
  getUniqueID: () => 'mock-id',
  openUrl: jest.fn(),
}
