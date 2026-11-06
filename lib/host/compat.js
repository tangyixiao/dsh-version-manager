/**
 * Compatibility, computed the way the host computes it.
 *
 * The host decides whether a bundle may load by comparing the plugin manifest
 * against the running DSH version: `engines.dsh` when the manifest declares it,
 * otherwise the `@deepseek-ai/dsh*` peer dependencies. It evaluates with
 * prereleases included, so `0.2.2-rc.1` satisfies `>=0.2.0`.
 *
 * This module does not depend on `semver`: a profile is not guaranteed to have
 * one on its resolution path, and importing a peer at request time would make
 * the whole panel fail on a host that moved it. The range grammar below covers
 * what plugin manifests actually write. Anything it cannot read returns `null`,
 * and `null` becomes "unknown" rather than a guess — a version panel that
 * invents a verdict is worse than one that admits it does not know.
 *
 * @module dsh-version-manager/lib/host/compat
 */

/** Dependency names that tie a plugin to a DSH version. */
const DSH_PEER = /^@deepseek-ai\/dsh(?:-|$)/

/**
 * Split a version into comparable parts.
 *
 * @param {unknown} value
 * @returns {{ major: number, minor: number, patch: number, prerelease: string[] } | null}
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return null
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {number}
 */
function comparePrerelease(left, right) {
  // A release outranks any prerelease of the same version.
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const numericA = /^\d+$/.test(a)
    const numericB = /^\d+$/.test(b)
    if (numericA && numericB) {
      const diff = Number(a) - Number(b)
      if (diff !== 0) return diff < 0 ? -1 : 1
      continue
    }
    if (numericA !== numericB) return numericA ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/**
 * @param {ReturnType<typeof parseVersion>} left
 * @param {ReturnType<typeof parseVersion>} right
 * @returns {number}
 */
function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

/**
 * One comparator against one version.
 *
 * @param {string} version
 * @param {string} token - a single range term such as `>=2.0.0` or `^1.2.3`
 * @returns {boolean | null}
 */
function satisfiesTerm(version, token) {
  const trimmed = token.trim()
  if (trimmed === '' || trimmed === '*' || trimmed === 'x' || trimmed === 'X') return true

  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(trimmed)
  if (match === null) return null
  const operator = match[1] ?? '='
  const target = parseVersion(match[2])
  if (target === null) return null

  switch (operator) {
    case '=':
      return compareVersions(version, target) === 0
    case '>':
      return compareVersions(version, target) > 0
    case '>=':
      return compareVersions(version, target) >= 0
    case '<':
      return compareVersions(version, target) < 0
    case '<=':
      return compareVersions(version, target) <= 0
    case '^': {
      // ^0.2.3 stays inside 0.2.x; ^1.2.3 stays inside 1.x. Prereleases of a
      // later minor are not inside the caret range, which is what the host's
      // semver means too.
      if (compareVersions(version, target) < 0) return false
      const ceiling =
        target.major > 0
          ? { major: target.major + 1, minor: 0, patch: 0, prerelease: [] }
          : target.minor > 0
            ? { major: 0, minor: target.minor + 1, patch: 0, prerelease: [] }
            : { major: 0, minor: 0, patch: target.patch + 1, prerelease: [] }
      return compareVersions(version, ceiling) < 0
    }
    case '~': {
      if (compareVersions(version, target) < 0) return false
      const ceiling = { major: target.major, minor: target.minor + 1, patch: 0, prerelease: [] }
      return compareVersions(version, ceiling) < 0
    }
    default:
      return null
  }
}

/**
 * Does `version` satisfy `range`?
 *
 * Supports `||` unions, whitespace-separated conjunctions, and the comparators
 * npm accepts in a manifest. Unreadable input returns `null`, never `false`.
 *
 * @param {string} version
 * @param {string} range
 * @returns {boolean | null}
 */
export function satisfiesRange(version, range) {
  const parsed = parseVersion(version)
  if (parsed === null) return null
  if (typeof range !== 'string' || range.trim() === '') return null

  let sawUnknown = false
  for (const alternative of range.split('||')) {
    const terms = alternative.trim().split(/\s+/).filter((term) => term !== '')
    let all = true
    for (const term of terms) {
      const result = satisfiesTerm(parsed, term)
      if (result === null) {
        sawUnknown = true
        all = false
        break
      }
      if (result === false) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return sawUnknown ? null : false
}

/**
 * Which requirements the manifest places on the runtime.
 *
 * Mirrors the host: `engines.dsh` wins outright when present; only when it is
 * absent does the host consult `@deepseek-ai/dsh*` peers. `workspace:` ranges
 * are always satisfied — the host treats them as internal links.
 *
 * @param {any} manifest
 * @returns {{ field: string, range: string }[]}
 */
export function dshRequirements(manifest) {
  if (manifest === null || typeof manifest !== 'object') return []
  const engines = manifest.engines
  if (engines !== null && typeof engines === 'object' && typeof engines.dsh === 'string') {
    if (engines.dsh.trim() !== '') return [{ field: 'engines.dsh', range: engines.dsh }]
    return []
  }
  const peers = manifest.peerDependencies
  if (peers === null || typeof peers !== 'object') return []
  const requirements = []
  for (const [name, range] of Object.entries(peers)) {
    if (!DSH_PEER.test(name)) continue
    if (typeof range !== 'string') continue
    requirements.push({ field: `peerDependencies.${name}`, range })
  }
  return requirements
}

/**
 * @param {string} range
 * @returns {boolean}
 */
function isWorkspaceRange(range) {
  return range.startsWith('workspace:')
}

/**
 * Evaluate one manifest against the runtime.
 *
 * @param {object} input
 * @param {any} input.manifest - the installed package manifest, or null
 * @param {string | null} input.runtimeVersion
 * @param {Record<string, string[]>} [input.exemptions] - from the profile's compatibility.json
 * @param {string | null} [input.packageVersion]
 * @param {string | undefined} [input.exemptionKey]
 * @returns {{ verdict: 'satisfied' | 'unsatisfied' | 'exempted' | 'unknown', requirements: { field: string, range: string }[], unmet: { field: string, range: string }[], runtimeVersion: string | null, reason: string | null }}
 */
export function evaluateCompatibility(input) {
  const { manifest, runtimeVersion, exemptions, packageVersion, exemptionKey } = input
  const requirements = dshRequirements(manifest)

  if (manifest === null || typeof manifest !== 'object') {
    return {
      verdict: 'unknown',
      requirements: [],
      unmet: [],
      runtimeVersion: runtimeVersion ?? null,
      reason: 'The installed package manifest could not be read.',
    }
  }
  if (requirements.length === 0) {
    // No claim about DSH at all: the host accepts it, and so do we.
    return {
      verdict: 'satisfied',
      requirements: [],
      unmet: [],
      runtimeVersion: runtimeVersion ?? null,
      reason: null,
    }
  }
  if (runtimeVersion === null || runtimeVersion === undefined) {
    return {
      verdict: 'unknown',
      requirements,
      unmet: [],
      runtimeVersion: null,
      reason: 'The running DSH version is not readable from inside this host.',
    }
  }

  /** @type {{ field: string, range: string }[]} */
  const unmet = []
  let undecidable = null
  for (const requirement of requirements) {
    if (isWorkspaceRange(requirement.range)) continue
    const satisfied = satisfiesRange(runtimeVersion, requirement.range)
    if (satisfied === null) {
      undecidable = requirement
      continue
    }
    if (!satisfied) unmet.push(requirement)
  }

  if (undecidable !== null && unmet.length === 0) {
    return {
      verdict: 'unknown',
      requirements,
      unmet: [],
      runtimeVersion,
      reason: `This plugin cannot evaluate the range "${undecidable.range}" without the host's semver.`,
    }
  }
  if (unmet.length === 0) {
    return { verdict: 'satisfied', requirements, unmet: [], runtimeVersion, reason: null }
  }

  // The profile may carry an exact-version exemption granted with
  // `dsh plugin allow-version`. When it does, the host loads the bundle anyway,
  // so the panel must not report it as blocked.
  if (exemptions !== undefined && exemptions !== null && packageVersion) {
    const key = exemptionKey ?? `${input.packageName ?? ''}@${packageVersion}`
    const granted = exemptions[key]
    if (Array.isArray(granted) && granted.includes(runtimeVersion)) {
      return { verdict: 'exempted', requirements, unmet, runtimeVersion, reason: null }
    }
  }

  return {
    verdict: 'unsatisfied',
    requirements,
    unmet,
    runtimeVersion,
    reason: null,
  }
}

/**
 * Read a version out of a package manifest without trusting its shape.
 *
 * @param {unknown} manifest
 * @returns {string | null}
 */
export function manifestVersion(manifest) {
  if (manifest === null || typeof manifest !== 'object') return null
  const version = manifest.version
  return typeof version === 'string' && version !== '' ? version : null
}
