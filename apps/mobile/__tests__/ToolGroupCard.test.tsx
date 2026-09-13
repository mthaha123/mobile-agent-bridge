/**
 * ToolGroupCard 分层展开测试
 *
 * 覆盖「长思考 + 多工具不顶满屏幕」的两级展开：
 *   0 折叠 → 1 限高裁剪（ClampBox，不滚动，只露最新工具）→ 详情 Modal（ToolDetailSheet）
 *
 * 约定（docs/plans/2026-09-12-chat-scroll-ownership-design.md）：
 *   cell 内不得出现纵向 ScrollView —— 一级展开只裁剪，纵向滚动归 ToolDetailSheet。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ScrollView, TouchableOpacity } from 'react-native'
import { ToolGroupCard } from '../src/components/chat/ToolGroupCard'
import { ToolDetailSheet } from '../src/components/chat/ToolDetailSheet'
import { ClampBox } from '../src/components/chat/ClampBox'
import { ToolPart } from '../src/components/chat/BasicTool'
import { textOf } from './test-utils'

const reasoning = (id: string, content: string) => ({ id, type: 'reasoning', data: { content } })
const tool = (id: string, name: string, status: 'success' | 'failed' | 'called' | 'progress') => ({
  id,
  type: 'tool',
  data: { tool: name, input: { path: 'a.ts' }, status },
})

type AnyPart = ReturnType<typeof reasoning> | ReturnType<typeof tool>

function render(parts: AnyPart[]) {
  return TestRenderer.create(<ToolGroupCard parts={parts as any} />)
}

/** 点标题栏（第一个 TouchableOpacity，即 header） */
function pressHeader(tree: TestRenderer.ReactTestRenderer) {
  const header = tree.root.findAllByType(TouchableOpacity)[0]
  act(() => { header.props.onPress() })
}

/** 点详情入口（含 accessibilityLabel 的那个） */
function pressExpandAll(tree: TestRenderer.ReactTestRenderer) {
  const btn = tree.root.find((n) => n.props?.accessibilityLabel === '展开全部工具')
  act(() => { btn.props.onPress() })
}

describe('ToolGroupCard — 分层展开', () => {
  it('level 0：只渲染标题栏', () => {
    const tree = render([reasoning('r1', '思考内容'), tool('t1', 'read', 'success')])
    expect(textOf(tree)).toContain('操作（思考 + 1 个工具）')
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
    expect(tree.root.findAllByType(ClampBox)).toHaveLength(0)
    expect(tree.root.findAllByType(ToolPart)).toHaveLength(0)
  })

  it('点标题 → level 1：出现 ClampBox 裁剪，且无纵向 ScrollView', () => {
    const tree = render([
      reasoning('r1', '思考内容一'),
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'success'),
    ])
    pressHeader(tree)
    expect(tree.root.findAllByType(ClampBox)).toHaveLength(1)
    // cell 内不得有纵向滚动容器
    const verticals = tree.root.findAllByType(ScrollView).filter((s) => !s.props.horizontal)
    expect(verticals).toHaveLength(0)
    // 思考全文在裁剪框内
    expect(textOf(tree)).toContain('思考内容一')
  })

  it('level 1 只露「正在运行」的工具（运行中的优先）', () => {
    const tree = render([
      tool('t1', 'read', 'success'),
      tool('t2', 'bash', 'progress'),
      tool('t3', 'write', 'called'),
    ])
    pressHeader(tree)
    expect(textOf(tree)).toContain('⏳')
    expect(tree.root.findAllByType(ToolPart)).toHaveLength(0)
  })

  it('没有运行中的工具时，露最后一个（标题状态取失败 → ✗）', () => {
    const tree = render([
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'failed'),
    ])
    pressHeader(tree)
    expect(textOf(tree)).toContain('✗')
  })

  it('level 1 时点标题 → 回到 level 0', () => {
    const tree = render([reasoning('r1', 'x'), tool('t1', 'read', 'success')])
    pressHeader(tree)
    expect(tree.root.findAllByType(ClampBox)).toHaveLength(1)
    pressHeader(tree)
    expect(tree.root.findAllByType(ClampBox)).toHaveLength(0)
  })
})

describe('ToolGroupCard — 详情入口', () => {
  it('多个工具：文案「展开全部 (N)」', () => {
    const tree = render([
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'success'),
      tool('t3', 'bash', 'success'),
    ])
    pressHeader(tree)
    expect(textOf(tree)).toContain('展开全部 (3)')
  })

  it('只有一个工具：文案「查看详情」', () => {
    const tree = render([tool('t1', 'read', 'success')])
    pressHeader(tree)
    expect(textOf(tree)).toContain('查看详情')
    expect(textOf(tree)).not.toContain('展开全部')
  })

  it('纯思考无工具：不显示入口', () => {
    const tree = render([reasoning('r1', '只想了一会儿')])
    pressHeader(tree)
    expect(() => tree.root.find((n) => n.props?.accessibilityLabel === '展开全部工具')).toThrow()
  })

  it('折叠态不显示入口', () => {
    const tree = render([tool('t1', 'read', 'success'), tool('t2', 'write', 'success')])
    expect(() => tree.root.find((n) => n.props?.accessibilityLabel === '展开全部工具')).toThrow()
  })
})

describe('ToolGroupCard — 详情 Modal（ToolDetailSheet）', () => {
  it('默认不挂载详情 Modal', () => {
    const tree = render([reasoning('r1', 'x'), tool('t1', 'read', 'success')])
    pressHeader(tree)
    expect(tree.root.findAllByType(ToolDetailSheet)).toHaveLength(0)
  })

  it('点入口 → 打开 ToolDetailSheet，全部工具以 defaultExpanded 呈现', () => {
    const tree = render([
      reasoning('r1', '完整思考'),
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'success'),
      tool('t3', 'bash', 'success'),
    ])
    pressHeader(tree)
    pressExpandAll(tree)

    const sheet = tree.root.findAllByType(ToolDetailSheet)[0]
    expect(sheet.props.visible).toBe(true)
    expect(sheet.props.parts).toHaveLength(4)

    const parts = tree.root.findAllByType(ToolPart)
    expect(parts).toHaveLength(3)
    parts.forEach((p) => expect(p.props.defaultExpanded).toBe(true))
    expect(textOf(tree)).toContain('完整思考')
  })

  it('详情 Modal 传入的是本卡片的 parts（思考 + 工具）', () => {
    const tree = render([reasoning('r1', 'r'), tool('t1', 'read', 'success')])
    pressHeader(tree)
    pressExpandAll(tree)
    const sheet = tree.root.findAllByType(ToolDetailSheet)[0]
    const types = (sheet.props.parts as Array<{ type: string }>).map((p) => p.type)
    expect(types).toEqual(['reasoning', 'tool'])
  })

  it('关闭详情 Modal 后回到折叠态', () => {
    const tree = render([tool('t1', 'read', 'success'), tool('t2', 'write', 'success')])
    pressHeader(tree)
    pressExpandAll(tree)
    expect(tree.root.findAllByType(ToolDetailSheet)).toHaveLength(1)

    act(() => { tree.root.findAllByType(ToolDetailSheet)[0].props.onClose() })
    expect(tree.root.findAllByType(ToolDetailSheet)).toHaveLength(0)
  })
})

describe('ToolPart — defaultExpanded', () => {
  const data = { tool: 'read', input: { path: 'a.ts' }, result: '文件内容', status: 'success' }

  it('默认折叠（未传 defaultExpanded）', () => {
    const tree = TestRenderer.create(<ToolPart data={data} messageRole="assistant" />)
    expect(textOf(tree)).not.toContain('文件内容')
  })

  it('defaultExpanded=true 时详情可见', () => {
    const tree = TestRenderer.create(<ToolPart data={data} messageRole="assistant" defaultExpanded />)
    expect(textOf(tree)).toContain('文件内容')
  })

  it('默认展开后仍可点一下收起（应对超长输出）', () => {
    const tree = TestRenderer.create(<ToolPart data={data} messageRole="assistant" defaultExpanded />)
    expect(textOf(tree)).toContain('文件内容')
    const header = tree.root.findAllByType(TouchableOpacity)[0]
    act(() => { header.props.onPress() })
    expect(textOf(tree)).not.toContain('文件内容')
  })
})
