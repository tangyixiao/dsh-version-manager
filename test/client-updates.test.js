import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { readVersions } from '../lib/host/routes.js'

const row = { targetId: 'demo', installedVersion: '1.0.0', source: { kind: 'registry' }, updateRefusal: null, compatibility: { verdict: 'satisfied' } }
const candidate = { version: '1.1.0', isBundle: true, prerelease: false, deprecated: null, incompatible: null }
function harness(fetch, rows = [row], onRefresh = async () => {}) {
  let Panel
  let cells = []
  let cursor = 0
  let refs = []
  let refCursor = 0
  const React = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat() } }),
    useState(initial) {
      const index = cursor++
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial
      return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value }]
    },
    useRef(initial) { const index = refCursor++; return refs[index] ??= { current: initial } },
    useEffect() {}, useMemo: fn => fn(), useCallback: fn => fn,
  }
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    fetch, console, AbortController, window: { navigator: { language: 'zh-CN' }, __ModuleLoader__: { load({ factory }) {
      factory(() => React).apply({ get: () => null, slots: { inject: (_slot, fn) => fn(), register: (slot, component) => { if (slot.name === 'main') Panel = component } } })
    } } },
  })
  cells = [{ status: 'ready', data: { profile: {}, host: {}, plugins: rows, counts: {} }, error: null }]
  const panel = Panel()
  const batch = find(panel, node => node.type?.name === 'BatchUpdates')[0]
  batch.props.onRefresh = onRefresh
  const entry = find(panel, node => node.type?.name === 'Row')[0]
  let component = batch
  cells = []; refs = []
  function render(resolve = false) {
    cursor = 0; refCursor = 0
    const tree = component.type(component.props)
    function expand(node) {
      if (!node || typeof node !== 'object') return node
      if (typeof node.type === 'function') return expand(node.type(node.props))
      return { ...node, props: { ...node.props, children: node.props.children.map(expand) } }
    }
    return resolve ? expand(tree) : tree
  }
  return {
    render,
    row(onExpand) { component = { ...entry, props: { ...entry.props, onExpand } }; cells = []; refs = [] },
    state: () => cells[0],
    includeLocal: () => find(render(true), node => node.type === 'input' && node.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } }),
    click: async label => {
      const button = find(render(true), node => node.type === 'button' && text(node) === label)[0]
      assert.ok(button, `button exists: ${label}`)
      return button.props.onClick()
    },
  }
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...(node.props?.children ?? []).flatMap(child => find(child, predicate))]
}
function text(node) { return node && typeof node === 'object' ? (node.props?.children ?? []).map(text).join('') : String(node ?? '') }
function response(value) { return { ok: true, json: async () => value } }

test('batch checks skip local archives and filter prerelease, deprecation, non-bundles and host incompatibility', async () => {
  const calls = []
  const ui = harness(async path => { calls.push(path); return response({ status: 'ok', stable: [
    { ...candidate, version: '9.0.0', incompatible: { requirements: '>=9' } },
    { ...candidate, version: '8.0.0', deprecated: 'removed' },
    { ...candidate, version: '7.0.0', isBundle: false },
    { ...candidate, version: '6.0.0-beta.1', prerelease: true }, candidate,
  ] }) }, [row, { ...row, targetId: 'local', updateRefusal: 'not-registry:tarball' }])
  await ui.click('检查全部更新')
  assert.equal(calls.length, 1)
  assert.equal(ui.state().items.length, 1)
  assert.equal(ui.state().items[0].version, '1.1.0')
})

test('batch confirmation writes sequentially, stops on failure, and refreshes afterwards', async () => {
  const writes = []
  let refreshed = 0
  const ui = harness(async (path, options) => {
    if (path.endsWith('/overview')) { refreshed++; return response({ plugins: [], counts: {} }) }
    if (options?.method === 'POST') {
      writes.push(JSON.parse(options.body))
      return response({ ok: writes.length === 1, message: 'fixture failure' })
    }
    return response({ status: 'ok', stable: [candidate] })
  }, [row, { ...row, targetId: 'two' }, { ...row, targetId: 'three' }], async () => { refreshed++ })
  await ui.click('检查全部更新')
  assert.equal(writes.length, 0)
  await ui.click('一键更新 (3)')
  assert.equal(writes.length, 0, 'opening a preview does not start a write')
  await ui.click('确认更新')
  assert.equal(writes.length, 2)
  assert.equal(writes[0].confirm, true)
  assert.equal(writes[0].fromVersion, '1.0.0')
  assert.equal(ui.state().done, 1)
  assert.equal(ui.state().phase, 'done')
  assert.match(ui.state().messages.at(-1), /fixture failure/)
  assert.equal(refreshed, 1)
})

test('a single version check expands its row before the lookup finishes', async () => {
  let expanded = false
  const ui = harness(async () => { assert.equal(expanded, true); return response({ status: 'ok', stable: [], prerelease: [], versions: [] }) })
  ui.row(() => { expanded = true })
  await ui.click('检查更新')
  assert.equal(expanded, true)
})

test('the host incompatibility field survives version normalization', async () => {
  const incompatible = { requirements: '>=9', runtime: '0.2.2-rc.3' }
  const data = await readVersions({ get(name) { if (name === 'pluginManager') return {
    listBundles: async () => [{ name: 'demo', version: '1.0.0', source: 'demo@1.0.0', installed: true, availability: 'profile' }],
    listVersions: async () => ({ versions: [{ version: '1.1.0', bundle: true, incompatible }] }),
  } } }, 'demo')
  assert.deepEqual(data.stable[0].incompatible, incompatible)
})

test('local archive batching needs opt-in and sends the exact previewed source and archive digest', async () => {
  const writes = []
  const sourceMigration = { from: 'file:/demo.tgz', to: 'demo@1.0.0', archiveDigest: 'a'.repeat(64) }
  const ui = harness(async (path, options) => {
    if (options?.method === 'POST') { writes.push(JSON.parse(options.body)); return response({ ok: true }) }
    assert.match(path, /migrateToRegistry=true/)
    return response({ status: 'ok', stable: [{ ...candidate, version: '1.0.0' }], sourceMigration })
  }, [{ ...row, declaredSpec: sourceMigration.from, source: { kind: 'tarball' }, updateRefusal: 'not-registry:tarball' }])
  ui.includeLocal()
  await ui.click('检查全部更新')
  assert.equal(ui.state().items.length, 1)
  await ui.click('一键更新 (1)')
  assert.equal(writes.length, 0)
  await ui.click('确认更新')
  assert.equal(writes[0].migrateToRegistry, true)
  assert.equal(writes[0].expectedSource, sourceMigration.from)
  assert.equal(writes[0].archiveDigest, sourceMigration.archiveDigest)
})
