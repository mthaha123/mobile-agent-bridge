/**
 * ToolRenderer — 单元测试 (react-test-renderer)
 *
 * ToolRenderer 是 Phase 1+2 重构后的紧凑型工具进度卡片（用于 ToolProgressCard），
 * 通过 getToolInfo() 渲染 图标 + 标题 + 副标题 + 状态图标，
 * 对 shell/bash 使用 ShellOutput，对 edit 使用 DiffDisplay，其余展示 result 预览。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ToolRenderer } from '../src/components/ToolRenderer'
import { ToolCallProgress } from '../src/stores/toolProgressStore'

const createMockCall = (overrides: Partial<ToolCallProgress> = {}): ToolCallProgress => ({
  callID: 'test-call-1',
  sessionId: 'test-session',
  tool: 'bash',
  input: {},
  status: 'called',
  startedAt: Date.now(),
  ...overrides,
})

function toJson(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON())
}

function textOf(tree: TestRenderer.ReactTestInstance): string {
  let result = ''
  try {
    const json = tree.toJSON() as any
    const walk = (node: any) => {
      if (!node) return
      if (typeof node === 'string') { result += node; return }
      if (typeof node === 'number') { result += node; return }
      if (node.children) node.children.forEach(walk)
    }
    walk(json)
  } catch {}
  return result
}

describe('ToolRenderer', () => {
  it('renders Shell tool correctly', () => {
    const call = createMockCall({ tool: 'bash', input: { command: 'ls -la' } })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Shell')
    expect(json).toContain('ls -la')
  })

  it('renders Read tool correctly', () => {
    const call = createMockCall({
      tool: 'read',
      input: { path: '/test.txt' },
      result: 'Hello World',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Read')
    expect(json).toContain('/test.txt')
    expect(json).toContain('Hello World')
  })

  it('renders Write tool correctly', () => {
    const call = createMockCall({
      tool: 'write',
      input: { path: '/test.txt', content: 'New content' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Write')
    expect(json).toContain('/test.txt')
  })

  it('renders Edit tool correctly', () => {
    const call = createMockCall({
      tool: 'edit',
      input: { path: '/test.txt', oldString: 'old', newString: 'new' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Edit')
    expect(json).toContain('/test.txt')
    expect(json).toContain('old')
    expect(json).toContain('new')
  })

  it('renders Glob tool correctly', () => {
    const call = createMockCall({ tool: 'glob', input: { pattern: '**/*.ts' } })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Glob')
    expect(json).toContain('**/*.ts')
  })

  it('renders Grep tool correctly', () => {
    const call = createMockCall({ tool: 'grep', input: { query: 'import' } })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Grep')
    expect(json).toContain('import')
  })

  it('renders WebFetch tool correctly', () => {
    const call = createMockCall({
      tool: 'webfetch',
      input: { url: 'https://example.com' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Web Fetch')
    expect(json).toContain('https://example.com')
  })

  it('renders WebSearch tool correctly', () => {
    const call = createMockCall({
      tool: 'websearch',
      input: { query: 'test query' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Web Search')
    expect(json).toContain('test query')
  })

  it('renders Task tool correctly', () => {
    const call = createMockCall({
      tool: 'task',
      input: { description: 'Test task description' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Agent')
    expect(json).toContain('Test task description')
  })

  it('renders Question tool correctly', () => {
    const call = createMockCall({
      tool: 'question',
      input: { question: 'What is your name?' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Questions')
  })

  it('renders Skill tool correctly', () => {
    const call = createMockCall({
      tool: 'skill',
      input: { name: 'test-skill' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Skill')
  })

  it('renders TodoWrite tool correctly', () => {
    const call = createMockCall({
      tool: 'todowrite',
      input: { todos: [{ content: 'Test todo' }] },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Todos')
  })

  it('renders unknown tool correctly', () => {
    const call = createMockCall({
      tool: 'unknown-tool',
      input: { someParam: 'value' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('unknown-tool')
  })

  it('shows success status icon', () => {
    const call = createMockCall({
      tool: 'bash',
      input: { command: 'ls' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('✅')
  })

  it('shows failed status icon', () => {
    const call = createMockCall({
      tool: 'bash',
      input: { command: 'ls' },
      status: 'failed',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('❌')
  })

  it('shows loading status icon', () => {
    const call = createMockCall({
      tool: 'bash',
      input: { command: 'ls' },
      status: 'called',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('⏳')
  })

  it('shell shows command and output line count', () => {
    const call = createMockCall({
      tool: 'bash',
      input: { command: 'ls -la' },
      status: 'success',
      result: 'file1.txt\nfile2.txt',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('$ ls -la')
    expect(textOf(tree)).toContain('file1.txt')
    expect(textOf(tree)).toContain('file2.txt')
    expect(textOf(tree)).toContain('2 lines')
  })

  it('shell command shows $ prefix', () => {
    const call = createMockCall({
      tool: 'bash',
      input: { command: 'echo hello' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('$ echo hello')
  })

  it('edit renderer shows diff with old and new strings', () => {
    const call = createMockCall({
      tool: 'edit',
      input: { path: 'file.ts', oldString: 'old code', newString: 'new code' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('Edit')
    expect(textOf(tree)).toContain('file.ts')
    expect(textOf(tree)).toContain('old code')
    expect(textOf(tree)).toContain('new code')
  })

  it('glob renderer shows pattern', () => {
    const call = createMockCall({
      tool: 'glob',
      input: { pattern: '**/*.ts' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('**/*.ts')
  })

  it('grep renderer shows query', () => {
    const call = createMockCall({
      tool: 'grep',
      input: { query: 'import' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('import')
  })

  it('webfetch renderer shows URL', () => {
    const call = createMockCall({
      tool: 'webfetch',
      input: { url: 'https://example.com' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('https://example.com')
  })

  it('websearch renderer shows query', () => {
    const call = createMockCall({
      tool: 'websearch',
      input: { query: 'test search' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('test search')
  })

  it('task renderer shows description', () => {
    const call = createMockCall({
      tool: 'task',
      input: { description: 'Run tests' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Run tests')
  })

  it('shows result preview for tools with result', () => {
    const call = createMockCall({
      tool: 'read',
      input: { path: '/test.ts' },
      status: 'success',
      result: 'line1\nline2\nline3',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('line1')
    expect(json).toContain('line3')
  })

  it('default renderer shows tool name', () => {
    const call = createMockCall({
      tool: 'unknown-tool',
      input: { someParam: 'value' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('unknown-tool')
  })

  it('shell renders with cmd key (alternative to command)', () => {
    const call = createMockCall({
      tool: 'bash',
      input: { cmd: 'echo hello' },
      status: 'success',
      result: 'hello',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('$ echo hello')
  })

  it('shell does not show output when no result', () => {
    const call = createMockCall({
      tool: 'bash',
      input: { command: 'ls' },
      status: 'called',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).not.toContain('lines')
  })

  it('read renderer shows path', () => {
    const call = createMockCall({
      tool: 'read',
      input: { path: '/test.ts' },
      status: 'called',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('/test.ts')
  })

  it('read renderer accepts file key (alternative to path)', () => {
    const call = createMockCall({
      tool: 'read',
      input: { file: 'src/index.ts' },
      status: 'success',
      result: 'content',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('src/index.ts')
  })

  it('webfetch renderer truncates long content', () => {
    const longContent = 'A'.repeat(600)
    const call = createMockCall({
      tool: 'webfetch',
      input: { url: 'https://example.com' },
      status: 'success',
      result: longContent,
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).not.toContain('A'.repeat(550))
  })

  it('glob renderer accepts glob key (alternative to pattern)', () => {
    const call = createMockCall({
      tool: 'glob',
      input: { glob: '**/*.ts' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('**/*.ts')
  })

  it('grep renderer accepts pattern key (alternative to query)', () => {
    const call = createMockCall({
      tool: 'grep',
      input: { pattern: 'test' },
      status: 'success',
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    expect(textOf(tree)).toContain('test')
  })

  it('renders array result as preview', () => {
    const call = createMockCall({
      tool: 'glob',
      input: { pattern: '**/*.ts' },
      status: 'success',
      result: ['a.ts', 'b.ts', 'c.ts'],
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = JSON.stringify(tree.toJSON())
    expect(json).toContain('a.ts')
  })
})
