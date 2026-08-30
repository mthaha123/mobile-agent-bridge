/**
 * ToolGroupCard 分级展开测试
 *
 * 覆盖「长思考 + 多工具不顶满屏幕」的三级展开：
 *   0 折叠 → 1 限高（框内滚动，只露最新工具）→ 2 全开（不限高，全部工具详情）
 * 重点：最新工具的挑选规则、入口文案、状态迁移、ToolPart 默认展开。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { ScrollView, TouchableOpacity, Text } from 'react-native'
import { ToolGroupCard } from '../src/components/chat/ToolGroupCard'
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

/** 点底部入口（含 accessibilityLabel 的那个） */
function pressExpandAll(tree: TestRenderer.ReactTestRenderer) {
  const btn = tree.root.find((n) => n.props?.accessibilityLabel === '展开全部工具')
  act(() => { btn.props.onPress() })
}

describe('ToolGroupCard — 分级展开', () => {
  it('level 0：只渲染标题栏', () => {
    const tree = render([reasoning('r1', '思考内容'), tool('t1', 'read', 'success')])
    expect(textOf(tree)).toContain('操作（思考 + 1 个工具）')
    // 没有滚动框、没有工具详情
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
    expect(tree.root.findAllByType(ToolPart)).toHaveLength(0)
  })

  it('点标题 → level 1：出现限高滚动框 + 只露一个工具', () => {
    const tree = render([
      reasoning('r1', '思考内容一'),
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'success'),
    ])
    pressHeader(tree)
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(1)
    // 思考全文在框内
    expect(textOf(tree)).toContain('思考内容一')
    // 二级详情还没渲染
    expect(tree.root.findAllByType(ToolPart)).toHaveLength(0)
  })

  it('level 1 只露「正在运行」的工具（运行中的优先于已完成的）', () => {
    const tree = render([
      tool('t1', 'read', 'success'),
      tool('t2', 'bash', 'progress'), // 正在跑
      tool('t3', 'write', 'called'),  // 也在跑 → 取最后一个在跑的
    ])
    pressHeader(tree)
    const t = textOf(tree)
    // t3（最后一个运行中的）应出现
    expect(t).toContain('⏳')
    // t1（已完成）的一行不该出现在 level 1
    expect(tree.root.findAllByType(ToolPart)).toHaveLength(0)
  })

  it('没有运行中的工具时，露最后一个', () => {
    const tree = render([
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'failed'),
    ])
    pressHeader(tree)
    // 标题状态图标取"有失败 → ✗"
    expect(textOf(tree)).toContain('✗')
  })

  it('level 1 时点标题 → 回到 level 0', () => {
    const tree = render([reasoning('r1', 'x'), tool('t1', 'read', 'success')])
    pressHeader(tree)
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(1)
    pressHeader(tree)
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
  })
})

describe('ToolGroupCard — 底部入口', () => {
  it('多个工具：文案「展开全部 (N)」', () => {
    const tree = render([
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'success'),
      tool('t3', 'bash', 'success'),
    ])
    pressHeader(tree)
    expect(textOf(tree)).toContain('展开全部 (3)')
  })

  it('只有一个工具：文案「查看详情」（工具行不可点，必须留入口）', () => {
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

describe('ToolGroupCard — level 2 全开', () => {
  it('点入口 → 不限高，全部工具详情铺开且默认展开', () => {
    const tree = render([
      reasoning('r1', '完整思考'),
      tool('t1', 'read', 'success'),
      tool('t2', 'write', 'success'),
      tool('t3', 'bash', 'success'),
    ])
    pressHeader(tree)
    pressExpandAll(tree)

    // 二级展开后不再有限高滚动框
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
    // 3 个工具全部渲染，且详情默认展开
    const parts = tree.root.findAllByType(ToolPart)
    expect(parts).toHaveLength(3)
    parts.forEach((p) => expect(p.props.defaultExpanded).toBe(true))
    // 入口消失
    expect(() => tree.root.find((n) => n.props?.accessibilityLabel === '展开全部工具')).toThrow()
    // 思考全文仍在最上面
    expect(textOf(tree)).toContain('完整思考')
  })

  it('level 2 点标题 → 直接收起到 level 0（不退回 level 1）', () => {
    const tree = render([tool('t1', 'read', 'success'), tool('t2', 'write', 'success')])
    pressHeader(tree)
    pressExpandAll(tree)
    expect(tree.root.findAllByType(ToolPart)).toHaveLength(2)

    pressHeader(tree)
    expect(tree.root.findAllByType(ToolPart)).toHaveLength(0)
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0)
  })
})

describe('ToolPart — defaultExpanded', () => {
  // ToolPart 的详情取自 data.result（不是 output）
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
