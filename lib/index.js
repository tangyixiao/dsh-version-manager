/**
 * The host half.
 *
 * DSH loads this through the profile's patch file as a Cordis plugin, so the
 * export shape is the one the loader reads: `name`, `inject`, `apply`. Nothing
 * here writes to the profile on its own — the routes do, and only when a request
 * asked for it.
 *
 * @module dsh-version-manager
 */

import { registerRoutes } from './host/routes.js'

/** Loader row name. Matches the `id` in cordis.patch.yml, not the package name. */
export const name = 'version-manager'

/**
 * Services this plugin reads. `webServer` is required for the panel to exist at
 * all; `pluginManager` and `connection` are looked up at request time so that a
 * host without them degrades to "unavailable" instead of failing to load.
 */
export const inject = ['webServer']

/**
 * @param {any} ctx
 */
export function apply(ctx) {
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.webServer
    if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') {
      // An older host without a webserver simply gets no version panel, and the
      // rest of DSH is untouched.
      return
    }
    const disposers = registerRoutes(ctx, { webServer })
    if (typeof scope.effect === 'function') {
      scope.effect(() => () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // A route already removed during teardown is not an error worth
            // surfacing; the goal is only to leave nothing behind.
          }
        }
      }, 'dsh-version-manager: routes')
    }
  })
}
