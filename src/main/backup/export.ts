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
  const sections = store.allSections()
  const sectionName = new Map(sections.map((s) => [s.id, s.name]))
  const timeblocks = store.allLocalEvents()
  const settings = store.allSettings() // credentials already excluded

  const files: ExportFile[] = []

  files.push({
    path: 'manifest.json',
    contents: pretty({
      app: 'braincells',
      exportedAt: now.toISOString(),
      counts: {
        projects: projects.length,
        items: items.length,
        links: links.length,
        meetings: meetings.length,
        sections: sections.length,
        timeblocks: timeblocks.length,
        settings: Object.keys(settings).length
      }
    })
  })
  files.push({ path: 'projects.json', contents: pretty(projects) })
  files.push({ path: 'links.json', contents: pretty(links) })
  files.push({ path: 'meetings.json', contents: pretty(meetings) })
  files.push({ path: 'sections.json', contents: pretty(sections) })
  files.push({ path: 'timeblocks.json', contents: pretty(timeblocks) })
  files.push({ path: 'settings.json', contents: pretty(settings) })

  const seen = new Set<string>()
  for (const item of items) {
    let path = `items/${item.kind}/${itemFileName(item)}`
    // Guard against title collisions: ids make names unique anyway,
    // but be safe if an id prefix ever repeats.
    while (seen.has(path)) path = path.replace(/\.md$/, '_.md')
    seen.add(path)
    files.push({ path, contents: itemMarkdown(item, projectName, sectionName) })
    // Anything written in the rich editor (pages, card notes, meeting
    // notes) also exports its full layout as a sibling .html — the .md
    // holds the plain-text mirror, which loses tables/formatting.
    if (item.richContent) {
      files.push({ path: path.replace(/\.md$/, '.html'), contents: item.richContent })
    }
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

function itemMarkdown(
  item: Item,
  projectName: Map<string, string>,
  sectionName: Map<string, string>
): string {
  const meta: Array<[string, string | null]> = [
    ['id', item.id],
    ['kind', item.kind],
    ['status', item.status],
    ['project', item.projectId ? (projectName.get(item.projectId) ?? item.projectId) : null],
    ['section', item.sectionId ? (sectionName.get(item.sectionId) ?? item.sectionId) : null],
    ['created', item.createdAt],
    ['updated', item.updatedAt ?? null],
    ['scheduled', item.scheduledDate],
    ['scheduledTime', item.scheduledTime ?? null],
    ['estimateMinutes', item.timeEstimateMinutes != null ? String(item.timeEstimateMinutes) : null],
    ['due', item.dueDate],
    ['completed', item.completedAt],
    ['starred', item.starred ? 'true' : null],
    ['sortOrder', item.sortOrder != null ? String(item.sortOrder) : null],
    // Attached links, sparse like starred: one JSON line when present.
    ['links', item.links.length > 0 ? JSON.stringify(item.links) : null]
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
