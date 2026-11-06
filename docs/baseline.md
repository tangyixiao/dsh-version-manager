# P0 baseline — DSH Version Manager

Recorded: 2026-11-06 (Asia/Shanghai). Every claim below was read off this machine
during that session; anything not observed is listed under "Unknown" instead of
being filled in.

## 1. What is actually installed

| Fact | Value | Evidence |
| --- | --- | --- |
| Running host | DSH Desktop `0.2.2-rc.1` | `D:\DeepSeek Harness\resources\app.asar` → `dsh/package.json` = `@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.1` |
| CLI version | `0.2.2-rc.1` | `dsh --version` |
| Electron | `44.7.0` | `D:\DeepSeek Harness\version` |
| Node (bundled) | `24.21.0` | `runtime/versions.json` |
| pnpm (bundled) | `11.28.5` | `runtime/versions.json` |
| Node (host shell) | `26.9.0` | `node -v` |
| OS | Windows 11 10.0.26300 | `[System.Environment]::OSVersion` |

The real user profile is `C:\Users\tangy\.dsh\profiles\desktop`
(`package.json` = `dsh-profile-desktop`, 35 dependencies, 47 bundles). It was
read only; nothing in it was modified while producing this document.

Do **not** treat `C:\Users\tangy\.dsh\profiles\node_modules\@deepseek-ai\dsh`
(`0.1.6-alpha.2`, mtime 2026-09-21) or the source checkout at
`D:\deepseek-harness` (`@deepseek-ai/dsh-root@0.1.6-alpha.2`, HEAD `ddefc45f`)
as the running version. Both are stale leftovers; the app.asar is the host that
is running.

## 2. Official interfaces this plugin is allowed to use

All of these live in `D:\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\`.

### 2.1 `pluginManager` — the inventory and update authority

`dsh-plugin-manager/lib/index.js` declares a Cordis service:

```js
static inject = ['loader', 'profileContext']
constructor(...) { super(ctx, 'pluginManager') }
```

Every capability is a method on that service, so a host plugin reaches it with
`ctx.get('pluginManager')` and needs no `@Remote` wiring of its own.

- `listBundles()` — the inventory. Each row carries `name`, `official`,
  `availability` (`profile` | `installation` | `missing`), `source` (the declared
  spec), `enabled`, `installed`, `version`, `error`, `updatable`,
  `readOnlyReason`. `enabled` means *the user saved that choice*, not *it loaded*;
  a load failure appears in `error`. `updatable` is computed by
  `updateRefusal(bundle, name) === undefined`.
- `updateRefusal(bundle, name)` is the real gate for "may this be updated":
  only a third-party bundle, installed in the profile, whose declared spec is a
  plain registry spec under its own name, with a semver version, is updatable.
  A `git`/`file:`/`link:`/tarball spec, an `npm:` alias, an official bundle, or a
  row the profile does not own returns a human-readable refusal string instead.
- `listVersions(name, { registry }, signal)` returns only versions *newer* than
  the installed one, newest first, each annotated with `deprecated`,
  `bundle` (does the manifest declare `dsh.bundle`) and `compatibility`.
- `updateBundle(name, version, options)` refuses an invalid or non-newer
  version, re-checks compatibility, and then removes + installs. It saves the
  target as an **exact** version. With HMR present it is remove-then-install;
  without HMR it installs over the top and reports `restart-required`.
- `inspect(spec, options, signal)`, `readBundleDetail(...)`,
  `registries()`, `listVersionExemptions()`, `installBundle(...)`,
  `removeBundle(...)`, `setBundleEnabled(...)`, `waitForInstall(...)`,
  `cancelInstall(...)`.

Documented limitations that matter to a version manager, straight from the
package README:

- An update is **two** profile operations (remove, then install). Another
  operation can run in between.
- An update saves the target as an exact version, and a failed update restores
  the previous version exactly — even if the profile had saved a range.
- With HMR, the reinstalled bundle joins the **end** of the selection, which can
  change which bundle's configuration wins.
- A new version that needs a build-script approval fails and rolls back.
- A failure can leave `node_modules` / the pnpm store in a partial state; logs
  are under `.plugin-manager/logs`.

### 2.2 Compatibility and exemptions

`dsh-app-boot/lib/index.js`:

```js
function getDshRuntimeVersion() // reads dsh-app-boot's own package.json version
function evaluatePluginCompatibility(manifest, exemptions = {}, runtimeVersion = getDshRuntimeVersion())
```

`unmetRequirements` checks `engines.dsh` **when present and only then**;
otherwise it walks `peerDependencies` for `@deepseek-ai/dsh` and
`@deepseek-ai/dsh-*`. Ranges are evaluated with `{ includePrerelease: true }`.
Exemptions live in the profile root as `compatibility.json`, shaped
`{"<pkg>@<exactVersion>": ["<dshVersion>"]}`, and are managed through
`dsh plugin --profile <p> allow-version|revoke-version|version-exemptions`.

`reportSkippedBundles(binName, profile)` writes skipped bundles to **stderr at
startup only**. There is no runtime API for "which bundles were skipped", so a
version manager must report compatibility from the manifest and from
`pluginManager`'s own rows, and must not pretend to know the startup skip list.

### 2.3 `loader` — phases

`dsh-host-plugin-inventory/lib/index.js` shows the supported pattern: iterate
`ctx.loader.entries()`, skip `options.group`, map the fiber state to
`pending|loading|active|failed|unloading|null`, and read the diagnostic after
`await fiber.await()` when the phase is `failed`. That is a read-only view and it
is the honest source for "installed but did not load".

### 2.4 HTTP surface for the panel

`dsh-host-webserver` `register(route)`:

- `kind: 'exact' | 'prefix'`, plus `handler(req, res)` or
  `resource(request, peer) => Response` for GET/HEAD only.
- Registering the same path twice **throws**, so a route name must be namespaced.
- There is **no server-wide authentication or origin policy**; the route owner
  must enforce its own policy.

`dsh-client-connection` provides the supported policy check:

```js
const admission = ctx.get('connection')?.admit(req)
// { rejection: 401 | 403 } outside the browser, or { peer: { principal } }
```

A third-party plugin has no route into `api-remotes` (that list is a build-time
capability set), so the panel talks to its own host routes over same-origin
`fetch`. This is exactly how `dsh-update-checker` and `dsh-wsl-tool` work.

### 2.5 Client extension points that exist in 0.2.2-rc.1

- `sidebar.panellist` — list slot, scope root. A row provides `id`, `order` and a
  `label`; the entry component draws only the icon. The sidebar itself renders
  the tooltip, the `aria-label`, `aria-current` and keyboard handling.
- `main` — keyed slot, scope root. `renderSlot('main', {}, { entryKey: panelId })`,
  so the same `id` used in `sidebar.panellist` selects the panel.
- `settings.section` — a settings page; also usable when a full panel is too
  much.
- The client bundle is a CommonJS factory registered through
  `window.__ModuleLoader__.load({ id, factory: (require) => {...} })` and must
  export `apply` and `inject`.
- `require` inside that factory is limited to the front-end's static table:
  `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
  `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`,
  `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
  `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`.
  `dsh.client.external` can only add another plugin's package row or an exact key
  from that table.

### 2.6 Skills

`dsh-skill-filesystem` scans, in priority order:

| Priority | Root |
| --- | --- |
| 100 | `<projectRoot>/.dsh/skills` |
| 200 | `<projectRoot>/.agents/skills` |
| 300 | each `customSkillDirs` entry |
| 400 | `<dshHome>/skills` (`.system` skipped) |
| 500 | `<agentsHome>/skills` |
| 600 | `bundledSkillDir` |

A skill is `<root>/<name>/SKILL.md` or `<root>/<name>.md`, one level deep, with
`name` (kebab-case) and `description` required in the front matter. The provider
watches depth 1 and invalidates on `SKILL.md` create/change/delete; changes to a
skill's supporting files are **not** watched. There is no version field in the
format and the body is re-read on every load, so a skill's "version" can only be
established from the directory it came from and a content fingerprint.

## 3. Comparable plugins, checked rather than assumed

| Plugin | Version / licence | What it actually does | Where this one differs |
| --- | --- | --- | --- |
| `dsh-update-checker` (Airmetro) | `1.7.3`, MIT | Checks host + third-party plugin updates, backs up the deployment, updates, rolls back, restarts a watchdog. Writes `package.json` + lockfile. Routes require `confirm: true` **and** a loopback source. | It owns the whole update-and-restart lifecycle. This plugin deliberately does not restart anything and does not update the host; it documents the profile state before and after and keeps a snapshot that can be verified. |
| `@michengai/dsh-skills-manager` (MichengAI) | `1.2.35`, Apache-2.0 | Reads 20+ agent skill roots, groups by source repository, fetches skill directories from GitHub on demand, previews a diff before overwriting, keeps history to restore a previous version, has a trash. | It treats a skill directory as the unit and fetches whole directories. This plugin only accepts a skill whose managed Git source and exact sub-path the user named, requires an unchanged local fingerprint, and swaps in a verified copy. |
| DSH built-in plugin manager | ships with `0.2.2-rc.1` | Install / remove / enable / disable / inspect / list newer versions. Its own README states the page has **no version picker**: changing a version means removing and reinstalling. | This plugin's reason to exist: a per-target version view, an update preview, and a snapshot taken before the change. |

The built-in manager already refuses unsafe updates and already reports
compatibility, so this plugin does not re-implement those rules; it presents them
and adds the parts the host does not offer.

## 4. Chosen approach

- **Host half** (`lib/index.js`) exposes read-only JSON routes under
  `/dsh-version-manager/`. Every route is admitted through
  `ctx.get('connection').admit(req)`; a write route additionally demands
  `confirm: true` in the body and refuses anything that is not a same-request
  explicit action. No background timers, no polling, no automatic installs.
- **Sources** classify each target from its declared spec: `registry`, `git`,
  `file`/`link`, `tarball`, `builtin`. Only `registry` under the bundle's own name
  is offered an update, and only for a stable release unless the user turns on
  prereleases.
- **Inventory** merges `pluginManager.listBundles()` with loader phases, so
  "installed", "enabled", "loaded" and "failed" stay four distinct facts.
- **Snapshot store** writes one JSON document per take under
  `<dshHome>/version-manager/snapshots/<profileId>/`, atomically via a temp file
  in the same directory plus rename, never overwriting an existing snapshot, and
  keeping the newest 20 per target. It records the profile identity, the package
  identity, the declared spec, the installed version, the source, the enabled
  state, a content fingerprint and non-secret metadata. It records no tokens,
  no credentials and no environment variables.
- **Recovery** is only offered when the snapshot's fingerprint still matches what
  is installed and the recorded spec is one the host can replay. Otherwise the
  row says `recovery_required` and explains why. Restoring a version is never
  described as rolling back configuration, a dependency tree, or an agent preset.
- **Skills** are read-only in the first release: source identification, the
  installed fingerprint, and a preview of what a named Git source would change.
  The write path is limited to a user-named managed Git source + exact skill
  sub-path + unchanged local fingerprint, uses an isolated staging directory, and
  never runs `reset --hard`, `clean`, or a forced checkout.

## 5. Unknown, and therefore not claimed

- Whether the startup skip list can be observed at runtime at all — the only
  evidence of it is a stderr line written before plugins load. Reported as
  unknown rather than inferred from compatibility alone.
- macOS and Linux behaviour: no machine was available, so those runs are
  automated tests only.
- The exact npm registry a bundle was installed from is not stored by the host.
  When it cannot be recovered, the record says so instead of guessing.
- Whether a snapshot can restore a bundle whose update also changed its
  dependency tree: it cannot be verified without a full lockfile copy, which is
  out of scope, and the UI says so.
