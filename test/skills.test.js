import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { fingerprintTree } from '../lib/host/snapshot-store.js'
import {
  directoryState,
  listSkillSnapshots,
  readGitState,
  skillUnchanged,
  snapshotSkill,
} from '../lib/host/skills.js'

async function makeSkill(root, name, files = { 'SKILL.md': '---\nname: demo\ndescription: d\n---\nbody\n' }) {
  const directory = join(root, name)
  await mkdir(directory, { recursive: true })
  for (const [file, body] of Object.entries(files)) {
    const target = join(directory, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, body, 'utf8')
  }
  return directory
}

test('skillUnchanged compares a directory against a recorded digest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(root, 'demo')
  const first = await fingerprintTree(directory)
  assert.deepEqual(await skillUnchanged(directory, first.digest), { same: true, reason: null })

  await writeFile(join(directory, 'SKILL.md'), 'changed\n', 'utf8')
  const second = await skillUnchanged(directory, first.digest)
  assert.equal(second.same, false)
  assert.match(second.reason, /changed/)
})

test('skillUnchanged reports a deleted directory instead of throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const result = await skillUnchanged(join(root, 'gone'), 'deadbeef')
  assert.equal(result.same, false)
  assert.match(result.reason, /gone/)
})

test('snapshotSkill copies the files and re-reads the copy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-home-'))
  const skills = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(skills, 'demo', {
    'SKILL.md': '---\nname: demo\ndescription: d\n---\nbody\n',
    'notes/extra.md': 'extra\n',
  })

  const result = await snapshotSkill({
    dshHome: home,
    profileId: 'test-profile',
    name: 'demo',
    directory,
    git: { managed: false, reason: 'Not inside a Git checkout.' },
  })

  assert.equal(result.manifest.kind, 'skill')
  assert.equal(result.manifest.skill.name, 'demo')
  assert.equal(result.manifest.skill.fileCount, 2)
  assert.match(result.manifest.skill.digest, /^[a-f0-9]{64}$/)
  assert.equal(result.manifest.note.includes('no version field'), true)

  // The manifest is on disk and parses back.
  const raw = JSON.parse(await readFile(result.path, 'utf8'))
  assert.equal(raw.skill.digest, result.manifest.skill.digest)

  // The copy is a real copy: same digest, different location.
  const copied = join(home, 'version-manager', 'skills', 'test-profile', 'demo', raw.copy)
  const copiedDigest = await fingerprintTree(copied)
  assert.equal(copiedDigest.digest, result.manifest.skill.digest)
})

test('snapshotSkill refuses a directory that vanished', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-home-'))
  await assert.rejects(
    snapshotSkill({
      dshHome: home,
      profileId: 'p',
      name: 'demo',
      directory: join(home, 'nope'),
      git: null,
    }),
    /disappeared/,
  )
})

test('listSkillSnapshots reads back the manifests newest first', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-home-'))
  const skills = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const directory = await makeSkill(skills, 'demo')

  await snapshotSkill({ dshHome: home, profileId: 'p', name: 'demo', directory, git: null })
  await new Promise((resolve) => setTimeout(resolve, 5))
  await snapshotSkill({ dshHome: home, profileId: 'p', name: 'demo', directory, git: null })

  const list = await listSkillSnapshots(home, 'p', 'demo')
  assert.equal(list.length, 2)
  assert.ok(list[0].takenAt >= list[1].takenAt)
  assert.match(list[0].digest, /^[a-f0-9]{64}$/)
})

test('listSkillSnapshots keeps an unreadable manifest visible', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-home-'))
  const root = join(home, 'version-manager', 'skills', 'p', 'demo')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'broken.json'), '{not json', 'utf8')

  const list = await listSkillSnapshots(home, 'p', 'demo')
  assert.equal(list.length, 1)
  assert.equal(list[0].unreadable, true)
})

test('readGitState answers "not a repository" without throwing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  const state = await readGitState(root)
  assert.equal(state.managed, false)
  assert.equal(state.root, null)
  assert.equal(typeof state.reason, 'string')
})

test('directoryState distinguishes missing from present', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-skill-'))
  assert.equal(await directoryState(root), 'directory')
  assert.equal(await directoryState(join(root, 'nope')), 'missing')
  await writeFile(join(root, 'file.txt'), 'x', 'utf8')
  assert.equal(await directoryState(join(root, 'file.txt')), 'not-a-directory')
})
