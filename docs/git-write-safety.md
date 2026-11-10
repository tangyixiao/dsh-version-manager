# Git skill write safety

Git updates require the full commit ID returned by `/skills/git/preview` as
`expectedRevision`. The bundled client also sends `expectedFromRevision` and
`expectedDigest` from that preview. A moved branch or changed registration/local
tree returns `preview-changed`; preview again before confirming. Requests that
omit the full preview commit return `missing-preview-revision`.

Exports validate every entry before writing the first file. Windows separators,
drive/alternate-stream syntax, device names, dot/space aliases, `.git` names and
portable case collisions are refused. Gitlinks and symbolic links are refused
instead of silently approximated or omitted.

Git registry edits, Git skill swaps and snapshot restores use the same exclusive
filesystem lock at `version-manager/git-skills/.write.lock` under the selected
DSH home. It covers separate host processes and profiles. Concurrent requests
return `operation-in-progress`. Git cache fetches have separate exclusive locks
so they cannot race on `FETCH_HEAD`.

A crashed owner can leave a lock behind. Locks are never stolen automatically:
inspect the recorded PID, confirm that no owner is still running, and only then
remove the stale lock. Refusal is safer than allowing a second writer to race.
