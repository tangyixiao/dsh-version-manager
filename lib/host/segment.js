/**
 * Turning a name from the host into one path segment, safely.
 *
 * Profile ids and package names become directory names under
 * `<DSH_HOME>/version-manager/`. Most of them are already usable as-is, so the
 * encoding stays conservative: only characters that would break a path are
 * replaced, and a name that was fine yesterday lands in the same directory
 * today. Changing the layout for ordinary names would strand every snapshot
 * already on disk.
 *
 * The case worth spelling out is `.` and `..`. Replacing `/` is not enough,
 * because `path.join(root, '..')` walks *up*, out of the plugin's own
 * directory. A segment that is nothing but dots is therefore encoded outright.
 * This cannot happen for a profile the CLI created, and it costs three lines to
 * make sure it cannot happen for one it did not.
 *
 * @module dsh-version-manager/lib/host/segment
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function encodeSegment(value) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const encoded = text.replace(/\//g, '%2F').replace(/[^A-Za-z0-9%._@-]/g, '_')
  if (encoded === '') return '_'
  // `.` and `..` (and `...`, which Windows will not keep either) are the only
  // encodings that still mean something to a filesystem.
  if (/^\.+$/.test(encoded)) return encoded.replace(/\./g, '%2E')
  return encoded
}

/**
 * Accept a name as a path segment, or say no.
 *
 * Skill names are directory names reported by the host's own catalog, and they
 * are legitimately non-ASCII — a snapshot directory called `office` and one
 * called `离线诊断` are both fine. Encoding those into ASCII would move every
 * existing snapshot to a new directory, so this path validates instead of
 * rewriting: a name that cannot be a single path segment is refused rather
 * than approximated into one.
 *
 * @param {unknown} value
 * @returns {string | null} the name, unchanged, or null when it is not usable
 */
export function safeSegment(value) {
  if (typeof value !== 'string' || value === '') return null
  if (value === '.' || value === '..') return null
  if (value.includes('/') || value.includes('\\')) return null
  if (value.includes('\0')) return null
  return value
}
