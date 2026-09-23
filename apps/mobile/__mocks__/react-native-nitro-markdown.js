/** react-native-nitro-markdown 的 jest mock（原生模块在 jsdom 环境不可用） */
const appended = []
let resetTo = null

const mockSession = {
  getSession: () => ({ append: (s) => { appended.push(s) } }),
  reset: (t) => { resetTo = t },
}

module.exports = {
  __esModule: true,
  // 组件以字符串形式导出 → react-test-renderer 里可按 type 找到
  MarkdownStream: 'MarkdownStream',
  Markdown: 'Markdown',
  useMarkdownSession: () => mockSession,
  __mock: { appended, get resetTo() { return resetTo }, set resetTo(v) { resetTo = v }, resetAll() { appended.length = 0; resetTo = null } },
}
