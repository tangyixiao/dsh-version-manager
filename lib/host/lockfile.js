/**
 * A deliberately small reader for the facts a pnpm lockfile does record.
 *
 * A full YAML parser is not worth carrying here: the panel needs one field, and
 * pnpm lockfiles are written in a shape where a targeted line scan is both
 * simpler and easier to reason about than a general parser. Everything this
 * module cannot find is reported as absent, never guessed.
 *
 * What pnpm v9 actually records:
 *
 * - `importers.<id>.dependencies.<name>.version` — the resolved version (or the
 *   `file:`/`link:` target) for a profile dependency.
 * - `packages.<name>@<version>.resolution.tarball` — only for installs that did
 *   not come from the default registry.
 *
 * So for an ordinary npm install the registry host is genuinely unrecorded. The
 * panel says "unknown" there rather than assuming npmjs, because a bundle the
 * user pinned to a mirror must not be described as coming from npm.
 *
 * @module dsh-version-manager/lib/host/lockfile
 */

/**
 * Extract the `resolution.tarball` recorded for one package, if any.
 *
 * @param {unknown} text
 * @param {string} name
 * @returns {string | null}
 */
export function lockfileTarball(text, name) {
  if (typeof text !== 'string' || text === '') return null
  if (typeof name !== 'string' || name === '') return null

  const lines = text.split(/\r?\n/)
  // Package keys live in the `packages:` block, indented by two spaces, and end
  // with a colon. The block ends at the next top-level key.
  let inPackages = false
  let currentIsTarget = false

  for (const line of lines) {
    if (/^[A-Za-z]/.test(line)) {
      inPackages = line.startsWith('packages:')
      currentIsTarget = false
      continue
    }
    if (!inPackages) continue

    const keyMatch = /^ {2}(\S.*):\s*$/.exec(line)
    if (keyMatch !== null) {
      const key = keyMatch[1].replace(/^['"]|['"]$/g, '')
      // `dsh-version-manager@file:...` and `@scope/name@1.2.3` both name the
      // package before the last `@`.
      const at = key.lastIndexOf('@')
      const keyName = at > 0 ? key.slice(0, at) : key
      currentIsTarget = keyName === name
      continue
    }
    if (!currentIsTarget) continue

    const tarballMatch = /\btarball:\s*['"]?([^,'"\s}]+)['"]?/.exec(line)
    if (tarballMatch !== null) return tarballMatch[1]
  }
  return null
}

/**
 * The registry identity of a tarball URL: scheme, host, and trailing slash.
 *
 * @param {unknown} tarball
 * @returns {string | null}
 */
export function registryOfTarball(tarball) {
  if (typeof tarball !== 'string' || tarball === '') return null
  try {
    const url = new URL(tarball)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return `${url.protocol}//${url.host}/`
  } catch {
    return null
  }
}

/**
 * Resolve one package's registry, with a reason when it cannot be known.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string | null} input.lockText
 * @param {string | null} input.declaredSpec
 * @param {boolean} input.lockfileReadable
 * @returns {{ registry: string | null, reason: string | null }}
 */
export function registryFor(input) {
  const { name, lockText, declaredSpec, lockfileReadable } = input

  const tarball = lockfileTarball(lockText, name)
  if (tarball !== null) {
    const registry = registryOfTarball(tarball)
    if (registry !== null) return { registry, reason: null }
  }

  if (typeof declaredSpec === 'string') {
    // An explicit `--registry` install ends up in the lockfile as an https
    // tarball, which the branch above already handled. Anything left is either
    // a default-registry install (host unrecorded) or a non-registry source.
    if (/^(file|link|workspace|portal):/i.test(declaredSpec)) {
      return { registry: null, reason: 'Installed from a local path, not a registry.' }
    }
    if (/^(git|github|gitlab|bitbucket|gist)[:+]|^git@|^https?:\/\/[^/]+\/[^/]+\/[^/#]+(?:\.git)?/i.test(declaredSpec)) {
      return { registry: null, reason: 'Installed from Git, not a registry.' }
    }
    if (/\.(?:tgz|tar\.gz)(?:#.*)?$/i.test(declaredSpec)) {
      return { registry: null, reason: 'Installed from a tarball, not a registry.' }
    }
  }

  if (lockfileReadable !== true) {
    return { registry: null, reason: 'No lockfile was readable for this profile.' }
  }
  return {
    registry: null,
    reason: 'The lockfile records no tarball URL, so the registry host is not stored for this package.',
  }
}
