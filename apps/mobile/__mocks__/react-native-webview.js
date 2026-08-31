/**
 * Auto-mock for react-native-webview — renders as a simple View in tests.
 * 验证 source.html 内容通过 props 传递即可。
 */
const React = require('react')

function WebView(props) {
  return React.createElement('WebView', {
    testID: 'webview',
    source: props.source,
    ...props,
  })
}

module.exports = { __esModule: true, default: WebView }
