/**
 * ToolDetailSheet 测试
 *
 * Modal 承载"操作块"完整详情：思考全文 + 全部工具详情。
 * 它是唯一拥有纵向滚动的容器（cell 内不再内嵌纵向滚动）。
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'
import { Modal, ScrollView, TouchableOpacity } from 'react-native'
import { ToolDetailSheet } from '../src/components/chat/ToolDetailSheet'
import { ToolPart } from '../src/components/chat/BasicTool'
import { textOf } from './test-utils'

const reasoning = (id: string, content: string) => ({ id, type: 'reasoning', data: { content } })
const tool = (id: string, name: string, status: 'success' | 'failed' | 'called' | 'progress') => ({
  id,
  type: 'tool',
  data: { tool: name, input: { path: 'a.ts' }, status },
})

function render(props: {
  visible: boolean
  parts: any[]
  onClose?: () => void
}) {
  let tree!: TestRenderer.ReactTestRenderer
  act(() => {
    tree = TestRenderer.create(
      <ToolDetailSheet visible={props.visible} parts={props.parts} onClose={props.onClose ?? (() => {})} />,
    )
  })
  return tree
}

describe('ToolDetailSheet', () => {
  it('不可见时 Modal.visible=false', () => {
    const tree = render({ visible: false, parts: [reasoning('r1', '思考')] })
    expect(tree.root.findAllByType(Modal)[0].props.visible).toBe(false)
  })

  it('可见时渲染思考全文', () => {
    const tree = render({ visible: true, parts: [reasoning('r1', '完整思考内容')] })
    expect(tree.root.findAllByType(Modal)[0].props.visible).toBe(true)
    expect(textOf(tree)).toContain('完整思考内容')
  })

  it('可见时渲染全部工具（defaultExpanded），数量匹配', () => {
    const tree = render({
      visible: true,
      parts: [reasoning('r1', 'x'), tool('t1', 'read', 'success'), tool('t2', 'write', 'failed')],
    })
    const parts = tree.root.findAllByType(ToolPart)
    expect(parts).toHaveLength(2)
    parts.forEach((p) => expect(p.props.defaultExpanded).toBe(true))
  })

  it('恰好一个纵向 ScrollView（唯一纵向滚动所有者）', () => {
    const tree = render({ visible: true, parts: [reasoning('r1', 'x'), tool('t1', 'read', 'success')] })
    const verticals = tree.root
      .findAllByType(ScrollView)
      .filter((s) => !s.props.horizontal)
    expect(verticals).toHaveLength(1)
  })

  it('点关闭按钮触发 onClose', () => {
    const onClose = jest.fn()
    const tree = render({ visible: true, parts: [reasoning('r1', 'x')], onClose })
    const closeBtn = tree.root.find(
      (n) => n.props?.accessibilityLabel === '关闭工具详情' && typeof n.props?.onPress === 'function',
    )
    act(() => { closeBtn.props.onPress() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('无 parts 时不崩溃', () => {
    const tree = render({ visible: true, parts: [] })
    expect(tree.toJSON()).not.toBeNull()
  })
})
