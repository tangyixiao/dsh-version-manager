import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  listGitSkills,
  previewGitRoute,
  registerGitRoute,
  restoreGitRoute,
  unregisterGitRoute,
  updateGitRoute,
} from '../lib/host/git-routes.js'

const run = promisify(execFile)

/** Git is the subject here, so a machine without it skips rather than lies. */
async function hasGit() {
  try {
    await run('git', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

const GIT = await hasGit()
const gitTest = GIT ? test : test.skip

/**
 * A fake host whose catalog is whatever the test says it is.
 *
 * @param {Array<{ name: string, directory: string | null, source?: string }>} skills
 */
function fakeHost(skills) {
  return {
    get(name) {
      if (name !== 'skills') return undefined
      return {
        snapshot: async () => ({
          skills: skills.map((entry) => ({
            name: entry.name,
            description: 'fixture',
            resourceBase: entry.directory === null ? null : { kind: 'directory', path: entry.directory },
            source: entry.source ?? 'user',
          })),
        }),
      }
    },
    profile: null,
  }
}

async function makeRepo(root) {
  const repo = join(root, 'repo')
  const skillDir = join(repo, 'skills', 'demo')
  await mkdir(skillDir, { recursive: true })
  const git = (args) => run('git', args, { cwd: repo, windowsHide: true })
  await git(['init', '--quiet'])
  // The fixture must not depend on the host's line-ending settings, or the
  // recorded digest would change with the machine.
  await git(['config', 'core.autocrlf', 'false'])
  await git(['config', 'user.email', 'test@example.invalid'])
  await git(['config', 'user.name', 'Test'])
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo\n---\nA\n', 'utf8')
  await git(['add', '-A'])
  await git(['commit', '--quiet', '-m', 'A'])
  const a = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo\n---\nB\n', 'utf8')
  await writeFile(join(skillDir, 'extra.md'), 'added in B\n', 'utf8')
  await git(['add', '-A'])
  await git(['commit', '--quiet', '-m', 'B'])
  await git(['branch', 'baseline', a])
  return { repo, a }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'vm-gitroutes-'))
  const home = join(root, 'home')
  const directory = join(root, 'deploy', 'demo')
  await mkdir(home, { recursive: true })
  await mkdir(directory, { recursive: true })
  const { repo, a } = await makeRepo(root)
  return { root, home, directory, repo, a, profile: { id: 'test', home, dir: home, cwd: root } }
}

gitTest('register, fill, update and restore through the route handlers', async () => {
  const ctx = await setup()
  const host = fakeHost([{ name: 'demo', directory: ctx.directory }])

  const registered = await registerGitRoute(host, ctx.profile, {
    name: 'demo',
    remote: ctx.repo,
    subpath: 'skills/demo',
    ref: 'baseline',
  })
  assert.equal(registered.status, 200, JSON.stringify(registered.body))
  assert.equal(registered.body.ok, true)
  assert.equal(registered.body.entry.populated, false)
  assert.match(registered.body.note, /does not copy files/)

  // Registration alone writes nothing: the directory is still empty.
  assert.deepEqual(await readDirNames(ctx.directory), [])

  const listed = await listGitSkills(host, ctx.profile)
  assert.equal(listed.status, 200)
  assert.equal(listed.body.skills.length, 1)
  assert.equal(listed.body.skills[0].populated, false)
  assert.equal(listed.body.skills[0].name, 'demo')

  const preview = await previewGitRoute(ctx.profile, { name: 'demo' })
  assert.equal(preview.status, 200)
  assert.equal(preview.body.ok, true)
  assert.equal(preview.body.detail.populated, false)

  const first = await updateGitRoute(ctx.profile, { name: 'demo' })
  assert.equal(first.status, 200, JSON.stringify(first.body))
  assert.equal(first.body.ok, true)
  assert.equal(first.body.operationId.length > 0, true)
  assert.equal(first.body.current.populated, true)
  assert.deepEqual(await readDirNames(ctx.directory), ['SKILL.md'])

  const second = await updateGitRoute(ctx.profile, { name: 'demo', ref: 'HEAD' })
  assert.equal(second.status, 200, JSON.stringify(second.body))
  assert.equal(second.body.ok, true)
  assert.equal(second.body.changed, 2)
  assert.deepEqual(await readDirNames(ctx.directory), ['SKILL.md', 'extra.md'])

  // Asking again is not a failure, and it is not a silent no-op either: the
  // route says which state it found.
  const again = await updateGitRoute(ctx.profile, { name: 'demo', ref: 'HEAD' })
  assert.equal(again.status, 200)
  assert.equal(again.body.ok, false)
  assert.equal(again.body.error, 'already-at-revision')

  const restored = await restoreGitRoute(ctx.profile, { name: 'demo', revision: ctx.a })
  assert.equal(restored.status, 200, JSON.stringify(restored.body))
  assert.equal(restored.body.ok, true)
  assert.deepEqual(await readDirNames(ctx.directory), ['SKILL.md'])
  assert.match(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), /A/)

  // Every write above left an undo point, so the panel can walk back.
  assert.equal(restored.body.snapshot !== undefined && restored.body.snapshot !== null, true)
})

gitTest('a hand edit is refused by the route, and the edit survives', async () => {
  const ctx = await setup()
  const host = fakeHost([{ name: 'demo', directory: ctx.directory }])
  await registerGitRoute(host, ctx.profile, {
    name: 'demo',
    remote: ctx.repo,
    subpath: 'skills/demo',
    ref: 'baseline',
  })
  await updateGitRoute(ctx.profile, { name: 'demo' })

  await writeFile(join(ctx.directory, 'SKILL.md'), 'edited by hand\n', 'utf8')

  const preview = await previewGitRoute(ctx.profile, { name: 'demo', ref: 'HEAD' })
  assert.equal(preview.body.ok, false)
  assert.equal(preview.body.reason, 'local-modifications')

  const update = await updateGitRoute(ctx.profile, { name: 'demo', ref: 'HEAD' })
  assert.equal(update.status, 409)
  assert.equal(update.body.error, 'local-modifications')
  assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), 'edited by hand\n')
})

gitTest('a bundled Skill cannot be registered', async () => {
  const ctx = await setup()
  const host = fakeHost([{ name: 'demo', directory: ctx.directory, source: 'bundled' }])
  const result = await registerGitRoute(host, ctx.profile, {
    name: 'demo',
    remote: ctx.repo,
    subpath: 'skills/demo',
  })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'bundled-skill')
})

gitTest('an unregistered Skill is named as unknown rather than guessed', async () => {
  const ctx = await setup()
  const host = fakeHost([])
  const result = await registerGitRoute(host, ctx.profile, {
    name: 'demo',
    remote: ctx.repo,
    subpath: 'skills/demo',
  })
  assert.equal(result.status, 404)
  assert.equal(result.body.error, 'unknown-skill')
})

gitTest('unregistering leaves the directory alone', async () => {
  const ctx = await setup()
  const host = fakeHost([{ name: 'demo', directory: ctx.directory }])
  await registerGitRoute(host, ctx.profile, { name: 'demo', remote: ctx.repo, subpath: 'skills/demo', ref: 'baseline' })
  await updateGitRoute(ctx.profile, { name: 'demo' })
  const before = await readFile(join(ctx.directory, 'SKILL.md'), 'utf8')

  const removed = await unregisterGitRoute(ctx.profile, { name: 'demo' })
  assert.equal(removed.status, 200)
  assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), before)
  assert.equal((await listGitSkills(host, ctx.profile)).body.skills.length, 0)
})

gitTest('a restore to a commit the cache does not hold is refused by name', async () => {
  const ctx = await setup()
  const host = fakeHost([{ name: 'demo', directory: ctx.directory }])
  await registerGitRoute(host, ctx.profile, { name: 'demo', remote: ctx.repo, subpath: 'skills/demo', ref: 'baseline' })
  await updateGitRoute(ctx.profile, { name: 'demo' })
  const before = await readFile(join(ctx.directory, 'SKILL.md'), 'utf8')

  const result = await restoreGitRoute(ctx.profile, { name: 'demo', revision: 'deadbeef' })
  assert.equal(result.status, 409)
  assert.equal(result.body.error, 'revision-not-in-cache')
  assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), before)
})

/** @param {string} directory */
async function readDirNames(directory) {
  return (await readdir(directory)).sort()
}
