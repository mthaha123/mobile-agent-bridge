import React from 'react'
import { Text } from 'react-native'
import TestRenderer, { act } from 'react-test-renderer'
import { MarkdownTable, fitColumnWidths } from '../src/components/chat/MarkdownTable'

/** 在 JSON 树中按 testID 查找节点 */
function findByTestId(json: any, testID: string): any {
  if (json?.props?.testID === testID) return json
  const children = Array.isArray(json?.children) ? json.children : []
  for (const child of children) {
    const hit = findByTestId(child, testID)
    if (hit) return hit
  }
  return null
}

/** 收集树中所有指定类型的节点 */
function collectByType(json: any, type: string, acc: any[] = []): any[] {
  if (!json) return acc
  if (json.type === type) acc.push(json)
  const children = Array.isArray(json.children) ? json.children : []
  children.forEach((c: any) => collectByType(c, type, acc))
  return acc
}

function textOf(node: any): string {
  if (!node) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.children) return textOf(node.children)
  return ''
}

const NARROW_TABLE = {
  header: ['H1', 'H2'],
  rows: [
    ['a', 'b'],
    ['c', 'd'],
  ],
}

function makeTable(header: any[], rows: any[][]) {
  return TestRenderer.create(<MarkdownTable header={header} rows={rows} />)
}

describe('MarkdownTable 列宽计算 fitColumnWidths', () => {
  it('容器足够宽时均分剩余空间铺满容器（免横向滚动）', () => {
    expect(fitColumnWidths([100, 100], 400)).toEqual([200, 200])
  })

  it('恰好放满时保持不变', () => {
    expect(fitColumnWidths([150, 250], 400)).toEqual([150, 250])
  })

  it('空列数组不产生除零错误', () => {
    expect(fitColumnWidths([], 400)).toEqual([])
  })

  it('轻微溢出时按比例压缩至容器宽度（消除滚动）', () => {
    // 220+220=440，容器400 → 每列压缩到200，总和=400，不需要滚动
    const result = fitColumnWidths([220, 220], 400)
    const total = result.reduce((s, w) => s + w, 0)
    expect(total).toBeLessThanOrEqual(400)
    // 每列不低于自然宽度的 50%
    result.forEach((w, i) => {
      expect(w).toBeGreaterThanOrEqual(Math.floor(220 * 0.5))
    })
  })

  it('严重溢出时保留自然宽度交给 ScrollView', () => {
    // 4列×300=1200，容器400，平均100/列→但压缩后太窄，保留原始
    const result = fitColumnWidths([300, 300, 300, 300], 400)
    expect(result).toEqual([300, 300, 300, 300])
  })

  it('按比例分配：宽列分得多、窄列分得少', () => {
    // 100+300=400，恰好放满 → 均分额外空间
    const fit = fitColumnWidths([100, 300], 400)
    expect(fit[0] + fit[1]).toBe(400)

    // 120+320=440，容器400 → 压缩
    const compressed = fitColumnWidths([120, 320], 400)
    const total = compressed.reduce((s, w) => s + w, 0)
    expect(total).toBeLessThanOrEqual(400)
    // 宽列压缩比例应大于窄列
    expect(compressed[1]).toBeGreaterThan(compressed[0])
  })
})

describe('MarkdownTable 组件', () => {
  it('渲染表头与全部单元格文本', () => {
    const tree = makeTable(
      NARROW_TABLE.header.map((h) => <Text key={h}>{h}</Text>),
      NARROW_TABLE.rows.map((row, r) =>
        row.map((c) => <Text key={`${r}-${c}`}>{c}</Text>),
      ),
    )
    const text = textOf(tree.toJSON())
    expect(text).toContain('H1')
    expect(text).toContain('H2')
    expect(text).toContain('a')
    expect(text).toContain('b')
    expect(text).toContain('c')
    expect(text).toContain('d')
    tree.unmount()
  })

  it('窄表：铺满容器后无需横向滚动指示条', () => {
    const tree = makeTable(
      NARROW_TABLE.header.map((h) => <Text key={h}>{h}</Text>),
      NARROW_TABLE.rows.map((row, r) =>
        row.map((c) => <Text key={`${r}-${c}`}>{c}</Text>),
      ),
    )
    // 模拟容器实测宽度 400px：短内容两列总宽远小于 400 → 铺满、无滚动
    const wrap = tree.root.findByProps({ testID: 'md-table' })
    expect(wrap).toBeTruthy()
    act(() => {
      wrap.props.onLayout({ nativeEvent: { layout: { width: 400 } } })
    })
    const scroll = tree.root.findByProps({ testID: 'md-table-scroll' })
    expect(scroll.props.showsHorizontalScrollIndicator).toBe(false)
    tree.unmount()
  })

  it('宽表：内容超出容器时保留横向滚动能力并展示展开按钮', () => {
    const longA = 'A'.repeat(40)
    const longB = '很长的中文内容'.repeat(12)
    const tree = makeTable(
      [<Text key="ha">{longA}</Text>, <Text key="hb">{longB}</Text>],
      [[<Text key="ca">{longA}</Text>, <Text key="cb">{longB}</Text>]],
    )
    // 容器收窄到 200px：两列自然宽度均被夹到上限后仍超出 → 需要横向滚动
    const wrap = tree.root.findByProps({ testID: 'md-table' })
    act(() => {
      wrap.props.onLayout({ nativeEvent: { layout: { width: 200 } } })
    })
    const scroll = tree.root.findByProps({ testID: 'md-table-scroll' })
    expect(scroll.props.horizontal).toBe(true)
    expect(scroll.props.nestedScrollEnabled).toBe(true)
    expect(scroll.props.showsHorizontalScrollIndicator).toBe(true)

    const json = tree.toJSON()
    expect(findByTestId(json, 'md-table-expand')).toBeTruthy()
    // 所有单元格内容仍在树中（未被裁剪丢失）
    const text = textOf(json)
    expect(text).toContain(longA.slice(0, 10))
    expect(text).toContain(longB.slice(0, 4))
    tree.unmount()
  })

  it('点击 ⤢ 打开全屏表格查看器，可关闭', () => {
    const tree = makeTable(
      NARROW_TABLE.header.map((h) => <Text key={h}>{h}</Text>),
      NARROW_TABLE.rows.map((row, r) =>
        row.map((c) => <Text key={`${r}-${c}`}>{c}</Text>),
      ),
    )
    const modalBefore = tree.root.findByProps({ testID: 'md-table-modal' })
    expect(modalBefore.props.visible).toBe(false)

    act(() => {
      tree.root.findByProps({ testID: 'md-table-expand' }).props.onPress()
    })
    expect(tree.root.findByProps({ testID: 'md-table-modal' }).props.visible).toBe(true)
    // 全屏查看器内同样渲染完整表格内容
    const text = textOf(tree.toJSON())
    expect(text).toContain('H1')
    expect(text).toContain('d')

    act(() => {
      tree.root.findByProps({ testID: 'md-table-modal-close' }).props.onPress()
    })
    expect(tree.root.findByProps({ testID: 'md-table-modal' }).props.visible).toBe(false)
    tree.unmount()
  })

  it('行单元格缺失（参差行）不崩溃，占位补齐', () => {
    const tree = makeTable(
      NARROW_TABLE.header.map((h) => <Text key={h}>{h}</Text>),
      [[<Text key="only">a</Text>]],
    )
    expect(tree.toJSON()).not.toBeNull()
    tree.unmount()
  })
})
