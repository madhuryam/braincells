import { copyFileSync, rmSync } from 'node:fs'

/**
 * Swap the live database file for `sourcePath` — deleting the WAL/SHM
 * sidecars is the critical part. Left behind, SQLite would replay the
 * *old* session's write-ahead log over the freshly restored file on
 * next launch, silently undoing the restore. (Electron-free so it's
 * unit-testable.)
 */
export function replaceDatabase(dbPath: string, sourcePath: string): void {
  copyFileSync(sourcePath, dbPath)
  for (const suffix of ['-wal', '-shm']) {
    rmSync(dbPath + suffix, { force: true })
  }
}
