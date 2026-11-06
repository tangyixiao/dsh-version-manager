/**
 * Reading a declared install spec as one of the kinds DSH can actually mean.
 *
 * The profile's `package.json` is the only place a declared spec survives, and
 * it is a flat string: `1.2.3`, `^1.2.3`, `file:./x.tgz`, `git+https://...`,
 * `npm:other@1`, `workspace:*`. Everything the panel shows about "where did this
 * come from" and "may I update it" is derived here rather than guessed at the
 * call site, so there is exactly one answer to that question.
 *
 * A wrong answer here is worse than no answer: claiming a `file:` tarball is a
 * registry package would offer the user an update that cannot work. When the
 * shape is not recognised the kind is `unknown` and the panel says so.
 *
 * @module dsh-version-manager/lib/host/spec
 */

/** Install kinds this module can prove. */
export const SPEC_KINDS = Object.freeze([
  'registry',
  'git',
  'file',
  'link',
  'tarball',
  'workspace',
  'alias',
  'builtin',
  'unknown',
])

/** Kinds an update may ever be offered for. Everything else is read-only. */
export const UPDATABLE_KINDS = Object.freeze(['registry'])

const ARCHIVE = /\.(tgz|tar\.gz|tar|zip)$/i
const SHORTHAND = /^[\w.-]+\/[\w.-]+(#[^\s]+)?$/
const GIT_PREFIX = /^(git\+|git@|github:|gitlab:|bitbucket:|ssh:)/i

/**
 * Split an npm registry spec into name and range.
 *
 * A scoped name starts with `@`, so the version separator is the first `@`
 * *after* the scope's closing slash. Splitting on the last `@` would also work
 * for `@scope/name@1.2.3`, but not for a name that itself contains no slash, and
 * splitting on the first `@` would mangle every scoped package.
 *
 * @param {string} spec
 * @returns {{ name: string, range: string | null }}
 */
export function splitRegistrySpec(spec) {
  const at = spec.indexOf('@')
  if (at > 0) return { name: spec.slice(0, at), range: spec.slice(at + 1) || null }
  if (at === 0) {
    const slash = spec.indexOf('/')
    if (slash === -1) return { name: spec, range: null }
    const separator = spec.indexOf('@', slash)
    if (separator === -1) return { name: spec, range: null }
    return { name: spec.slice(0, separator), range: spec.slice(separator + 1) || null }
  }
  return { name: spec, range: null }
}

/**
 * Classify one declared spec.
 *
 * @param {string} spec
 * @param {{ official?: boolean, version?: string | null }} [context]
 * @returns {{ kind: string, name: string | null, range: string | null, detail: string | null }}
 */
export function classifySpec(spec, context = {}) {
  if (context.official === true) {
    return { kind: 'builtin', name: null, range: null, detail: null }
  }
  if (typeof spec !== 'string' || spec.trim() === '') {
    // No declared spec at all. The row may still have an installed version, but
    // there is nothing to replay and nothing to compare against a registry.
    return { kind: 'unknown', name: null, range: null, detail: null }
  }

  const value = spec.trim()

  if (/^file:/i.test(value)) {
    const path = value.slice(5)
    return {
      kind: ARCHIVE.test(path) ? 'tarball' : 'file',
      name: null,
      range: null,
      detail: path,
    }
  }
  if (/^link:/i.test(value)) {
    return { kind: 'link', name: null, range: null, detail: value.slice(5) }
  }
  if (/^workspace:/i.test(value)) {
    return { kind: 'workspace', name: null, range: null, detail: value }
  }
  if (/^npm:/i.test(value)) {
    const inner = splitRegistrySpec(value.slice(4))
    return { kind: 'alias', name: inner.name, range: inner.range, detail: value }
  }
  if (/^https?:\/\//i.test(value)) {
    // A remote archive and a remote repository are different operations and
    // different risks; only the URL shape separates them.
    return {
      kind: ARCHIVE.test(value) || /\/tarball\//i.test(value) ? 'tarball' : 'git',
      name: null,
      range: null,
      detail: value,
    }
  }
  if (GIT_PREFIX.test(value)) {
    return { kind: 'git', name: null, range: null, detail: value }
  }
  if (SHORTHAND.test(value)) {
    return { kind: 'git', name: null, range: null, detail: value }
  }

  const { name, range } = splitRegistrySpec(value)
  if (name === '' || name.includes(':') || name.includes('/') && !name.startsWith('@')) {
    return { kind: 'unknown', name: null, range: null, detail: value }
  }
  return { kind: 'registry', name, range, detail: null }
}

/**
 * Is this spec an exact version pin (`1.2.3`), as opposed to a range?
 *
 * @param {string | null} range
 * @returns {boolean}
 */
/**
 * Decide whether the install spec the host reports and the range the profile
 * manifest records describe the same install.
 *
 * The host reports "name@range" while the manifest stores the bare range, so a
 * raw string comparison reports drift on every ordinary install. Compare the
 * range half, and fall back to the two documented spellings.
 *
 * @param {string | null} declaredSpec the spec the host reports
 * @param {string | null} observedRange the range the profile manifest records
 * @param {string} name the package name
 * @returns {boolean}
 */
export function declaredSpecMatches(declaredSpec, observedRange, name) {
  if (declaredSpec === null || observedRange === null) return false
  if (declaredSpec === observedRange) return true
  if (`${name}@${observedRange}` === declaredSpec) return true
  return splitRegistrySpec(declaredSpec).range === observedRange
}

/**
 * Turn a declared install spec into the short phrase a row shows.
 *
 * "no declared spec" is a real answer for bundles that ship with DSH or that
 * the host resolves from the installation, so callers must not invent one.
 *
 * @param {{ kind: string, name: string | null, range: string | null, detail: string | null }} parsed
 * @param {string | null} declaredSpec
 * @returns {{ key: string, value: string | null }}
 */
export function sourceSummary(parsed, declaredSpec) {
  if (declaredSpec === null || declaredSpec === undefined) return { key: 'noDeclaredSpec', value: null }
  if (parsed.kind === 'builtin') return { key: 'builtin', value: null }
  if (parsed.kind === 'registry') return { key: 'registry', value: declaredSpec }
  if (parsed.kind === 'unknown') return { key: 'unknownSource', value: declaredSpec }
  return { key: 'otherSource', value: declaredSpec }
}

export function isExactVersion(range) {
  return typeof range === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(range)
}

/**
 * Is this version a prerelease (`0.2.2-rc.1`)?
 *
 * The default update path must not silently move a user onto a prerelease, so
 * the question is asked of the version string and of nothing else.
 *
 * @param {string | null | undefined} version
 * @returns {boolean}
 */
export function isPrerelease(version) {
  return typeof version === 'string' && /-\S/.test(version)
}

/**
 * Why a target cannot be updated, in the words the panel will show.
 *
 * This mirrors the host's own gate rather than inventing a second one: a target
 * the host will refuse must be refused here too, and for the same reason.
 *
 * @param {object} row - a bundle row from pluginManager.listBundles()
 * @param {{ kind: string, name: string | null }} parsed
 * @returns {string | null} a reason code, or null when an update is allowed
 */
export function updateRefusal(row, parsed) {
  if (row.official === true) return 'official-bundle'
  if (row.availability !== 'profile') return 'not-installed-here'
  if (row.installed !== true) return 'not-installed'
  if (row.readOnlyReason !== undefined) {
    return `read-only:${row.readOnlyReason}`
  }
  if (row.source === undefined) return 'no-declared-spec'
  if (parsed.kind === 'alias') {
    // `npm:other@1` pins a different package behind this name. Installing it
    // again would swap what the profile actually depends on.
    return 'alias-substitution'
  }
  if (parsed.kind !== 'registry') {
    return `not-registry:${parsed.kind}`
  }
  if (parsed.name !== row.name) {
    return 'name-substitution'
  }
  if (parsed.range !== null && parsed.range.includes(':')) {
    // The host writes an aliased dependency as `<name>@npm:<other>@<range>`, so
    // the alias hides inside the range rather than at the head of the spec.
    if (/^npm:/i.test(parsed.range)) {
      return 'alias-substitution'
    }
    return 'range-with-scheme'
  }
  if (typeof row.version !== 'string' || row.version === '') {
    return 'no-installed-version'
  }
  return null
}
