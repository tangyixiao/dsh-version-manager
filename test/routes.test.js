import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyUpdateResult, isAlreadyInstalled } from '../lib/host/routes.js'

test('a nested applied result counts as applied', () => {
  assert.deepEqual(
    classifyUpdateResult({ from: '1.0.0', to: '1.1.0', step: 'install', result: { changed: true, application: 'applied' } }),
    { ok: true, message: null },
  )
})

test('a nested failed result is not reported as a success', () => {
  const outcome = classifyUpdateResult({ result: { changed: false, application: 'failed', error: { code: 'already-installed' } } })
  assert.equal(outcome.ok, false)
  assert.match(outcome.message, /without applying/)
})

test('an applied flag without a change is refused', () => {
  const outcome = classifyUpdateResult({ result: { changed: false, application: 'applied' } })
  assert.equal(outcome.ok, false)
})

test('a change that did not apply is refused', () => {
  const outcome = classifyUpdateResult({ result: { changed: true, application: 'failed' } })
  assert.equal(outcome.ok, false)
  assert.match(outcome.message, /reported application/)
})

test('the already-installed refusal is recognised at either level', () => {
  assert.equal(isAlreadyInstalled({ result: { error: { code: 'already-installed' } } }), true)
  assert.equal(isAlreadyInstalled({ error: { code: 'already-installed' } }), true)
  assert.equal(isAlreadyInstalled({ result: { error: { code: 'operation-error' } } }), false)
  assert.equal(isAlreadyInstalled(null), false)
})
