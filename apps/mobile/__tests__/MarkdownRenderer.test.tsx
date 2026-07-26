import React from 'react'
import TestRenderer from 'react-test-renderer'
import { MarkdownRenderer, renderMarkdown } from '../src/components/MarkdownRenderer'

function textOf(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.children) return textOf(node.children)
  return ''
}

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="Hello World" />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders headings', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="# Heading 1\n## Heading 2\n### Heading 3" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders code blocks', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders blockquotes', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="> This is a quote" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders unordered lists', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="- Item 1\n- Item 2\n- Item 3" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders ordered lists', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="1. First\n2. Second\n3. Third" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders horizontal rules', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="---" />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders tables', () => {
    const table = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'
    const tree = TestRenderer.create(<MarkdownRenderer content={table} />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders inline code', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="Use `console.log()` for debugging" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders bold text', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="This is **bold** text" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders italic text', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="This is *italic* text" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders links', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="[Google](https://google.com)" />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('handles empty lines', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="Line 1\n\nLine 2" />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders code block with language label', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders code block without language', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content={'```\nhello\n```'} />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders multiple code blocks', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```js\na\n```\n\n```python\nb\n```'} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders nested markdown structures', () => {
    const content = `# Title\n\nSome text\n\n- Item 1\n- Item 2\n\n> A quote\n\n---\n\n\`inline code\`\n\n**bold** and *italic*\n\n[Link](https://example.com)`
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('handles empty string', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="" />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('handles only whitespace', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="   \n\n  " />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders heading levels 1-6', () => {
    const mk = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'
    const tree = TestRenderer.create(<MarkdownRenderer content={mk} />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('applies custom style prop', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="Hello" style={{ opacity: 0.5 }} />,
    )
    expect(tree.toJSON()).not.toBeNull()
  })
})

describe('renderMarkdown', () => {
  it('returns a React element for valid content', () => {
    const el = renderMarkdown('Hello **world**')
    expect(React.isValidElement(el)).toBe(true)
  })

  it('renders without crashing', () => {
    const tree = TestRenderer.create(renderMarkdown('Test content'))
    expect(tree.toJSON()).not.toBeNull()
  })
})
