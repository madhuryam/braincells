import { describe, expect, it } from 'vitest'
import { Store } from '../store'
import { buildExport } from './export'

describe('buildExport', () => {
  it('produces a manifest, JSON structure files, and one .md per item', () => {
    const store = new Store(':memory:')
    const project = store.createProject('Launch', '#20c997')
    const task = store.createItem({
      kind: 'task',
      title: 'Write the announcement!',
      content: 'Draft in **markdown**.',
      status: 'active',
      projectId: project.id
    })
    store.createItem({ kind: 'note', title: '' }) // untitled edge case

    const files = buildExport(store, new Date('2026-06-12T10:00:00Z'))
    const paths = files.map((f) => f.path)

    expect(paths).toContain('manifest.json')
    expect(paths).toContain('projects.json')
    expect(paths).toContain('links.json')
    expect(paths).toContain('meetings.json')
    expect(paths.filter((p) => p.endsWith('.md'))).toHaveLength(2)

    // Titles become safe slugs; the id suffix keeps names unique.
    const taskFile = files.find((f) => f.path.includes('write-the-announcement'))!
    expect(taskFile.path).toBe(
      `items/task/${task.createdAt.slice(0, 10)}-write-the-announcement-${task.id.slice(0, 8)}.md`
    )
    // Front matter + readable body, project referenced by name.
    expect(taskFile.contents).toContain('kind: task')
    expect(taskFile.contents).toContain('project: Launch')
    expect(taskFile.contents).toContain('# Write the announcement!')
    expect(taskFile.contents).toContain('Draft in **markdown**.')

    const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.contents)
    expect(manifest.counts).toMatchObject({ projects: 1, items: 2 })
  })
})
