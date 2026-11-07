# dsh-version-manager

Version management for DSH plugins and Skills, inside DeepSeek Harness.

It answers four questions about the profile you are actually running:

1. **What is installed right now** — declared spec, installed version, where it came from, whether it loaded, whether it is compatible with this host.
2. **What an update would change** — the exact versions offered, with prereleases kept apart and deprecations shown.
3. **What the state was before the change** — a snapshot with a file fingerprint, written before the host is asked to do anything.
4. **Whether it can be undone** — and when it cannot, the specific reason instead of a retry button.

The panel is a sidebar entry (`版本管理` / `Version manager`) with two tabs: plugins and Skills. It is a normal DSH bundle: nothing is patched into the host, no DOM is injected, and no private API is reached for.

## Install

```bash
dsh plugin --profile <your-profile> add dsh-version-manager@<version>
```

From a local tarball:

```bash
npm pack
dsh plugin --profile <your-profile> add /absolute/path/dsh-version-manager-0.1.0.tgz
```

Then restart the host and open the panel from the left sidebar.

Verify the bundle was installed from the tarball rather than from a stray checkout:

```bash
node -e "console.log(require('fs').readFileSync('<profile>/node_modules/dsh-version-manager/package.json','utf8'))"
```

## What it does

### Plugins tab

One row per entry the host reports, with the fields the host actually provides:

| column | meaning |
| --- | --- |
| package | the entry name the loader knows |
| installed version | the version on disk, or `未知` when the host does not know it |
| source | the declared spec, classified: registry, git, tarball, local path, alias, built into this profile, or unknown |
| load state | the loader phase: active, pending, loading, failed, unloading |
| compatibility | whether the package's own DSH version requirement is satisfied by this host |
| actions | check updates, take a snapshot |

Three states are kept apart on purpose, because collapsing them produces false confidence:

- **satisfied** — the package declares a DSH requirement and this host meets it.
- **no requirement declared** — the package declares nothing. This is not a pass; it is the absence of a claim, shown with a neutral dot.
- **unknown** — the requirement exists but could not be evaluated (for example the running version is unreadable), or the installed manifest was not read.

**Check updates** asks the host for versions newer than the installed one. Stable and prerelease are separate lists; a prerelease requires an explicit opt-in, and a row shows whether the version is still a bundle, whether it is deprecated, and what its compatibility verdict is.

**Update** always shows the from → to pair plus the four side effects before it runs:

- a snapshot is written first and read back before anything else happens;
- the host saves the target as an *exact* version, so a declared range is replaced;
- configuration, the dependency tree and agent presets are **not** rolled back;
- the host is not restarted.

### Snapshots and restore

A snapshot records the profile identity, package name, original declared spec, installed version, source (including the registry host when the lockfile records one), enabled state, compatibility verdict, and a SHA-256 fingerprint of the package directory. It does **not** record tokens, credentials, environment variables or file contents.

Snapshots live under `<DSH_HOME>/version-manager/snapshots/<profile>/<package>/`, are written through a temporary file and renamed into place, never overwrite an existing snapshot, and are retained at 20 per target (the oldest beyond that are listed, not silently deleted).

Restore is offered only when it can actually work, and only reports what happened:

| reply | meaning |
| --- | --- |
| `alreadyAtVersion: true` | the profile already carries that version; nothing was reinstalled |
| `ok: true` + `evidence.filesMatch: false` | the files had changed (normally because an update ran) and the recorded version was reinstalled |
| `409 source-not-replayable` | the snapshot came from a git, tarball or local-path install, so reinstalling it by version would be a different artifact |
| `409 source-substitution` | the snapshot belongs to a different package name |
| `409 not-installed` | the package directory cannot be read, so nothing can be fingerprinted |

Restore is **version only**. It does not roll back configuration, the dependency tree or agent presets, and it does not restore files that were edited by hand.

### Skills tab

Skills have no version field, so the panel does not invent one. For each Skill the host reports, it shows the source (project `.dsh/skills`, project `.agents/skills`, custom directories, user `.dsh/skills`, user `.agents/skills`, bundled), the file count, and the Git revision when the directory is inside a checkout, along with whether the Skill's own directory has uncommitted changes.

**Take a snapshot** copies the Skill directory into the snapshot store, re-reads the copy, and refuses to keep it when the copy does not match the digest of what was read. Skill writes (update, restore) are not in this release: a Skill has no baseline to compare against, and a wrong write would be unrecoverable.

**Restore** puts one Skill directory back to the exact bytes a snapshot recorded. Open a row's snapshot list, preview, and confirm. The preview runs before the confirmation bar, so a refusal is something you read while choosing rather than after committing. A restore is refused when:

| reason | meaning |
| --- | --- |
| `inside-git-checkout` | the directory is inside a Git working tree; this plugin never rewrites tracked files and never runs `git checkout`, `reset` or `clean` |
| `system-skill` | the path contains a `.system` segment, which the host does not discover either |
| `bundled-skill` | the Skill ships with DSH |
| `snapshot-directory-mismatch` | the snapshot records a different directory, even if the Skill has the same name |
| `snapshot-copy-corrupt` | the stored copy no longer matches its manifest digest, so it is not a baseline |
| `snapshot-copy-missing` | the stored copy is gone |
| `no-directory` | a single-file Skill has no directory to swap |

A restore that proceeds keeps a way back: it snapshots the current directory first (marked `before-restore`, shown as an "undo point"), assembles the replacement in a sibling staging directory on the same volume, re-verifies it against the same digest, and only then swaps it in with two renames — parking the old directory rather than deleting it first. Files added after the snapshot are removed: a restore is the recorded tree, not a merge with what is on disk now. The response reports `undo` so the step you just replaced can itself be restored.

The `.system` directory and anything outside the host's Skill catalog are never scanned or written. A snapshot or restore request can only name a Skill the host lists — the routes never accept a path, so they cannot be used as a directory copier.

> One consequence worth stating plainly: the host's filesystem provider is disabled in a stock profile, so in a default profile the Skills tab lists only bundled Skills unless that provider is enabled. The plugin reports `available: false` with the host's own reason rather than showing an empty list.

## Honest limits

- **A snapshot is not a profile backup.** A version restore reinstalls one package. It does not revert `package.json` ranges, the lockfile, config overlays, or the dependency tree.
- **Registry host is often unknown.** pnpm's lockfile records a tarball URL only for some packages; when it does not, the panel says the registry is not stored rather than assuming npmjs.
- **Compatibility uses the package's own declaration.** If a package declares nothing, the panel says so instead of guessing.
- **Skill writes are one direction only.** A restore replaces a directory with a recorded snapshot. There is no "update this Skill from a Git source" flow in this release: that needs a baseline the user explicitly designates, and this plugin will not guess one.
- **A Skill snapshot is a copy, not a version.** Skills have no version field, so the store keeps bytes and the Git revision separately; it never presents them as a version number.
- **`skippedBundles` is not visible at runtime.** DSH prints bundles it skipped to stderr at startup; a running plugin cannot read that list, so a bundle that never loaded is reported from the loader's own phases, with `unknown` where the host is silent.
- **Tested on Windows only** as a real host (0.2.2-rc.1, Electron 44.7.0, Node 24.21.0). Linux and macOS are covered by the unit tests, not by a running Desktop.

## Security

- Every route requires a DSH owner session (`connection.admit`); there is no unauthenticated surface.
- Every write route requires `{"confirm": true}` in the body, so a stray GET or a cross-site form post cannot change anything.
- The host, not this plugin, writes the profile. Updates go through the host's plugin manager, which owns the manifest lock and its own log.
- Skill snapshots copy only directories the host catalog lists. No request-supplied path is read, and snapshot file names are rejected when they contain `/`, `\` or `..`.
- A Skill restore is the only path that writes into a user directory. It refuses Git checkouts and `.system`, verifies both the stored copy and the staged replacement against one digest, and snapshots what it replaces first.
- Nothing is uploaded. The panel reads only what the host and the local filesystem expose.

## Routes

All under `/dsh-version-manager`, same-origin, `Cache-Control: no-store`.

| method | path | body | purpose |
| --- | --- | --- | --- |
| GET | `/overview` | — | profile, host version, plugin rows, recent operations |
| GET | `/versions?target=<name>` | — | newer versions, split into stable and prerelease |
| GET | `/skills` | — | Skill inventory with snapshot counts and a `restoreRefusal` per row |
| GET | `/skills/restore-preview?name=&file=` | — | what a restore would do, and every reason it would be refused |
| POST | `/snapshot` | `{targetId, confirm}` | snapshot one plugin |
| POST | `/update` | `{targetId, toVersion, allowPrerelease?, confirm}` | snapshot, then ask the host to update |
| POST | `/restore` | `{targetId, snapshotId, confirm}` | reinstall the version a snapshot recorded |
| POST | `/skills/snapshot` | `{name, confirm}` | snapshot one Skill |
| POST | `/skills/restore` | `{name, file, confirm}` | replace one Skill directory with the recorded bytes |

Error bodies carry a stable `error` code and, when useful, a `message`. The update and restore flows also return `operationId`, and the operation journal under `<DSH_HOME>/version-manager/operations/<profile>/` records each transition: `planned`, `snapshot_verified`, `applying`, `verifying`, then `succeeded`, `failed`, `cancelled` or `recovery_required`.

## Compatibility

| DSH | status |
| --- | --- |
| 0.2.2-rc.1 (Windows Desktop shell, Electron 44.7.0) | verified in a real host: sidebar entry, panel, plugin inventory, update, snapshot, restore |
| other 0.2.x | expected to work; the extension points used (`sidebar.panellist`, `main`, `webServer.register`, `pluginManager`, `skills`) exist across 0.2.x, but they were not exercised against another build |

## Development

```bash
npm test          # node --test, no build step
```

The panel is a hand-written browser bundle (`lib/client.js`) using the `window.__ModuleLoader__.load` contract, with `react` as its only external. The host half is plain ESM under `lib/host/`.

- `docs/baseline.md` — the P0 survey: what this host version actually exposes, what was verified against the running installation, and what could not be verified.

## License

MIT. See [LICENSE](./LICENSE).
