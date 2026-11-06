/**
 * One row per thing that can have a version, built from facts that were read
 * rather than inferred.
 *
 * The four questions a version manager has to keep apart are:
 *
 * - is it declared in the profile at all  → `availability`
 * - is the user's saved choice "on"       → `enabled`
 * - did it actually load in this process  → `phase`
 * - is it the version the profile declares → `installedVersion`
 *
 * Collapsing any two of them produces the classic wrong answer: "enabled" shown
 * as "working", or "installed" shown as "loaded". Each field below is filled
 * from exactly one source and carries its own reason when it is empty.
 *
 * @module dsh-version-manager/lib/host/inventory
 */

import { classifySpec, isPrerelease, updateRefusal } from './spec.js'

/**
 * The loader's fiber phase, as a stable name.
 *
 * Copied deliberately from the shape `dsh-host-plugin-inventory` uses, so two
 * panels in the same host cannot disagree about what "failed" means.
 */
const FIBER_PHASE = Object.freeze({
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: 'null',
  5: 'unloading',
})

/**
 * Map a numeric fiber phase onto a name.
 *
 * @param {number | undefined} state
 * @returns {string | null}
 */
export function phaseName(state) {
  if (typeof state !== 'number') return null
  return FIBER_PHASE[state] ?? 'unknown'
}

/**
 * Read the entry phases out of the loader without assuming the loader exists.
 *
 * The loader keys entries by module name. A bundle can be composed into several
 * rows, so the map is name → list of phases and the inventory reports the worst
 * one: a bundle with one active row and one failed row is not healthy.
 *
 * @param {{ loader?: { entries?: () => Iterable<any> } } | undefined} ctx
 * @returns {Promise<{ byName: Map<string, string[]>, available: boolean }>}
 */
export async function readLoaderPhases(ctx) {
  const byName = new Map()
  const loader = ctx?.loader
  if (loader === undefined || loader === null || typeof loader.entries !== 'function') {
    return { byName, available: false }
  }

  let entries
  try {
    entries = Array.from(loader.entries())
  } catch {
    return { byName, available: false }
  }

  const pending = []
  for (const entry of entries) {
    // Group rows are containers, not plugins: they carry no fiber of their own.
    if (entry?.options?.group !== undefined) continue
    const name = entry?.options?.name
    if (typeof name !== 'string') continue
    const phase = phaseName(entry?.fiber?.state)
    if (phase === null) continue
    const list = byName.get(name)
    if (list === undefined) byName.set(name, [phase])
    else list.push(phase)

    if (phase === 'failed' && typeof entry.fiber?.await === 'function') {
      pending.push(
        entry.fiber
          .await()
          .then(() => null)
          .catch((error) => describeFailure(error)),
      )
    }
  }

  const diagnostics = await Promise.all(pending)
  const first = diagnostics.find((value) => value !== null) ?? null
  return { byName, available: true, diagnostic: first }
}

/**
 * Turn a rejected fiber into a short, non-secret sentence.
 *
 * Loader errors can embed absolute paths and sometimes a stack. The panel shows
 * this in the section that is allowed to contain local paths, so it is passed
 * through, but the trailing stack is dropped: a stack is noise to a user and a
 * second place for a path to leak into a copyable report.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeFailure(error) {
  if (error === null || error === undefined) return 'The plugin failed to load.'
  const message = error instanceof Error ? error.message : String(error)
  const newline = message.indexOf('\n')
  return newline === -1 ? message : message.slice(0, newline)
}

/**
 * The worst phase in a list, in the order a user cares about.
 *
 * @param {string[] | undefined} phases
 * @returns {string | null}
 */
export function worstPhase(phases) {
  if (phases === undefined || phases.length === 0) return null
  const rank = { failed: 0, unloading: 1, pending: 2, loading: 3, unknown: 4, active: 5 }
  return [...phases].sort((a, b) => (rank[a] ?? 9) - (rank[b] ?? 9))[0]
}

/**
 * Build the plugin half of the inventory.
 *
 * @param {object} input
 * @param {object[]} input.bundles - rows from pluginManager.listBundles()
 * @param {Map<string, string[]>} input.phases
 * @param {boolean} input.phaseAvailable
 * @param {string | undefined} input.phaseDiagnostic
 * @param {string} input.profileId
 * @param {string | undefined} input.runtimeVersion
 * @returns {object[]}
 */
export function buildPluginRows(input) {
  const { bundles, phases, phaseAvailable, phaseDiagnostic, profileId, runtimeVersion } = input
  const observedAt = new Date().toISOString()

  return bundles.map((row) => {
    const parsed = classifySpec(row.source, { official: row.official })
    const refusal = updateRefusal(row, parsed)
    const rowPhases = phases.get(row.name)
    const phase = phaseAvailable ? worstPhase(rowPhases) : null

    return {
      profileId,
      kind: 'plugin',
      targetId: row.name,
      declaredSpec: typeof row.source === 'string' ? row.source : null,
      installedVersion: typeof row.version === 'string' ? row.version : null,
      source: {
        kind: parsed.kind,
        // The detail is a path, a URL or a package name. It is shown in the
        // local view and stripped from a shared report.
        detail: parsed.detail,
        registryName: parsed.name,
        registryRange: parsed.range,
      },
      enabledState: row.enabled === true ? 'enabled' : row.enabled === false ? 'disabled' : 'unknown',
      loadState: phase,
      loadStateAvailable: phaseAvailable,
      loadError: phase === 'failed' ? (phaseDiagnostic ?? row.error ?? null) : (row.error ?? null),
      // Filled in by the caller from the installed manifest. Left `unknown`
      // here on purpose: a row without a manifest is not a passing row.
      compatibility: {
        verdict: 'unknown',
        requirements: [],
        unmet: [],
        runtimeVersion: runtimeVersion ?? null,
        reason: 'The installed package manifest has not been read yet.',
        detail: typeof row.error === 'string' ? row.error : null,
      },
      recoverability: refusal === null ? 'updatable' : 'read_only',
      updateRefusal: refusal,
      official: row.official === true,
      availability: row.availability ?? 'unknown',
      prerelease: isPrerelease(row.version),
      observedAt,
    }
  })
}

/**
 * Read the declared specs out of a profile `package.json`.
 *
 * @param {unknown} manifest
 * @returns {{ dependencies: Record<string, string>, bundles: string[] }}
 */
export function readProfileManifest(manifest) {
  const dependencies = {}
  const raw = manifest?.dependencies
  if (raw !== null && typeof raw === 'object') {
    for (const [name, spec] of Object.entries(raw)) {
      if (typeof spec === 'string') dependencies[name] = spec
    }
  }
  const selected = manifest?.dsh?.profile?.bundles
  const bundles = Array.isArray(selected) ? selected.filter((name) => typeof name === 'string') : []
  return { dependencies, bundles }
}
