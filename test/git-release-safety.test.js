import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { applyGitUpdate, exportRevision, fetchRevision, normaliseSubpath, previewGitUpdate, readRegistry, registerGitSkill, replaceDirectory } from '../lib/host/git-skill.js'
import { fingerprintTree } from '../lib/host/snapshot-store.js'
import { restoreSkillSnapshot } from '../lib/host/skill-restore.js'
import { updateGitRoute } from '../lib/host/git-routes.js'

const run = promisify(execFile)
const git = async (cwd, ...args) => (await run('git', args, { cwd, windowsHide: true })).stdout.trim()
const gitInput = (cwd, args, input) => new Promise((resolve, reject) => {
  const child = execFile('git', args, { cwd, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()))
  child.stdin.end(input)
})
test('invalid remotes retain their structured refusal before taking a cache lock', async () => {
  const result = await fetchRevision({ dshHome: tmpdir(), remote: null })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'unsupported-remote')
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vm-release-safety-'))
  const repo = join(root, 'repo')
  await mkdir(repo)
  await git(repo, 'init', '--quiet')
  await git(repo, 'config', 'user.name', 'Fixture')
  await git(repo, 'config', 'user.email', 'fixture@example.invalid')
  await git(repo, 'config', 'core.autocrlf', 'false')
  await writeFile(join(repo, 'SKILL.md'), 'A\n')
  await git(repo, 'add', 'SKILL.md')
  await git(repo, 'commit', '-qm', 'A')
  const a = await git(repo, 'rev-parse', 'HEAD')
  await git(repo, 'branch', 'baseline', a)
  const home = join(root, 'home')
  const directory = join(root, 'deployed')
  const registered = await registerGitSkill({ dshHome: home, profileId: 'p', name: 'demo', remote: repo, ref: 'baseline', directory })
  assert.equal(registered.ok, true)
  return { root, repo, home, directory, a }
}
async function commitRawTree(ctx, extra) {
  const blob = await gitInput(ctx.repo, ['hash-object', '-w', '--stdin'], 'content\n')
  const tree = await gitInput(ctx.repo, ['mktree', '-z'], `100644 blob ${blob}\tSKILL.md\0${extra(blob)}\0`)
  return git(ctx.repo, 'commit-tree', tree, '-m', 'raw tree')
}

test('Git exports reject Windows separators before creating any files', async () => {
  const ctx = await fixture()
  try {
    const revision = await commitRawTree(ctx, blob => `100644 blob ${blob}\t..\\outside.txt`)
    const into = join(ctx.root, 'staging')
    const result = await exportRevision({ cache: join(ctx.repo, '.git'), revision, subpath: '', into })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'path-escapes-target')
    await assert.rejects(readFile(join(ctx.root, 'outside.txt')))
    await assert.rejects(readFile(join(into, 'SKILL.md')))
  } finally { await rm(ctx.root, { recursive: true, force: true }) }
})

test('Git exports refuse gitlinks instead of silently dropping a submodule', async () => {
  const ctx = await fixture()
  try {
    const revision = await commitRawTree(ctx, () => `160000 commit ${ctx.a}\tdependency`)
    const result = await exportRevision({ cache: join(ctx.repo, '.git'), revision, subpath: '', into: join(ctx.root, 'staging') })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'unsupported-entry')
    await assert.rejects(readFile(join(ctx.root, 'staging', 'SKILL.md')))
  } finally { await rm(ctx.root, { recursive: true, force: true }) }
})

test('subpaths refuse drive, alternate stream and Windows alias names', () => {
  for (const path of ['C:/escape', 'skills/file:stream', 'skills/NUL.md', 'skills/CONOUT$', 'skills/COM¹', 'skills/name.', 'skills/.GIT']) {
    assert.equal(normaliseSubpath(path), null, path)
  }
})

test('the HTTP update route requires the commit from a displayed preview', async () => {
  const ctx = await fixture()
  try {
    const result = await updateGitRoute({ home: ctx.home, id: 'p' }, { name: 'demo' })
    assert.equal(result.status, 400)
    assert.equal(result.body.error, 'missing-preview-revision')
  } finally { await rm(ctx.root, { recursive: true, force: true }) }
})

test('a moved remote cannot replace the commit the caller previewed', async () => {
  const ctx = await fixture()
  try {
    assert.equal((await applyGitUpdate({ dshHome: ctx.home, profileId: 'p', name: 'demo' })).ok, true)
    const preview = await previewGitUpdate({ dshHome: ctx.home, profileId: 'p', name: 'demo', ref: 'HEAD' })
    await writeFile(join(ctx.repo, 'SKILL.md'), 'B\n')
    await git(ctx.repo, 'commit', '-qam', 'B')
    const result = await applyGitUpdate({ dshHome: ctx.home, profileId: 'p', name: 'demo', ref: 'HEAD', expectedRevision: preview.detail.to.revision })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'preview-changed')
    assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), 'A\n')
  } finally { await rm(ctx.root, { recursive: true, force: true }) }
})

test('a competing process mutation lock protects registry and skill writes', async () => {
  const ctx = await fixture()
  let handle
  try {
    const lock = join(ctx.home, 'version-manager', 'git-skills', '.write.lock')
    await mkdir(join(ctx.home, 'version-manager', 'git-skills'), { recursive: true })
    handle = await open(lock, 'wx')
    const result = await registerGitSkill({ dshHome: ctx.home, profileId: 'p', name: 'other', remote: ctx.repo, directory: join(ctx.root, 'other') })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'operation-in-progress')
    assert.deepEqual((await readRegistry(ctx.home, 'p')).map(row => row.name), ['demo'])
    const restore = await restoreSkillSnapshot({ dshHome: ctx.home, profileId: 'p', name: 'demo', directory: ctx.directory, file: 'missing' })
    assert.equal(restore.reason, 'operation-in-progress')
  } finally { await handle?.close(); await rm(ctx.root, { recursive: true, force: true }) }
})

test('a manual edit during staging is kept instead of being replaced', async () => {
  const ctx = await fixture()
  try {
    await mkdir(ctx.directory)
    await writeFile(join(ctx.directory, 'SKILL.md'), 'original\n')
    const before = await fingerprintTree(ctx.directory)
    const result = await replaceDirectory({ target: ctx.directory, expectedCurrentDigest: before.digest,
      prepare: async staging => {
        await mkdir(staging)
        await writeFile(join(staging, 'SKILL.md'), 'new\n')
        await writeFile(join(ctx.directory, 'SKILL.md'), 'manual edit\n')
        return { ok: true }
      },
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'local-modifications')
    assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), 'manual edit\n')
  } finally { await rm(ctx.root, { recursive: true, force: true }) }
})
