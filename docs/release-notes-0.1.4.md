# 0.1.4

This patch closes the Git skill write boundaries before publishing the updated project branding.

- Validate all tree entries before writing; refuse Windows traversal/drive/alternate-stream syntax, device aliases, case collisions, symbolic links and gitlinks.
- Bind HTTP updates to the full commit ID from the displayed preview and pin that commit during execution. Changed revisions or local file digests require a new preview.
- Protect registry edits, Git updates/restores and snapshot restores with one exclusive filesystem lock across host processes; protect cache fetches separately. Locks are never stolen automatically.
- Recheck the live tree before the staging swap so manual edits are preserved.
- Include both README languages, linked banner/feature assets and artwork notices in the actual npm package.

The update HTTP contract now requires expectedRevision; the bundled client supplies it together with source revision and digest evidence. See [Git write safety](git-write-safety.md) for refusal and stale-lock recovery details. No account/profile format or Node/DSH engine range changes.

Validation records retain failing original regressions, passing repairs and the full cross-platform/Node matrix. Registry publication, GitHub assets, market deployment and local activation are independently verified after source merge.
