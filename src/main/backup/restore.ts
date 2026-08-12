import { copyFileSync, existsSync, rmSync } from 'node:fs'
import DatabaseConstructor from 'better-sqlite3'

/**
 * A restore candidate must actually be a healthy SQLite database —
 * a renamed JPEG or a half-copied backup would otherwise clobber the
 * live data irrecoverably. Opening read-only and running quick_check
 * catches both the wrong-format and the truncated case.
 */
export function isHealthyDatabase(path: string): boolean {
  try {
    const db = new DatabaseConstructor(path, { readonly: true, fileMustExist: true })
    try {
      return db.pragma('quick_check', { simple: true }) === 'ok'
    } finally {
      db.close()
    }
  } catch {
    return false
  }
}

/**
 * Swap the live database file for `sourcePath` — deleting the WAL/SHM
 * sidecars is the critical part. Left behind, SQLite would replay the
 * *old* session's write-ahead log over the freshly restored file on
 * next launch, silently undoing the restore. (Electron-free so it's
 * unit-testable.)
 *
 * Throws (touching nothing) if the source isn't a healthy SQLite file,
 * and keeps the outgoing database beside itself as `<db>.pre-restore`,
 * so even a regretted restore is one file-copy away from undone.
 */
export function replaceDatabase(dbPath: string, sourcePath: string): void {
  if (!isHealthyDatabase(sourcePath)) {
    throw new Error('Not a valid backup: the file is not a healthy SQLite database.')
  }
  if (existsSync(dbPath)) copyFileSync(dbPath, dbPath + '.pre-restore')
  copyFileSync(sourcePath, dbPath)
  for (const suffix of ['-wal', '-shm']) {
    rmSync(dbPath + suffix, { force: true })
  }
}
