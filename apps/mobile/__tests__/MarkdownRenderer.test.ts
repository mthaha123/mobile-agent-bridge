/**
 * MarkdownRenderer — 单元测试
 */
import { renderMarkdown } from '../src/components/MarkdownRenderer'

describe('MarkdownRenderer', () => {
  it('should render plain text', () => {
    const elements = renderMarkdown('Hello World')
    expect(elements.length).toBe(1)
  })

  it('should render headings', () => {
    const elements = renderMarkdown('# Heading 1\n## Heading 2\n### Heading 3')
    expect(elements.length).toBe(3)
  })

  it('should render code blocks', () => {
    const elements = renderMarkdown('```javascript\nconst x = 1;\n```')
    expect(elements.length).toBe(1)
  })

  it('should render blockquotes', () => {
    const elements = renderMarkdown('> This is a quote')
    expect(elements.length).toBe(1)
  })

  it('should render unordered lists', () => {
    const elements = renderMarkdown('- Item 1\n- Item 2\n- Item 3')
    expect(elements.length).toBe(1)
  })

  it('should render ordered lists', () => {
    const elements = renderMarkdown('1. First\n2. Second\n3. Third')
    expect(elements.length).toBe(1)
  })

  it('should render horizontal rules', () => {
    const elements = renderMarkdown('---')
    expect(elements.length).toBe(1)
  })

  it('should render tables', () => {
    const table = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'
    const elements = renderMarkdown(table)
    expect(elements.length).toBe(1)
  })

  it('should render inline code', () => {
    const elements = renderMarkdown('Use `console.log()` for debugging')
    expect(elements.length).toBe(1)
  })

  it('should render bold text', () => {
    const elements = renderMarkdown('This is **bold** text')
    expect(elements.length).toBe(1)
  })

  it('should render italic text', () => {
    const elements = renderMarkdown('This is *italic* text')
    expect(elements.length).toBe(1)
  })

  it('should render links', () => {
    const elements = renderMarkdown('[Google](https://google.com)')
    expect(elements.length).toBe(1)
  })

  it('should handle empty lines', () => {
    const elements = renderMarkdown('Line 1\n\nLine 2')
    expect(elements.length).toBe(3) // Line 1, paragraph, Line 2
  })

  it('should handle mixed content', () => {
    const content = `# Title

Some text with **bold** and *italic*.

\`\`\`javascript
const x = 1;
\`\`\`

- List item 1
- List item 2

> Blockquote

---

[Link](https://example.com)`

    const elements = renderMarkdown(content)
    expect(elements.length).toBeGreaterThan(5)
  })
})
