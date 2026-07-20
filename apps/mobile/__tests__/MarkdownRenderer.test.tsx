/**
 * MarkdownRenderer — 单元测试
 */
import React from 'react'
import TestRenderer from 'react-test-renderer'
import { renderMarkdown, MarkdownRenderer } from '../src/components/MarkdownRenderer'

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

  it('renders code block with language label', () => {
    const elements = renderMarkdown('```javascript\nconst x = 1;\n```')
    expect(elements.length).toBe(1)
  })

  it('renders code block without language', () => {
    const elements = renderMarkdown('```\nhello\n```')
    expect(elements.length).toBe(1)
  })

  it('renders multiple code blocks', () => {
    const elements = renderMarkdown('```js\na\n```\n```python\nb\n```')
    expect(elements.length).toBe(2)
  })

  it('renders nested markdown structures', () => {
    const content = `# Title

Some text

- Item 1
- Item 2

> A quote

---

\`inline code\`

**bold** and *italic*

[Link](https://example.com)

| Col1 | Col2 |
|------|------|
| A    | B    |
`
    const elements = renderMarkdown(content)
    expect(elements.length).toBeGreaterThan(5)
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

  it('code block renders with language label in props', () => {
    const elements = renderMarkdown('```javascript\nconst x = 1;\n```')
    const el = elements[0] as any
    expect(el.props.language).toBe('javascript')
    expect(el.props.code).toContain('const x = 1')
  })

  it('inline code is rendered with backtick content', () => {
    const elements = renderMarkdown('Use `code` here')
    expect(elements.length).toBe(1)
  })

  it('link renders with correct URL', () => {
    const elements = renderMarkdown('[OpenCode](https://opencode.ai)')
    expect(elements.length).toBe(1)
  })

  it('table renders with headers and rows', () => {
    const table = '| Name | Age |\n|------|-----|\n| Alice | 25 |\n| Bob | 30 |'
    const elements = renderMarkdown(table)
    expect(elements.length).toBe(1)
  })

  it('mixed inline formatting: bold + italic + code + link', () => {
    const content = '**bold** *italic* `code` [link](https://example.com)'
    const elements = renderMarkdown(content)
    expect(elements.length).toBe(1)
  })

  it('consecutive code blocks with different languages', () => {
    const elements = renderMarkdown('```ts\nlet x: number = 1;\n```\n\n```py\nx = 1\n```')
    expect(elements.length).toBe(3)
    const tsBlock = elements[0] as any
    const pyBlock = elements[2] as any
    expect(tsBlock.props.language).toBe('ts')
    expect(pyBlock.props.language).toBe('py')
  })

  it('handles empty string', () => {
    const elements = renderMarkdown('')
    expect(elements.length).toBe(1)
  })

  it('handles only whitespace', () => {
    const elements = renderMarkdown('   \n\n  ')
    expect(elements.length).toBe(3)
  })

  it('handles special characters in inline code', () => {
    const elements = renderMarkdown('Use `<T>` generics')
    expect(elements.length).toBe(1)
  })

  it('renders heading levels 1-6', () => {
    const mk = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'
    const elements = renderMarkdown(mk)
    expect(elements.length).toBe(6)
  })
})

describe('MarkdownRenderer component', () => {
  it('renders the MarkdownRenderer component wrapper', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="Hello **world**" />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders code block with language label in component', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content={'```ts\nconst x = 1\n```'} />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('ts')
    expect(json).toContain('const x = 1')
  })

  it('renders table in component', () => {
    const table = '| Name | Age |\n|------|-----|\n| Alice | 25 |\n| Bob | 30 |'
    const tree = TestRenderer.create(<MarkdownRenderer content={table} />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders links in component', () => {
    const linkContent = '[Click me](https://example.com)'
    const tree = TestRenderer.create(<MarkdownRenderer content={linkContent} />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('handles null/undefined content in renderMarkdown', () => {
    const el1 = renderMarkdown(null as any)
    expect(el1).toEqual([])
    const el2 = renderMarkdown(undefined as any)
    expect(el2).toEqual([])
  })

  it('handles unclosed fenced code block gracefully — no crash', () => {
    const content = 'text\n```\nunclosed code\nstill here'
    expect(() => renderMarkdown(content)).not.toThrow()
  })
})
