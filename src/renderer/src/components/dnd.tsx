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
import { createContext, useContext, useState, type ReactNode } from 'react'
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

/*
 * Optimistic order for sortable reorders. On drop, dnd-kit's sortable
 * transforms reset instantly, but the reordered list only comes back
 * after an IPC write + refresh — so the list would re-render in the OLD
 * DB order and the dropped card would visibly jump back before settling.
 * AppDnd publishes the target order here for the duration of the save;
 * sortable lists sort by it so the drop looks instant.
 */
const PendingOrderContext = createContext<string[] | null>(null)

/** The id order a sortable list should show while a reorder persists (null when idle). */
export function usePendingOrder(): string[] | null {
  return useContext(PendingOrderContext)
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
/** '13:45' + 30 → '14:15'. Clamped to 23:59 so a block never spills past its day. */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

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
  const [sortableDrag, setSortableDrag] = useState(false)
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)

  // A small movement threshold keeps plain clicks working on cards.
  const sensors = useSensors(
    useSensor(CardPointerSensor, { activationConstraint: { distance: 6 } })
  )

  const onDragStart = (e: DragStartEvent): void => {
    // Project drags carry no item (they just reorder the sidebar).
    const data = e.active.data.current as { item?: Item; sortableIds?: string[] }
    setDragged(data.item ?? null)
    setSortableDrag(!!data.sortableIds)
  }

  const onDragEnd = async (e: DragEndEvent): Promise<void> => {
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
      const { date, time } = overData
      // Already time-blocked on this same day? The task keeps its slot
      // and the drop creates an ADDITIONAL block — a local event that
      // points back at the task, sized by its time estimate.
      if (item.scheduledTime && item.scheduledDate === date) {
        mutate(() =>
          window.api.createLocalEvent({
            title: item.title,
            date,
            startTime: time,
            endTime: addMinutes(time, item.timeEstimateMinutes ?? 30),
            projectId: item.projectId,
            itemId: item.id
          })
        )
        return
      }
      mutate(() =>
        window.api.updateItem(item.id, {
          kind: 'task',
          scheduledDate: date,
          scheduledTime: time,
          // Give the new block a real length (the default 30-min slot)
          // so it has a duration from the moment it lands, not just a
          // render-time fallback — keep any estimate it already had.
          timeEstimateMinutes: item.timeEstimateMinutes ?? 30,
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
        const newOrder = arrayMove(sortableIds, from, to)
        // Publish the target order BEFORE the async save: the sortable
        // transforms have already reset, so without this the list snaps
        // back to the old DB order until the IPC round-trip lands.
        setPendingOrder(newOrder)
        try {
          await mutate(() => window.api.reorderItems(newOrder))
        } finally {
          // Always clear: on success the DB now matches so the swap is a
          // no-op; on failure a phantom order must not stick around.
          setPendingOrder(null)
        }
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
      <PendingOrderContext.Provider value={pendingOrder}>{children}</PendingOrderContext.Provider>
      {/* The ghost card that follows the pointer during a drag.
          For sortable reorders the drop animation is disabled: the list
          order comes back from the DB after an async round-trip, so
          dnd-kit would animate the overlay back to the card's ORIGINAL
          rect (the only position it knows pre-re-render) — a visible
          snap-back. The in-list placeholder already sits in the target
          slot, so an instant drop is the correct feel there. */}
      <DragOverlay dropAnimation={sortableDrag ? null : { duration: 180 }}>
        {dragged && (
          <div className="card drag-ghost">
            <span className="card-title">{dragged.title || 'Untitled'}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
