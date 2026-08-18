import React from 'react'
import TestRenderer from 'react-test-renderer'
import { View } from 'react-native'
import { MarkdownRenderer } from '../src/components/chat/MarkdownRenderer'

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
    expect(textOf(tree.toJSON())).toContain('Hello World')
  })

  it('renders headings', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="# Heading 1\n## Heading 2\n### Heading 3" />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('Heading 1')
    expect(text).toContain('Heading 2')
    expect(text).toContain('Heading 3')
  })

  it('renders code blocks', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />,
    )
    expect(textOf(tree.toJSON())).toContain('const x = 1;')
  })

  it('renders blockquotes', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="> This is a quote" />,
    )
    expect(textOf(tree.toJSON())).toContain('This is a quote')
  })

  it('renders unordered lists', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="- Item 1\n- Item 2\n- Item 3" />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('Item 1')
    expect(text).toContain('Item 2')
    expect(text).toContain('Item 3')
  })

  it('renders ordered lists', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="1. First\n2. Second\n3. Third" />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('First')
    expect(text).toContain('Second')
    expect(text).toContain('Third')
  })

  it('renders horizontal rules', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="---" />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders tables', () => {
    const table = '| Header 1 | Header 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'
    const tree = TestRenderer.create(<MarkdownRenderer content={table} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('Header 1')
    expect(text).toContain('Cell 1')
  })

  it('renders inline code', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="Use `console.log()` for debugging" />,
    )
    expect(textOf(tree.toJSON())).toContain('console.log()')
  })

  it('renders bold text', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="This is **bold** text" />,
    )
    expect(textOf(tree.toJSON())).toContain('bold')
  })

  it('renders italic text', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="This is *italic* text" />,
    )
    expect(textOf(tree.toJSON())).toContain('italic')
  })

  it('renders links', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content="[OpenCode](https://opencode.ai)" />,
    )
    expect(textOf(tree.toJSON())).toContain('OpenCode')
  })

  it('handles empty lines', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="Line 1\n\nLine 2" />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('Line 1')
    expect(text).toContain('Line 2')
  })

  it('renders code block with language label', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```javascript\nconst x = 1;\n```'} />,
    )
    expect(textOf(tree.toJSON())).toContain('const x = 1')
  })

  it('renders code block without language', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content={'```\nhello\n```'} />)
    expect(textOf(tree.toJSON())).toContain('hello')
  })

  it('renders multiple code blocks', () => {
    const tree = TestRenderer.create(
      <MarkdownRenderer content={'```js\na\n```\n\n```python\nb\n```'} />,
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('a')
    expect(text).toContain('b')
  })

  it('renders nested markdown structures', () => {
    const content = `# Title\n\nSome text\n\n- Item 1\n- Item 2\n\n> A quote`
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('Title')
    expect(text).toContain('Some text')
    expect(text).toContain('Item 1')
    expect(text).toContain('A quote')
  })

  it('handles empty string', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="" />)
    expect(textOf(tree.toJSON())).toBe('')
  })

  it('handles only whitespace', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="   \n\n  " />)
    expect(tree.toJSON()).not.toBeNull()
  })

  it('renders heading levels 1-6', () => {
    const mk = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'
    const tree = TestRenderer.create(<MarkdownRenderer content={mk} />)
    const text = textOf(tree.toJSON())
    ;['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].forEach(h => expect(text).toContain(h))
  })

  it('renders long content without crashing', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}: some text here`)
    const content = lines.join('\n')
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    expect(textOf(tree.toJSON())).toContain('Line 50')
    expect(textOf(tree.toJSON())).toContain('Line 100')
  })

  it('renders content with special characters', () => {
    const content = 'Special chars: <>&"\'@#$%^()'
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    expect(textOf(tree.toJSON())).toContain('Special chars:')
  })

  it('renders mixed inline formatting without crashing', () => {
    const content = '**bold** *italic* `code` and [link](https://x.com) all together'
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('bold')
    expect(text).toContain('italic')
  })

  it('renders consecutive similar blocks', () => {
    const content = '```js\nconst a = 1\n```\n```js\nconst b = 2\n```'
    const tree = TestRenderer.create(<MarkdownRenderer content={content} />)
    const text = textOf(tree.toJSON())
    expect(text).toContain('const a = 1')
    expect(text).toContain('const b = 2')
  })

  it('renders heading with no space after #', () => {
    const tree = TestRenderer.create(<MarkdownRenderer content="#Heading" />)
    const text = textOf(tree.toJSON())
    expect(text).not.toBe('')
  })
})
