import type React from 'react'

// ─── Part 类型（消息内容块） ────────────────────────────

export type PartType = 'text' | 'tool' | 'reasoning' | 'file' | 'error' | 'compaction'

export interface Part {
  id: string
  type: PartType
  data: Record<string, unknown>
}

// ─── 消息模型（升级版，兼容旧版 ChatMessage） ──────────

export interface RichMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: Part[]
  timestamp: number
  messageID?: string
  partID?: string
  agent?: string
  model?: string
}

// ─── Part 渲染器注册表 ──────────────────────────────────

export interface PartProps {
  part: Part
  message: RichMessage
}

const PART_RENDERERS = new Map<string, React.FC<PartProps>>()

export function registerPart(type: PartType, component: React.FC<PartProps>): void {
  PART_RENDERERS.set(type, component)
}

export function getPartRenderer(type: PartType): React.FC<PartProps> | undefined {
  return PART_RENDERERS.get(type)
}

// ─── Tool 类型 ──────────────────────────────────────────

export interface ToolInfo {
  icon: string
  title: string
  subtitle?: string
}

const TOOL_RENDERERS = new Map<string, React.FC<{ data: Record<string, unknown> }>>()

export function registerToolRenderer(tool: string, component: React.FC<{ data: Record<string, unknown> }>): void {
  TOOL_RENDERERS.set(tool, component)
}

export function getToolRenderer(tool: string): React.FC<{ data: Record<string, unknown> }> | undefined {
  return TOOL_RENDERERS.get(tool)
}

export function getToolInfo(tool: string, input: Record<string, unknown> = {}): ToolInfo {
  const iconMap: Record<string, string> = {
    bash: '⌘', shell: '⌘',
    read: '📖', list: '📂',
    glob: '🔍', grep: '🔎',
    webfetch: '🌐', websearch: '🔍',
    task: '🧠',
    edit: '📝', write: '✏️', apply_patch: '📎',
    todowrite: '✅',
    question: '❓',
    skill: '🧩',
  }
  const titleMap: Record<string, string> = {
    bash: 'Shell', shell: 'Shell',
    read: 'Read', list: 'List',
    glob: 'Glob', grep: 'Grep',
    webfetch: 'Web Fetch', websearch: 'Web Search',
    task: 'Agent',
    edit: 'Edit', write: 'Write', apply_patch: 'Patch',
    todowrite: 'Todos',
    question: 'Questions',
    skill: 'Skill',
  }

  let subtitle = ''
  if (['read', 'edit', 'write'].includes(tool)) subtitle = String(input.filePath ?? input.path ?? '')
  else if (tool === 'glob') subtitle = String(input.pattern ?? '')
  else if (tool === 'grep') subtitle = String(input.query ?? input.pattern ?? '')
  else if (tool === 'webfetch') subtitle = String(input.url ?? '')
  else if (tool === 'websearch') subtitle = String(input.query ?? '')
  else if (tool === 'task') subtitle = String(input.description ?? '').slice(0, 60)
  else if (tool === 'bash' || tool === 'shell') subtitle = String(input.description ?? input.command ?? input.cmd ?? '')

  return {
    icon: iconMap[tool] || '⚙️',
    title: titleMap[tool] || tool,
    subtitle,
  }
}
