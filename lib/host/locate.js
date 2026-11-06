/**
 * Where the running DSH actually lives.
 *
 * The host that loads this plugin does not hand it a directory, and a profile
 * directory holds third-party bundles only — the `@deepseek-ai/*` packages that
 * make up DSH itself sit next to the process that started it. The version the
 * host compares plugin manifests against is the version of
 * `@deepseek-ai/dsh-app-boot`'s own package, so that is what we look for.
 *
 * Nothing here is required for the plugin to work: every function returns
 * `null` rather than throwing, and callers turn `null` into "unknown".
 *
 * @module dsh-version-manager/lib/host/locate
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, parse, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** The package whose own version the host uses as the runtime version. */
export const APP_BOOT_PACKAGE = '@deepseek-ai/dsh-app-boot'

/** How far up from a starting directory to look for the host's node_modules. */
const MAX_WALK = 12

/**
 * @param {string} path
 * @returns {string | null}
 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * Candidate directories that may sit beside DSH's own `node_modules`.
 *
 * Two sources are tried, in order of how directly they describe the running
 * host: the script the host was started from, then this module's own location
 * (which is inside the host tree when the plugin was installed with it, and
 * inside a profile when it was not).
 *
 * @returns {string[]}
 */
function candidateRoots() {
  const roots = []
  const argv1 = process.argv[1]
  if (typeof argv1 === 'string' && argv1 !== '') {
    try {
      roots.push(dirname(resolve(argv1)))
    } catch {
      // An unreadable argv is only a missing hint.
    }
  }
  try {
    roots.push(dirname(fileURLToPath(import.meta.url)))
  } catch {
    // A non-file module URL simply yields no hint.
  }
  const execPath = process.execPath
  if (typeof execPath === 'string' && execPath !== '') {
    roots.push(dirname(execPath))
  }
  return roots
}

/**
 * Walk up from each candidate looking for a directory that contains
 * `node_modules/@deepseek-ai`.
 *
 * @returns {string | null} the directory that owns the `node_modules`
 */
export function findHostRoot() {
  for (const start of candidateRoots()) {
    let current = start
    for (let step = 0; step < MAX_WALK; step += 1) {
      if (isDirectory(join(current, 'node_modules', '@deepseek-ai'))) return current
      const parent = dirname(current)
      if (parent === current || parent === parse(current).root) break
      current = parent
    }
  }
  return null
}

/**
 * Resolve a package manifest through the module resolver as a fallback.
 *
 * @param {string} name
 * @returns {any}
 */
function resolveManifest(name) {
  try {
    const require = createRequire(import.meta.url)
    return readJson(require.resolve(`${name}/package.json`))
  } catch {
    return null
  }
}

let cachedHost = null

/**
 * The host's own location and version, discovered once.
 *
 * @returns {{ root: string | null, runtimeVersion: string | null, source: string | null }}
 */
export function hostInfo() {
  if (cachedHost !== null) return cachedHost

  const root = findHostRoot()
  if (root !== null) {
    const manifest = readJson(join(root, 'node_modules', APP_BOOT_PACKAGE, 'package.json'))
    if (manifest !== null && typeof manifest.version === 'string') {
      cachedHost = { root, runtimeVersion: manifest.version, source: `${APP_BOOT_PACKAGE}/package.json` }
      return cachedHost
    }
  }

  const resolved = resolveManifest(APP_BOOT_PACKAGE)
  if (resolved !== null && typeof resolved.version === 'string') {
    cachedHost = { root, runtimeVersion: resolved.version, source: 'module resolution' }
    return cachedHost
  }

  cachedHost = { root, runtimeVersion: null, source: null }
  return cachedHost
}

/**
 * Read an installed package manifest from the two places a bundle can live.
 *
 * @param {string} name
 * @param {{ profileDir?: string | null, hostRoot?: string | null }} where
 * @returns {any}
 */
export function readInstalledManifest(name, where) {
  const { profileDir, hostRoot } = where
  if (typeof name !== 'string' || name === '') return null
  for (const base of [profileDir, hostRoot]) {
    if (typeof base !== 'string' || base === '') continue
    const manifest = readJson(join(base, 'node_modules', name, 'package.json'))
    if (manifest !== null) return manifest
  }
  return resolveManifest(name)
}

/**
 * Forget the cached host. Only tests need this.
 */
export function resetHostCache() {
  cachedHost = null
}
