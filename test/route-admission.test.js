import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'
import { admit, registerRoutes, ROUTE_BASE } from '../lib/host/routes.js'

const reads = ['/overview', '/versions', '/skills', '/skills/restore-preview', '/skills/git']
const writes = [
  '/skills/git/register', '/skills/git/remove', '/skills/git/preview',
  '/skills/git/update', '/skills/git/restore', '/skills/snapshot',
  '/skills/restore', '/snapshot', '/snapshots/prune', '/update', '/restore',
]
const paths = [...reads, ...writes].map((path) => `${ROUTE_BASE}${path}`)

function response() {
  return {
    status: null, headers: {}, text: '', ended: false,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(text = '') { this.text = text; this.ended = true },
  }
}

function request(path, { headers = {}, method = writes.some((suffix) => path === `${ROUTE_BASE}${suffix}`) ? 'POST' : 'GET', body = '{"confirm":true}' } = {}) {
  return {
    method, url: `${path}?target=fixture-plugin`,
    headers: { host: 'localhost:8765', origin: 'http://localhost:8765', cookie: 'fixture-session=owner', ...headers },
    bodyReads: 0,
    async *[Symbol.asyncIterator]() { this.bodyReads++; yield Buffer.from(body) },
  }
}

function fixture(connection) {
  const routes = new Map()
  const touched = []
  const disposed = []
  const ctx = {
    get(name) {
      if (name === 'connection') return connection
      touched.push(name)
      if (name === 'pluginManager') return {
        async listBundles() { return [{ name: 'fixture-plugin', source: 'fixture-plugin@1.0.0', version: '1.0.0', installed: true, availability: 'profile' }] },
        async listVersions() { return { versions: [{ version: '1.1.0' }] } },
      }
      return undefined
    },
  }
  const webServer = {
    register(route) {
      assert.equal(route.kind, 'exact')
      assert(!routes.has(route.path))
      routes.set(route.path, route.handler)
      return () => { disposed.push(route.path); routes.delete(route.path) }
    },
  }
  const disposers = registerRoutes(ctx, { webServer })
  assert.deepEqual([...routes.keys()].sort(), [...paths].sort())
  return { ctx, routes, touched, disposed, disposers, webServer }
}

function ownerConnection() {
  return {
    fenceCalls: 0, admissionCalls: 0,
    requestRejection(req) {
      this.fenceCalls++
      // Model the host's separate trust/auth decision, without reimplementing it in the plugin.
      if (req.headers.host !== 'localhost:8765' || req.headers.origin !== 'http://localhost:8765' || req.headers['sec-fetch-site'] === 'cross-site') return 403
      return req.headers.cookie === 'fixture-session=owner' ? undefined : 401
    },
    admit() { this.admissionCalls++; return { peer: { principal: { kind: 'owner' } } } },
  }
}

const invalidOwnerAdmissions = [
  () => Promise.reject(new Error('asynchronous owner admission unavailable')),
  () => Promise.resolve({ peer: { principal: { kind: 'owner' } } }),
  () => ({ then(_resolve, reject) { reject(new Error('owner thenable rejected')) } }),
  () => ({ get then() { throw new Error('unreadable then') } }),
  () => ({ get rejection() { throw new Error('unreadable rejection') } }),
  () => ({ get peer() { throw new Error('unreadable peer') } }),
  () => ({ peer: { get principal() { throw new Error('unreadable principal') } } }),
  () => ({ peer: { principal: { get kind() { throw new Error('unreadable kind') } } } }),
  () => new Proxy({}, { has() { throw new Error('unreadable admission shape') } }),
  () => ({ rejection: 200 }),
]

test('owner admission helper fails closed for asynchronous and unreadable host results', async () => {
  for (const result of invalidOwnerAdmissions) {
    assert.deepEqual(admit({ get: () => ({ admit: result }) }, {}), { ok: false, status: 401 })
  }
  assert.deepEqual(admit({ get() { throw new Error('unavailable service') } }, {}), { ok: false, status: 401 })
  assert.deepEqual(admit({ get: () => ({ get admit() { throw new Error('unavailable method') } }) }, {}), { ok: false, status: 401 })
  await new Promise((resolve) => setImmediate(resolve))
})

test('every registered route refuses malformed owner admission before body reads or services', async () => {
  for (const result of invalidOwnerAdmissions) {
    const connection = { requestRejection: () => undefined, admit: result }
    const { routes, touched } = fixture(connection)
    for (const path of paths) {
      const req = request(path)
      const res = response()
      await routes.get(path)(req, res)
      assert.equal(res.status, 401, path)
      assert.equal(req.bodyReads, 0, path)
    }
    assert.deepEqual(touched, [])
    await new Promise((resolve) => setImmediate(resolve))
  }
})

test('every route rejects hostile Host, Origin and cross-site requests before owner admission, body reads or service access', async () => {
  for (const headers of [{ host: 'attacker.invalid:8765' }, { origin: 'https://attacker.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
    const connection = ownerConnection()
    const { routes, touched } = fixture(connection)
    for (const path of paths) {
      const req = request(path, { headers })
      const res = response()
      await routes.get(path)(req, res)
      assert.equal(res.status, 403, path)
      assert.equal(JSON.parse(res.text).error, 'forbidden')
      assert.equal(req.bodyReads, 0, path)
    }
    assert.equal(connection.fenceCalls, paths.length)
    assert.equal(connection.admissionCalls, 0)
    assert.deepEqual(touched, [])
  }
})

test('every route fails closed when the host fence is missing, throws or returns an invalid verdict', async () => {
  for (const connection of [undefined, {}, { admit: ownerConnection().admit }, { requestRejection() { throw new Error('unavailable') } }, ...[null, false, true, 200, {}, Promise.resolve(undefined)].map((verdict) => ({ requestRejection: () => verdict }))]) {
    const { routes, touched } = fixture(connection)
    for (const path of paths) {
      const req = request(path)
      const res = response()
      await routes.get(path)(req, res)
      assert.equal(res.status, 401, path)
      assert.equal(req.bodyReads, 0)
    }
    assert.deepEqual(touched, [])
  }
})

test('host authentication rejects unauthenticated local requests on every route', async () => {
  const connection = ownerConnection()
  const { routes, touched } = fixture(connection)
  for (const path of paths) {
    const req = request(path, { headers: { cookie: '' } })
    const res = response()
    await routes.get(path)(req, res)
    assert.equal(res.status, 401)
    assert.equal(req.bodyReads, 0)
  }
  assert.equal(connection.admissionCalls, 0)
  assert.deepEqual(touched, [])
})

test('every route refuses rejected asynchronous host verdicts without an unhandled rejection', async () => {
  const connection = {
    requestRejection() { return Promise.reject(new Error('asynchronous host fence is unavailable')) },
    admit() { assert.fail('owner admission must not run after an asynchronous host verdict') },
  }
  const { routes, touched } = fixture(connection)
  for (const path of paths) {
    const req = request(path)
    const res = response()
    await routes.get(path)(req, res)
    assert.equal(res.status, 401, path)
    assert.equal(req.bodyReads, 0, path)
  }
  // Let the event loop report any unhandled rejection to the test runner.
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(touched, [])
})

test('every route fails closed if reading the connection service throws', async () => {
  const setup = fixture(ownerConnection())
  setup.ctx.get = () => { throw new Error('connection service unavailable') }
  for (const path of paths) {
    const req = request(path)
    const res = response()
    await setup.routes.get(path)(req, res)
    assert.equal(res.status, 401, path)
    assert.equal(req.bodyReads, 0, path)
  }
  assert.deepEqual(setup.touched, [])
})

test('authenticated local owner can read versions, and owner authorization remains required', async () => {
  const connection = ownerConnection()
  const { routes } = fixture(connection)
  const path = `${ROUTE_BASE}/versions`
  const res = response()
  await routes.get(path)(request(path), res)
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.text).versions[0].version, '1.1.0')
  assert.equal(connection.fenceCalls, 1)
  assert.equal(connection.admissionCalls, 1)

  for (const [admit, status] of [[undefined, 401], [() => { throw new Error('unavailable') }, 401], [() => null, 401], [() => ({ rejection: 401 }), 401], [() => ({ peer: { principal: { kind: 'guest' } } }), 403]]) {
    connection.admit = admit
    const denied = response()
    await routes.get(path)(request(path), denied)
    assert.equal(denied.status, status)
  }
})

test('all routes retain method checks and writes require explicit confirmation after admission', async () => {
  const { routes, touched } = fixture(ownerConnection())
  for (const path of paths) {
    const req = request(path, { method: 'DELETE' })
    const res = response()
    await routes.get(path)(req, res)
    assert.equal(res.status, 405, path)
    assert.equal(res.headers.allow, reads.some((suffix) => path === `${ROUTE_BASE}${suffix}`) ? 'GET' : 'POST')
    assert.equal(req.bodyReads, 0)
  }
  for (const suffix of writes) {
    const path = `${ROUTE_BASE}${suffix}`
    const req = request(path, { body: '{}' })
    const res = response()
    await routes.get(path)(req, res)
    assert.equal(res.status, 400)
    assert.equal(JSON.parse(res.text).error, 'confirm required')
    assert.equal(req.bodyReads, 1)
  }
  assert.deepEqual(touched, [])
})

test('plugin lifecycle disposes every guarded route', () => {
  const setup = fixture(ownerConnection())
  for (const dispose of setup.disposers) dispose()
  let cleanup
  setup.ctx.inject = (services, callback) => {
    assert.deepEqual(services, ['webServer'])
    callback({ webServer: setup.webServer, effect(start) { cleanup = start() } })
  }
  apply(setup.ctx)
  assert.equal(setup.routes.size, paths.length)
  cleanup()
  assert.equal(setup.routes.size, 0)
  assert.equal(setup.disposed.length, paths.length * 2)
})
