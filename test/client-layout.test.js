import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const row = {
  targetId: '@deepseek-ai/dsh-experimental-voice-input-bundle',
  installedVersion: '0.6.2-toolkit.5',
  source: { kind: 'file', detail: 'C:\\Users\\example\\.dsh\\packages\\dsh-zcode-plan-bridge-0.6.2-toolkit.5-1f9e042db579.tgz' },
  updateRefusal: 'not-registry:file',
  compatibility: { verdict: 'satisfied', requirements: [] },
  declaredSpecObserved: null,
}

// Exercise the public ModuleLoader + slots contract without adding a React
// dependency. Browser geometry is checked separately with the actual renderer.
function render(expanded = null, language = 'zh-CN', geometry = null) {
  const data = { profile: { id: 'desktop' }, host: {}, plugins: [row], counts: { total: 1, writable: 0, official: 0 }, observedAt: null }
  const states = [{ status: 'ready', data, error: null }, 'all', '', expanded, 'plugins', { status: 'idle', data: null, error: null }]
  let index = 0
  let Panel
  const effects = []
  const React = {
    Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }),
    useState: initial => {
      const slot = index++
      if (!(slot in states)) states[slot] = typeof initial === 'function' ? initial() : initial
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }]
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useRef: initial => ({ current: initial }),
    useEffect(effect) { effects.push(effect) },
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    console,
    window: { innerHeight: geometry?.screenHeight, getComputedStyle: node => ({ overflowY: node.overflowY }), addEventListener() {}, removeEventListener() {}, navigator: { language }, __ModuleLoader__: { load({ factory }) {
      factory(name => { assert.equal(name, 'react'); return React }).apply({
        get: () => null,
        slots: { inject: (_name, fn) => fn(), register: (slot, Component) => { if (slot.name === 'main') Panel = Component } },
      })
    } } },
  })
  function resolve(node) {
    if (node === null || typeof node !== 'object') return node
    if (typeof node.type === 'function') return resolve(node.type(node.props))
    return { ...node, props: { ...node.props, children: node.props.children.map(resolve).filter(x => x !== null && x !== undefined) } }
  }
  let panel = Panel()
  if (geometry) {
    panel.props.ref.current = { getBoundingClientRect: () => ({ top: geometry.top }), parentElement: geometry.parent }
    effects[0]()
    index = 0
    panel = Panel()
  }
  return resolve(panel)
}
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...node.props.children.flatMap(child => find(child, predicate))]
}
function text(node) {
  return typeof node === 'object' && node !== null ? node.props.children.map(text).join('') : String(node ?? '')
}

test('long package paths cannot redistribute the version and action columns', () => {
  const panel = render()
  const region = find(panel, node => node.props.role === 'region' && node.props.style.overflowX === 'auto')[0]
  assert.ok(region, 'table scrolls inside a labelled keyboard accessible region')
  assert.equal(region.props.tabIndex, 0)
  assert.equal(region.props.style.overflowX, 'auto')
  const table = find(region, node => node.type === 'table')[0]
  assert.equal(table.props.style.tableLayout, 'fixed')
  assert.ok(table.props.style.minWidth >= 1000)
  const cols = find(table, node => node.type === 'col')
  assert.equal(cols.length, 6)
  assert.ok(cols[1].props.style.width >= 160, 'prerelease version has its own stable width')
  for (const value of [row.installedVersion, row.source.detail]) {
    const cellText = find(table, node => node.props.title === value)[0]
    assert.ok(cellText)
    assert.equal(cellText.props.style.whiteSpace, 'nowrap')
    assert.equal(cellText.props.style.textOverflow, 'ellipsis')
    assert.equal(text(cellText), value, 'full value remains available')
  }
})

test('the panel owns a full-height vertical scroll region even inside a clipped host slot', () => {
  const panel = render()
  assert.equal(panel.props.role, 'region')
  assert.equal(panel.props.tabIndex, 0)
  assert.equal(panel.props.style.height, '100%')
  assert.equal(panel.props.style.overflowY, 'scroll')
  assert.equal(panel.props.style.scrollbarGutter, 'stable')
  assert.ok(text(panel).includes('检查全部更新'))
})

test('scroll height uses the clipped host bounds instead of an unresolved percentage', () => {
  const clipped = { overflowY: 'hidden', getBoundingClientRect: () => ({ height: 500, bottom: 520 }), parentElement: null }
  const anchor = { overflowY: 'visible', getBoundingClientRect: () => ({ height: 0, bottom: 0 }), parentElement: clipped }
  const panel = render(null, 'zh-CN', { top: 40, screenHeight: 900, parent: anchor })
  assert.equal(panel.props.style.height, 480)
  assert.equal(panel.props.style.flex, '0 0 auto')
})

test('an unbounded host cannot stretch the scroll region beyond the viewport', () => {
  const panel = render(null, 'zh-CN', { top: 64, screenHeight: 768, parent: null })
  assert.equal(panel.props.style.height, 704)
})

test('expanding an abbreviated row exposes complete selectable name, version and source', () => {
  const panel = render(row.targetId)
  const details = find(panel, node => node.type === 'td' && node.props.colSpan === 6)[0]
  assert.ok(details)
  for (const value of [row.targetId, row.installedVersion, row.source.detail]) assert.ok(text(details).includes(value))
  const table = find(panel, node => node.type === 'table')[0]
  assert.equal(table.props.style.tableLayout, 'fixed', 'details do not recalculate columns')
})

test('English labels reserve enough space for compatibility and both actions', () => {
  const panel = render(null, 'en-US')
  const table = find(panel, node => node.type === 'table')[0]
  const cols = find(table, node => node.type === 'col')
  assert.ok(table.props.style.minWidth >= 1200)
  assert.ok(cols[4].props.style.width >= 170)
  assert.ok(cols[5].props.style.width >= 210)
})
