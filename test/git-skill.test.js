import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  applyGitUpdate,
  describeRegistry,
  gitUpdateRefusal,
  isFetchableRemote,
  normaliseSubpath,
  previewGitUpdate,
  readRegistry,
  registerGitSkill,
  restoreGitRevision,
  treeDigest,
  unregisterGitSkill,
} from '../lib/host/git-skill.js'
import { fingerprintTree } from '../lib/host/snapshot-store.js'

const run = promisify(execFile)

/** Git is a prerequisite of this feature, so a missing binary skips the file. */
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

async function git(cwd, ...args) {
  const { stdout } = await run('git', args, { cwd, windowsHide: true })
  return stdout.trim()
}

/**
 * A repository with a Skill under `skills/<name>`, committed as A then B.
 *
 * The Skill body and file list differ between the two commits so an update and
 * a restore are visible in the bytes, not only in the recorded revision.
 */
async function makeRepo(root, name = 'demo') {
  const repo = join(root, 'repo')
  const skill = join(repo, 'skills', name)
  await mkdir(skill, { recursive: true })
  await git(root, 'init', '--quiet', repo)
  await git(repo, 'config', 'user.email', 'test@example.invalid')
  await git(repo, 'config', 'user.name', 'Test')
  // Line endings must not be rewritten on checkout, or the digest of the tree
  // would depend on the host's Git configuration.
  await git(repo, 'config', 'core.autocrlf', 'false')
  await writeFile(join(skill, 'SKILL.md'), '---\nname: demo\n---\nA\n', 'utf8')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-q', '-m', 'A')
  const a = await git(repo, 'rev-parse', 'HEAD')
  await writeFile(join(skill, 'SKILL.md'), '---\nname: demo\n---\nB\n', 'utf8')
  await writeFile(join(skill, 'extra.md'), 'added in B\n', 'utf8')
  await git(repo, 'add', '-A')
  await git(repo, 'commit', '-q', '-m', 'B')
  const b = await git(repo, 'rev-parse', 'HEAD')
  return { repo, a, b }
}

/** A home, a deployment directory, and a registration pointing at commit A. */
async function setup(name = 'demo') {
  const root = await mkdtemp(join(tmpdir(), 'vm-gitskill-'))
  const home = join(root, 'home')
  const deploy = join(root, 'deploy')
  const directory = join(deploy, name)
  await mkdir(home, { recursive: true })
  await mkdir(deploy, { recursive: true })
  const made = await makeRepo(root, name)
  // Register against commit A by name, not HEAD: HEAD is B after makeRepo.
  await git(made.repo, 'branch', '--quiet', 'baseline', made.a)
  const registered = await registerGitSkill({
    dshHome: home,
    profileId: 'p1',
    name,
    remote: made.repo,
    subpath: `skills/${name}`,
    ref: 'baseline',
    directory,
  })
  return { root, home, deploy, directory, registered, ...made }
}

gitTest('a Skill registered against an empty directory is filled on first apply', async () => {
  const ctx = await setup()
  try {
    assert.equal(ctx.registered.ok, true, ctx.registered.reason)
    // The revision is pinned but the tree is not on disk yet, so the record has
    // to say so rather than claim the Skill already holds those bytes.
    assert.equal(ctx.registered.entry.revision, ctx.a)
    assert.equal(ctx.registered.entry.populated, false)
    assert.equal(ctx.registered.entry.files, 1)

    const applied = await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo' })
    assert.equal(applied.ok, true, applied.reason)
    assert.equal(applied.toRevision, ctx.a)
    assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), '---\nname: demo\n---\nA\n')

    const [entry] = await readRegistry(ctx.home, 'p1')
    assert.equal(entry.populated, true)
    assert.equal(entry.revision, ctx.a)
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('an update moves A to B and a restore puts A back, byte for byte', async () => {
  const ctx = await setup()
  try {
    const first = await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo' })
    assert.equal(first.ok, true, first.reason)
    const atA = await fingerprintTree(ctx.directory)
    assert.equal(atA.files, 1)

    // Point the registration's ref at B by previewing an explicit revision.
    const preview = await previewGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo', ref: ctx.b })
    assert.equal(preview.ok, true, preview.reason)
    assert.equal(preview.detail.alreadyAtRevision, false)
    assert.deepEqual(
      preview.detail.changes.map((row) => [row.status, row.path]),
      [
        ['M', 'skills/demo/SKILL.md'],
        ['A', 'skills/demo/extra.md'],
      ],
    )

    const applied = await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo', ref: ctx.b })
    assert.equal(applied.ok, true, applied.reason)
    assert.equal(applied.fromRevision, ctx.a)
    assert.equal(applied.toRevision, ctx.b)
    assert.equal(await readFile(join(ctx.directory, 'extra.md'), 'utf8'), 'added in B\n')
    // A widening write leaves a snapshot behind, so B can be undone too.
    assert.notEqual(applied.snapshot, null)

    const restored = await restoreGitRevision({
      dshHome: ctx.home,
      profileId: 'p1',
      name: 'demo',
      revision: ctx.a,
    })
    assert.equal(restored.ok, true, restored.reason)
    assert.equal(restored.toRevision, ctx.a)
    assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), '---\nname: demo\n---\nA\n')
    // The file that only existed in B is gone: a restore is a replacement, not
    // a merge.
    await assert.rejects(() => readFile(join(ctx.directory, 'extra.md'), 'utf8'))
    const back = await fingerprintTree(ctx.directory)
    assert.equal(back.digest, atA.digest)
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('a file outside the Skill directory is not touched by an update', async () => {
  const ctx = await setup()
  try {
    const bystander = join(ctx.deploy, 'notes.txt')
    await writeFile(bystander, 'not yours to change\n', 'utf8')
    const before = createHash('sha256').update(await readFile(bystander)).digest('hex')

    await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo' })
    await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo', ref: ctx.b })

    const after = createHash('sha256').update(await readFile(bystander)).digest('hex')
    assert.equal(after, before)
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('editing the Skill by hand makes the next update refuse', async () => {
  const ctx = await setup()
  try {
    await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo' })
    await writeFile(join(ctx.directory, 'SKILL.md'), 'edited by hand\n', 'utf8')

    const preview = await previewGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo', ref: ctx.b })
    assert.equal(preview.ok, false)
    assert.equal(preview.reason, 'local-modifications')

    const applied = await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo', ref: ctx.b })
    assert.equal(applied.ok, false)
    assert.equal(applied.reason, 'local-modifications')
    // The edit is still there: a refused update writes nothing.
    assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), 'edited by hand\n')

    const [row] = await describeRegistry(await readRegistry(ctx.home, 'p1'))
    assert.equal(row.localModifications, true)
    assert.equal(row.refusal, 'local-modifications')
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('a directory inside a checkout is refused rather than rewritten', async () => {
  const ctx = await setup()
  try {
    // The deployed directory is made part of the repository's working tree, so
    // an update would dirty someone else's branch.
    const inside = join(ctx.repo, 'skills', 'demo')
    const refusal = gitUpdateRefusal(
      { directory: inside, remote: ctx.repo, subpath: 'skills/demo', baselineDigest: null },
      { exists: true, digest: null, inCheckout: true },
    )
    assert.equal(refusal, 'inside-git-checkout')
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('registering a directory that already holds other files is refused', async () => {
  const ctx = await setup()
  try {
    // A directory with content that is not the named commit's tree cannot be
    // given an honest baseline, so the registration is refused instead of
    // recording a revision the files do not correspond to.
    await mkdir(ctx.directory, { recursive: true })
    await writeFile(join(ctx.directory, 'stray.md'), 'not from the repository\n', 'utf8')
    const again = await registerGitSkill({
      dshHome: ctx.home,
      profileId: 'p2',
      name: 'demo',
      remote: ctx.repo,
      subpath: 'skills/demo',
      ref: ctx.a,
      directory: ctx.directory,
    })
    assert.equal(again.ok, false)
    assert.equal(again.reason, 'baseline-unknown')
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('the baseline digest is the commit tree, not whatever is on disk', async () => {
  const ctx = await setup()
  try {
    const entry = (await readRegistry(ctx.home, 'p1'))[0]
    // Registering an empty directory at commit A records A's tree, which is why
    // the first apply has something to compare against.
    const cacheEntry = entry
    const digest = await treeDigest({
      cache: join(ctx.home, 'version-manager', 'git-cache', `${createHash('sha256').update(ctx.repo).digest('hex').slice(0, 32)}.git`),
      revision: ctx.a,
      subpath: 'skills/demo',
    })
    assert.equal(digest.ok, true, digest.reason)
    assert.equal(digest.digest, cacheEntry.baselineDigest)
    assert.equal(digest.files, 1)
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('re-pointing a registration at another repository needs a removal first', async () => {
  const ctx = await setup()
  try {
    const again = await registerGitSkill({
      dshHome: ctx.home,
      profileId: 'p1',
      name: 'demo',
      remote: join(ctx.root, 'somewhere-else'),
      subpath: 'skills/demo',
      ref: ctx.a,
      directory: ctx.directory,
    })
    assert.equal(again.ok, false)
    assert.equal(again.reason, 'already-registered')

    // Removing keeps the files and clears the record.
    const removed = await unregisterGitSkill({ dshHome: ctx.home, profileId: 'p1', name: 'demo' })
    assert.equal(removed.ok, true, removed.reason)
    assert.deepEqual(await readRegistry(ctx.home, 'p1'), [])
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

gitTest('a restore to a commit the cache does not hold is refused by name', async () => {
  const ctx = await setup()
  try {
    await applyGitUpdate({ dshHome: ctx.home, profileId: 'p1', name: 'demo' })
    const restored = await restoreGitRevision({
      dshHome: ctx.home,
      profileId: 'p1',
      name: 'demo',
      revision: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    })
    assert.equal(restored.ok, false)
    assert.equal(restored.reason, 'revision-not-in-cache')
    // Nothing was written, so the directory still holds A.
    assert.equal(await readFile(join(ctx.directory, 'SKILL.md'), 'utf8'), '---\nname: demo\n---\nA\n')
  } finally {
    await rm(ctx.root, { recursive: true, force: true }).catch(() => {})
  }
})

test('normaliseSubpath keeps a plain path and refuses an escaping one', () => {
  assert.equal(normaliseSubpath('skills/demo'), 'skills/demo')
  assert.equal(normaliseSubpath('./skills/demo/'), 'skills/demo')
  assert.equal(normaliseSubpath(''), '')
  assert.equal(normaliseSubpath('..'), null)
  assert.equal(normaliseSubpath('skills/../escape'), null)
  assert.equal(normaliseSubpath('/absolute'), null)
  assert.equal(normaliseSubpath('skills/.git/config'), null)
})

test('isFetchableRemote accepts the transports Git can read from', () => {
  assert.equal(isFetchableRemote('https://github.com/owner/repo.git'), true)
  assert.equal(isFetchableRemote('git@github.com:owner/repo.git'), true)
  assert.equal(isFetchableRemote('ssh://git@host/repo'), true)
  assert.equal(isFetchableRemote('file:///C:/repos/x'), true)
  assert.equal(isFetchableRemote('C:\\repos\\x'), true)
  assert.equal(isFetchableRemote('/home/me/repo'), true)
  assert.equal(isFetchableRemote(''), false)
  assert.equal(isFetchableRemote('not a remote'), false)
})

test('a refusal names the first reason that applies', () => {
  const base = { directory: join(tmpdir(), 'skills', 'demo'), remote: 'https://example.invalid/r.git', subpath: 'skills/demo', baselineDigest: 'a'.repeat(64) }
  assert.equal(gitUpdateRefusal({ ...base, subpath: null }, { exists: true, digest: null }), 'bad-subpath')
  assert.equal(gitUpdateRefusal({ ...base, remote: 'nonsense' }, { exists: true, digest: null }), 'unsupported-remote')
  assert.equal(gitUpdateRefusal(base, { exists: true, digest: null, inCheckout: true }), 'inside-git-checkout')
  assert.equal(gitUpdateRefusal(base, { exists: true, digest: 'b'.repeat(64) }), 'local-modifications')
  assert.equal(gitUpdateRefusal(base, { exists: true, digest: 'a'.repeat(64) }), null)
  assert.equal(gitUpdateRefusal(base, { exists: false, digest: null }), null)
})
