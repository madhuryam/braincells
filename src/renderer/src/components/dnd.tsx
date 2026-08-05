import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState, type ReactNode } from 'react'
import type { CalendarEvent, Item } from '@shared/types'
import { useMutate } from '../state/data'

/*
 * One DndContext wraps the whole app (set up in App.tsx), so a card
 * can be dragged from any screen onto any target — e.g. an inbox card
 * onto a project in the sidebar. Targets describe themselves through
 * `data`, and onDragEnd interprets the combination:
 *
 *   drop target data            effect
 *   { type:'project', id }      assign item to that project
 *   { type:'schedule', date }   set scheduledDate (today/this-week/…)
 *   { type:'timeblock', time }  schedule into a time block (timeline)
 *   { type:'event-prep', ev }   attach as prep for a meeting
 *   a sortable card             reorder within the Today list
 */

interface DragData {
  item: Item
  /** Present when the card lives in a sortable list: ids in list order. */
  sortableIds?: string[]
}

/** A drag handle wrapper for cards in plain (non-sortable) lists. */
export function DraggableCard({
  item,
  children
}: {
  item: Item
  children: ReactNode
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { item } satisfies DragData
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.35 : undefined }}
    >
      {children}
    </div>
  )
}

/** Same, but for cards inside a SortableContext (the Today list). */
export function SortableCard({
  item,
  sortableIds,
  children
}: {
  item: Item
  sortableIds: string[]
  children: ReactNode
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { item, sortableIds } satisfies DragData
  })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : undefined
      }}
    >
      {children}
    </div>
  )
}

/**
 * A sidebar project row: draggable to reorder (drag past the 6px
 * threshold), and still a drop target for cards being filed into it —
 * the drop data keeps `type:'project'` so the assign path keeps working,
 * plus `projectIds` so onDragEnd can compute the reordered list.
 */
export function SortableProjectRow({
  projectId,
  projectIds,
  children
}: {
  projectId: string
  projectIds: string[]
  children: ReactNode
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({ id: projectId, data: { type: 'project', projectId, projectIds } })
  return (
    <div
      ref={setNodeRef}
      className={isOver && !isDragging ? 'drop-over' : ''}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

/** Anything a card can be dropped on. Highlights itself while hovered. */
export function DropZone({
  id,
  data,
  children,
  className = ''
}: {
  id: string
  data:
    | { type: 'project'; projectId: string }
    | { type: 'schedule'; date: string }
    | { type: 'project-schedule'; projectId: string | null; date: string }
    | { type: 'timeblock'; date: string; time: string }
    | { type: 'event-prep'; event: CalendarEvent }
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id, data })
  return (
    <div ref={setNodeRef} className={`${className} ${isOver ? 'drop-over' : ''}`.trim()}>
      {children}
    </div>
  )
}

/**
 * PointerSensor, but text-entry surfaces never start a drag —
 * otherwise selecting text in an expanded card would drag the card.
 * Buttons are deliberately NOT excluded: a card is mostly buttons
 * (title, checkbox), and the 6px activation distance already lets
 * plain clicks through — so the whole card is grabbable.
 */
class CardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }): boolean =>
        !(nativeEvent.target as HTMLElement).closest(
          'input, textarea, select, [contenteditable], .rich-editor'
        )
    }
  ]
}

export function AppDnd({ children }: { children: ReactNode }): React.JSX.Element {
  const mutate = useMutate()
  const [dragged, setDragged] = useState<Item | null>(null)

  // A small movement threshold keeps plain clicks working on cards.
  const sensors = useSensors(
    useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } })
  )

  const onDragStart = (e: DragStartEvent): void => {
    // Project drags carry no item (they just reorder the sidebar).
    setDragged((e.active.data.current as { item?: Item }).item ?? null)
  }

  const onDragEnd = (e: DragEndEvent): void => {
    setDragged(null)
    const { active, over } = e
    if (!over) return

    // A sidebar project dragged onto another project → reorder. Handled
    // first (and returns) so the project-assign branch below, which
    // shares the { type:'project' } drop data, never fires for it.
    const activeData = active.data.current as { projectIds?: string[]; item?: Item }
    if (activeData.projectIds && !activeData.item) {
      const ids = activeData.projectIds
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from >= 0 && to >= 0 && from !== to) {
        mutate(() => window.api.reorderProjects(arrayMove(ids, from, to)))
      }
      return
    }

    const { item, sortableIds } = active.data.current as DragData
    const overData = over.data.current as
      | {
          type?: string
          projectId?: string
          date?: string
          time?: string
          event?: CalendarEvent
          item?: Item
          sortableIds?: string[]
        }
      | undefined

    if (overData?.type === 'project' && overData.projectId) {
      // Dropping on a sidebar project assigns it — and triages it out
      // of the inbox if that's where it lived.
      mutate(() =>
        window.api.updateItem(item.id, {
          projectId: overData.projectId,
          ...(item.status === 'inbox' ? { status: 'active' as const } : {})
        })
      )
      return
    }

    // Time blocking (SPEC §4.6): dropping on a timeline slot sets the
    // date AND a time. Blocks are suggestions, not commitments.
    if (overData?.type === 'timeblock' && overData.date && overData.time) {
      mutate(() =>
        window.api.updateItem(item.id, {
          kind: 'task',
          scheduledDate: overData.date,
          scheduledTime: overData.time,
          ...(item.status === 'inbox' ? { status: 'active' as const } : {})
        })
      )
      return
    }

    // Dropping a card on a meeting attaches it as prep (SPEC §7).
    if (overData?.type === 'event-prep' && overData.event) {
      const event = overData.event
      mutate(async () => {
        await window.api.linkToEvent(item.id, event, 'prep-for')
        if (item.status === 'inbox') {
          await window.api.updateItem(item.id, { status: 'active' })
        }
      })
      return
    }

    // A project block inside a day list: file it there, same day.
    if (overData?.type === 'project-schedule' && overData.date) {
      mutate(() =>
        window.api.updateItem(item.id, {
          kind: 'task',
          projectId: overData.projectId ?? null,
          scheduledDate: overData.date,
          ...(item.status === 'inbox' ? { status: 'active' as const } : {})
        })
      )
      return
    }

    if (overData?.type === 'schedule' && overData.date !== undefined) {
      mutate(() =>
        window.api.updateItem(item.id, {
          kind: 'task',
          scheduledDate: overData.date || null,
          ...(item.status === 'inbox' ? { status: 'active' as const } : {})
        })
      )
      return
    }

    // Dropped on a fellow card of the same sortable list: reorder.
    if (sortableIds && overData?.item && over.id !== active.id) {
      const from = sortableIds.indexOf(String(active.id))
      const to = sortableIds.indexOf(String(over.id))
      if (from >= 0 && to >= 0) {
        mutate(() => window.api.reorderItems(arrayMove(sortableIds, from, to)))
      }
      return
    }

    // Dropped directly onto a card in another list: adopt that card's
    // home — same day, same project block.
    if (overData?.item && over.id !== active.id) {
      const target = overData.item
      mutate(() =>
        window.api.updateItem(item.id, {
          kind: 'task',
          scheduledDate: target.scheduledDate,
          projectId: target.projectId,
          ...(item.status === 'inbox' ? { status: 'active' as const } : {})
        })
      )
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {children}
      {/* The ghost card that follows the pointer during a drag. */}
      <DragOverlay dropAnimation={{ duration: 180 }}>
        {dragged && (
          <div className="card drag-ghost">
            <span className="card-title">{dragged.title || 'Untitled'}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
