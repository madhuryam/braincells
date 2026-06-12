import type { Store } from '../store'
import type { Item } from '../../shared/types'

/**
 * Builds the "Export as Markdown" file tree (SPEC §8): every item as a
 * human-readable .md file with a small front-matter header, plus JSON
 * files for the structure (projects, links, meetings) and a manifest.
 * Pure data-in/files-out, so it's unit-testable without Electron —
 * the caller decides where on disk it lands.
 */

export interface ExportFile {
  /** Relative path inside the export folder, e.g. 'items/task/foo.md' */
  path: string
  contents: string
}

export function buildExport(store: Store, now = new Date()): ExportFile[] {
  const projects = store.listProjects(true)
  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const items = store.allItems()
  const links = store.allLinks()
  const meetings = store.allMeetings()

  const files: ExportFile[] = []

  files.push({
    path: 'manifest.json',
    contents: pretty({
      app: 'braincells',
      exportedAt: now.toISOString(),
      counts: { projects: projects.length, items: items.length, links: links.length, meetings: meetings.length }
    })
  })
  files.push({ path: 'projects.json', contents: pretty(projects) })
  files.push({ path: 'links.json', contents: pretty(links) })
  files.push({ path: 'meetings.json', contents: pretty(meetings) })

  const seen = new Set<string>()
  for (const item of items) {
    let path = `items/${item.kind}/${itemFileName(item)}`
    // Guard against title collisions: ids make names unique anyway,
    // but be safe if an id prefix ever repeats.
    while (seen.has(path)) path = path.replace(/\.md$/, '_.md')
    seen.add(path)
    files.push({ path, contents: itemMarkdown(item, projectName) })
  }
  return files
}

function itemFileName(item: Item): string {
  const date = item.createdAt.slice(0, 10)
  const slug =
    item.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'untitled'
  return `${date}-${slug}-${item.id.slice(0, 8)}.md`
}

function itemMarkdown(item: Item, projectName: Map<string, string>): string {
  const meta: Array<[string, string | null]> = [
    ['id', item.id],
    ['kind', item.kind],
    ['status', item.status],
    ['project', item.projectId ? (projectName.get(item.projectId) ?? item.projectId) : null],
    ['created', item.createdAt],
    ['scheduled', item.scheduledDate],
    ['due', item.dueDate],
    ['completed', item.completedAt]
  ]
  const frontMatter = meta
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return `---\n${frontMatter}\n---\n\n# ${item.title}\n\n${item.content}\n`
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}
