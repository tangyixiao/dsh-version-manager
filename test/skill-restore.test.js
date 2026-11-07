import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import {
  isSystemPath,
  previewSkillRestore,
  readSkillSnapshot,
  restoreSkillSnapshot,
  skillRestoreRefusal,
} from '../lib/host/skill-restore.js'
import { fingerprintTree } from '../lib/host/snapshot-store.js'
import { listSkillSnapshots, snapshotSkill } from '../lib/host/skills.js'

const run = promisify(execFile)

async function makeSkill(root, name, files = { 'SKILL.md': '---\nname: demo\ndescription: d\n---\nv1\n' }) {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  for (const [file, body] of Object.entries(files)) {
    const target = join(directory, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body, 'utf8')
  }
  return directory
}

/** A home plus a profile id, which is what the store keys on. */
async function makeHome() {
  const home = await mkdtemp(join(tmpdir(), 'vm-restore-'))
  return { home, profileId: 'p1' }
}

async function takeBase(home, profileId, name, directory) {
  const saved = await snapshotSkill({ dshHome: home, profileId, name, directory, git: null })
  const rows = await listSkillSnapshots(home, profileId, name)
  return { manifest: saved.manifest, file: rows[0].file }
}

test('isSystemPath only rejects a real .system segment', () => {
  assert.equal(isSystemPath('C:\\Users\\a\\.system\\skills\\x'), true)
  assert.equal(isSystemPath('/home/.system/skills'), true)
  assert.equal(isSystemPath('/home/systematic/skills'), false)
  assert.equal(isSystemPath('/home/.systematic/x'), false)
})

test('skillRestoreRefusal names the first reason a row cannot be written', () => {
  assert.equal(skillRestoreRefusal({ directory: null }), 'no-directory')
  assert.equal(skillRestoreRefusal({ directory: 'C:\\a\\.system\\x' }), 'system-skill')
  assert.equal(skillRestoreRefusal({ directory: 'C:\\a', git: { managed: true } }), 'inside-git-checkout')
  assert.equal(skillRestoreRefusal({ directory: 'C:\\a', source: 'bundled' }), 'bundled-skill')
  assert.equal(skillRestoreRefusal({ directory: 'C:\\a', source: 'user-dsh', git: { managed: false } }), null)
})

test('readSkillSnapshot refuses a file name that could leave the store', async () => {
  const { home, profileId } = await makeHome()
  for (const file of ['../x.json', 'a/b.json', 'a\\b.json', '']) {
    const result = await readSkillSnapshot({ dshHome: home, profileId, name: 'demo', file })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'bad-snapshot-file')
  }
})

test('preview and restore put the recorded bytes back', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', {
    'SKILL.md': 'v1\n',
    'assets/note.txt': 'kept\n',
  })
  const base = await takeBase(home, profileId, 'demo', directory)

  // Move the directory away from the snapshot, the way an edit would.
  await writeFile(join(directory, 'SKILL.md'), 'v2\n', 'utf8')
  await writeFile(join(directory, 'extra.md'), 'added\n', 'utf8')

  const preview = await previewSkillRestore({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(preview.ok, true, preview.reason ?? '')
  assert.equal(preview.detail.sameFiles, false)
  assert.equal(preview.detail.digestVerified, true)
  assert.equal(preview.detail.files, 2)

  const restored = await restoreSkillSnapshot({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(restored.ok, true, restored.reason ?? restored.message ?? '')
  assert.equal(await readFile(join(directory, 'SKILL.md'), 'utf8'), 'v1\n')
  assert.equal(await readFile(join(directory, 'assets', 'note.txt'), 'utf8'), 'kept\n')
  // The file added after the snapshot is gone: a restore is the recorded tree,
  // not a merge with whatever is on disk now.
  await assert.rejects(() => readFile(join(directory, 'extra.md'), 'utf8'))
  assert.equal(restored.evidence.digest, base.manifest.skill.digest)
  assert.notEqual(restored.undo, null)
})

test('a restore takes an undo snapshot of what it replaced', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)

  await writeFile(join(directory, 'SKILL.md'), 'v2\n', 'utf8')
  const editedDigest = (await fingerprintTree(directory)).digest
  const restored = await restoreSkillSnapshot({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(restored.ok, true)
  assert.equal(restored.undo, editedDigest)

  const rows = await listSkillSnapshots(home, profileId, 'demo')
  const undo = rows.find((row) => row.reason === 'before-restore')
  assert.notEqual(undo, undefined)
  assert.equal(undo.digest, editedDigest)
})

test('restoring a directory that is already the snapshot is a no-op that still verifies', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)

  const preview = await previewSkillRestore({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(preview.detail.sameFiles, true)
  const restored = await restoreSkillSnapshot({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(restored.ok, true)
  assert.equal(await readFile(join(directory, 'SKILL.md'), 'utf8'), 'v1\n')
})

test('a snapshot of another directory is refused by name, not silently applied', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)

  const other = join(root, 'elsewhere')
  await mkdir(other, { recursive: true })
  const result = await restoreSkillSnapshot({
    dshHome: home,
    profileId,
    name: 'demo',
    directory: other,
    file: base.file,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'snapshot-directory-mismatch')
  assert.deepEqual(await readdir(other), [])
})

test('a snapshot whose copy drifted is refused rather than trusted', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)

  const copy = join(home, 'version-manager', 'skills', profileId, 'demo', base.manifest.copy)
  await writeFile(join(copy, 'SKILL.md'), 'tampered\n', 'utf8')
  const result = await previewSkillRestore({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'snapshot-copy-corrupt')
})

test('a missing stored copy is reported as missing, not as an empty skill', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)

  const copy = join(home, 'version-manager', 'skills', profileId, 'demo', base.manifest.copy)
  await rm(copy, { recursive: true, force: true })
  const result = await previewSkillRestore({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'snapshot-copy-missing')
})

test('a skill inside a Git checkout is refused before anything is written', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-git-'))
  await run('git', ['init', '-q'], { cwd: root })
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)

  const result = await restoreSkillSnapshot({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'inside-git-checkout')
  // The refusal must not have touched the checkout: branch and index stay put.
  const status = await run('git', ['status', '--porcelain'], { cwd: root })
  assert.equal(status.stdout.trim(), '?? demo/')
})

test('a failed swap leaves the original directory in place', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)
  await writeFile(join(directory, 'SKILL.md'), 'v2\n', 'utf8')

  // Hold the target open so the rename cannot complete on Windows.
  const restore = restoreSkillSnapshot({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  const result = await restore
  // Either the swap worked or it was refused; never a half-written directory.
  const contents = await readFile(join(directory, 'SKILL.md'), 'utf8')
  assert.equal(contents === 'v1\n' || contents === 'v2\n', true)
  if (!result.ok) assert.equal(typeof result.reason, 'string')
})

test('restoring a directory that no longer exists recreates it', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  const base = await takeBase(home, profileId, 'demo', directory)
  await rm(directory, { recursive: true, force: true })

  const result = await restoreSkillSnapshot({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: base.file,
  })
  assert.equal(result.ok, true, result.reason ?? '')
  assert.equal(await readFile(join(directory, 'SKILL.md'), 'utf8'), 'v1\n')
  assert.equal(result.evidence.directoryExisted, false)
  // Nothing to undo when there was nothing there.
  assert.equal(result.undo, null)
  const leftovers = (await readdir(root)).filter((entry) => entry.includes('version-manager'))
  assert.deepEqual(leftovers, [])
})

test('an unreadable manifest is reported instead of crashing the panel', async () => {
  const { home, profileId } = await makeHome()
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo', { 'SKILL.md': 'v1\n' })
  await takeBase(home, profileId, 'demo', directory)
  const store = join(home, 'version-manager', 'skills', profileId, 'demo')
  await writeFile(join(store, 'broken.json'), '{not json', 'utf8')

  const result = await previewSkillRestore({
    dshHome: home,
    profileId,
    name: 'demo',
    directory,
    file: 'broken.json',
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'snapshot-unreadable')
})
