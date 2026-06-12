import { AnimatePresence } from 'framer-motion'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { Item, Project } from '@shared/types'
import { useData } from '../state/data'
import { ItemCard } from './ItemCard'
import { DraggableCard, SortableCard } from './dnd'
import { ProjectDot } from './bits'

interface TaskGroupsProps {
  items: Item[]
  /** Per-group drag-to-reorder (used by Top tasks). */
  sortable?: boolean
}

/**
 * A day's task list, broken into one block per project (sidebar order,
 * 'No project' last). The surrounding section already names the day,
 * so cards hide their date pill; inside a block the project is in the
 * header, so cards hide their project pill too. If nothing has a
 * project, the list renders flat with no headers at all.
 */
export function TaskGroups({ items, sortable = false }: TaskGroupsProps): React.JSX.Element {
  const { projects } = useData()

  const groups: Array<{ key: string; project: Project | null; items: Item[] }> = []
  for (const p of projects) {
    const inProject = items.filter((i) => i.projectId === p.id)
    if (inProject.length > 0) groups.push({ key: p.id, project: p, items: inProject })
  }
  // No project, or the project was archived: one trailing block.
  const unassigned = items.filter((i) => !projects.some((p) => p.id === i.projectId))
  if (unassigned.length > 0) groups.push({ key: 'none', project: null, items: unassigned })

  const showHeaders = groups.some((g) => g.project !== null)

  return (
    <>
      {groups.map((group) => {
        const ids = group.items.map((i) => i.id)
        const cards = (
          <div className="stack">
            <AnimatePresence initial={false}>
              {group.items.map((item) =>
                sortable ? (
                  <SortableCard key={item.id} item={item} sortableIds={ids}>
                    <ItemCard item={item} showProject={false} showDate={false} />
                  </SortableCard>
                ) : (
                  <DraggableCard key={item.id} item={item}>
                    <ItemCard item={item} showProject={false} showDate={false} />
                  </DraggableCard>
                )
              )}
            </AnimatePresence>
          </div>
        )
        return (
          <div className="task-group" key={group.key}>
            {showHeaders && (
              <div className="task-group-header">
                {group.project ? (
                  <>
                    <ProjectDot color={group.project.color} /> {group.project.name}
                  </>
                ) : (
                  'No project'
                )}
              </div>
            )}
            {sortable ? (
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                {cards}
              </SortableContext>
            ) : (
              cards
            )}
          </div>
        )
      })}
    </>
  )
}
