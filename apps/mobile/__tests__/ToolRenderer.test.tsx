/**
 * ToolRenderer — 单元测试 (react-test-renderer)
 */
import React from 'react'
import TestRenderer from 'react-test-renderer'
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
    expect(json).toContain('WebFetch')
    expect(json).toContain('https://example.com')
  })

  it('renders WebSearch tool correctly', () => {
    const call = createMockCall({
      tool: 'websearch',
      input: { query: 'test query' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('WebSearch')
    expect(json).toContain('test query')
  })

  it('renders Task tool correctly', () => {
    const call = createMockCall({
      tool: 'task',
      input: { description: 'Test task description' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Task')
    expect(json).toContain('Test task description')
  })

  it('renders Question tool correctly', () => {
    const call = createMockCall({
      tool: 'question',
      input: { question: 'What is your name?' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Question')
    expect(json).toContain('What is your name?')
  })

  it('renders Skill tool correctly', () => {
    const call = createMockCall({
      tool: 'skill',
      input: { name: 'test-skill' },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('Skill')
    expect(json).toContain('test-skill')
  })

  it('renders TodoWrite tool correctly', () => {
    const call = createMockCall({
      tool: 'todowrite',
      input: { todos: [{ content: 'Test todo' }] },
    })
    const tree = TestRenderer.create(<ToolRenderer call={call} />)
    const json = toJson(tree)
    expect(json).toContain('TodoWrite')
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
})
