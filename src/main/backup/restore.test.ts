import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../store'
import { replaceDatabase } from './restore'

describe('restore', () => {
  it('replaces the database and clears stale WAL sidecars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'braincells-restore-'))

    // The live database, with current-session data…
    const dbPath = join(dir, 'app.sqlite3')
    const live = new Store(dbPath)
    live.createItem({ kind: 'task', title: 'current session' })
    live.close()

    // …a backup with different content…
    const backupPath = join(dir, 'backup.sqlite3')
    const backup = new Store(backupPath)
    backup.createItem({ kind: 'task', title: 'from the backup' })
    backup.close()

    // …and leftover sidecars from the old session. Without deleting
    // them, SQLite replays the old WAL over the restored file.
    writeFileSync(`${dbPath}-wal`, 'stale wal')
    writeFileSync(`${dbPath}-shm`, 'stale shm')

    replaceDatabase(dbPath, backupPath)

    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)
    const restored = new Store(dbPath)
    expect(restored.allItems().map((i) => i.title)).toEqual(['from the backup'])
    restored.close()
  })
})
