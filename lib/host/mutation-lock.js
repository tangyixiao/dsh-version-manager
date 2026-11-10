import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Atomic across host processes. Never steal a lock whose owner may still write. */
export async function withFileLock(path, operation) {
  await mkdir(dirname(path), { recursive: true })
  let handle
  try {
    handle = await open(path, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    return { ok: false, reason: 'operation-in-progress', message: 'Another operation owns the write lock.', entry: null, evidence: null, snapshot: null, cache: null, revision: null }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
    return await operation()
  } finally {
    await handle.close()
    await unlink(path)
  }
}

/** Registry edits, Git swaps and snapshot restores share one home-wide lock. */
export function withMutationLock(input, operation) {
  return withFileLock(join(resolve(input.dshHome), 'version-manager', 'git-skills', '.write.lock'), () => operation(input))
}
