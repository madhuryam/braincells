import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { CalendarEvent, Item, Link, AttachedLink } from '@shared/types'
import { useLiveQuery, useMutate } from '../state/data'
import { useLabels } from '../state/labels'
import { Card } from '../components/Card'
import { ItemCard } from '../components/ItemCard'
import { LinkChips } from '../components/LinkChips'
import { extractLinksFromHtml } from '../links'
import { PrepPicker } from '../components/PrepPicker'
import { ProjectPicker } from '../components/ProjectPicker'
import { BackButton, CheckableInput, Checkbox, ProgressBar } from '../components/bits'
import { RichEditor } from '../components/RichEditor'
import { itemBodyHtml } from '../richtext'
import { ampm, prettyDate } from '../format'

interface MeetingProps {
  eventKey: string
  title: string
  date: string
  /** Compact rendering for the detail panel: no header, sections stacked. */
  embedded?: boolean
}

/**
 * The meeting loop (SPEC §4.3): prep checklist, markdown notes, and
 * follow-ups that are real tasks from the moment they're typed.
 * Everything here is linked to the calendar event by its stable key,
 * so this screen works identically for past meetings and survives the
 * event being deleted from the calendar.
 */
export function Meeting({ eventKey, title, date, embedded = false }: MeetingProps): React.JSX.Element {
  const preps = useLiveQuery(() => window.api.itemsForEvent(eventKey, 'prep-for'), [eventKey]) ?? []
  // Lineage for each prep item, so a linked SUBTASK doesn't render as
  // its own standalone card (see the grouping below — same idea as the
  // Done section).
  const prepIds = preps.map((p) => p.item.id).join(',')
  const prepAncestry = useLiveQuery(async () => {
    const lists = await Promise.all(preps.map((p) => window.api.ancestorsOf(p.item.id)))
    return new Map(preps.map((p, i) => [p.item.id, lists[i]]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepIds])
  // undefined = still loading; the editor must not mount until we know
  // whether notes exist, or it would seed itself empty.
  const notesQuery = useLiveQuery(() => window.api.itemsForEvent(eventKey, 'notes-for'), [eventKey])
  const followUps =
    useLiveQuery(() => window.api.itemsForEvent(eventKey, 'follow-up-from'), [eventKey]) ?? []
  const meeting = useLiveQuery(() => window.api.getMeeting(eventKey), [eventKey])
  // Navigation only carries title/date; start–end times come from the
  // live calendar event (absent if it was deleted — then no times).
  const dayEvents = useLiveQuery(() => window.api.calendarEvents(date, date), [date]) ?? []
  const liveEvent = dayEvents.find((e) => e.eventKey === eventKey)
  const timeLabel = liveEvent?.startTime
    ? ` · ${ampm(liveEvent.startTime)}${liveEvent.endTime ? `–${ampm(liveEvent.endTime)}` : ''}`
    : ''
  // The event's Google label — quietly shown; project matters more.
  const labels = useLabels()
  const label = liveEvent ? labels.of(liveEvent) : undefined
  const mutate = useMutate()

  const [prepDraft, setPrepDraft] = useState('')
  const [followUpDraft, setFollowUpDraft] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const noteItem = notesQuery?.[0]?.item ?? null
  // The editor stays mounted across saves (keyed by eventKey), so the
  // current note item lives in a ref the debounced save reads.
  const noteItemRef = useRef<Item | null>(null)
  useEffect(() => {
    if (noteItem) noteItemRef.current = noteItem
  }, [noteItem])

  // The minimal event identity needed for links and snapshots.
  const event: CalendarEvent = { eventKey, title, date, startTime: null, endTime: null }

  // Like follow-ups below, prep lands in the INBOX for a conscious
  // triage pass — it stays listed here via its 'prep-for' link.
  const addPrep = async (): Promise<void> => {
    const t = prepDraft.trim()
    if (!t) return
    await mutate(async () => {
      const item = await window.api.createItem({
        kind: 'prep',
        title: t,
        status: 'inbox',
        projectId: meeting?.projectId ?? null
      })
      await window.api.linkToEvent(item.id, event, 'prep-for')
    })
    setPrepDraft('')
  }

  // "Any line can be promoted to a task with one action" — here the
  // line *is* a task as soon as it's entered, linked as follow-up.
  // It lands in the INBOX (not the backlog): follow-ups deserve a
  // conscious triage pass to pick their day.
  const addFollowUp = async (): Promise<void> => {
    const t = followUpDraft.trim()
    if (!t) return
    await mutate(async () => {
      const item = await window.api.createItem({
        kind: 'task',
        title: t,
        status: 'inbox',
        projectId: meeting?.projectId ?? null
      })
      await window.api.linkToEvent(item.id, event, 'follow-up-from')
    })
    setFollowUpDraft('')
  }

  // Notes autosave, 600ms after the last keystroke. The note item is
  // created lazily on first write and reused from then on.
  const pendingNotes = useRef<{ html: string; text: string } | null>(null)
  const notesTimer = useRef<number | undefined>(undefined)
  const flushNotes = async (): Promise<void> => {
    const p = pendingNotes.current
    pendingNotes.current = null
    if (!p) return
    const existing = noteItemRef.current
    if (existing) {
      await window.api.updateItem(existing.id, { richContent: p.html, content: p.text })
    } else if (p.text.trim()) {
      const item = await window.api.createItem({
        kind: 'note',
        title: `Notes — ${title}`,
        content: p.text,
        richContent: p.html,
        status: 'active'
      })
      noteItemRef.current = item // future saves update, never re-create
      await window.api.linkToEvent(item.id, event, 'notes-for')
    }
  }
  const onNotesChange = (html: string, text: string): void => {
    pendingNotes.current = { html, text }
    window.clearTimeout(notesTimer.current)
    notesTimer.current = window.setTimeout(() => mutate(flushNotes), 600)
  }
  useEffect(
    () => () => {
      window.clearTimeout(notesTimer.current)
      flushNotes() // leave the screen with nothing unsaved
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventKey]
  )

  // Progress counts prep items and their subtasks (any depth) — the
  // same number the timeline's event blocks show.
  const prepProg = useLiveQuery(() => window.api.prepProgress([eventKey]), [eventKey])?.[0]

  // A muted footnote of which calendar label the event carries.
  const labelTag = label ? (
    <span className="ev-label" title={`Calendar label: ${label.name}`}>
      <span className="ev-label-dot" style={{ background: label.hex }} />
      {label.name}
    </span>
  ) : null

  // One action assigns this meeting to a project (SPEC §4.4). The
  // picker rests collapsed, so it fits the narrow peek panel too.
  const projectSelect = (
    <ProjectPicker
      value={meeting?.projectId ?? null}
      onChange={(projectId) =>
        mutate(() => window.api.assignMeetingProject({ eventKey, title, date }, projectId))
      }
    />
  )

  return (
    <div className={embedded ? 'stack' : 'canvas'}>
      {embedded ? (
        <div className="row">
          <span className="date">
            {prettyDate(date)}
            {timeLabel}
          </span>
          {labelTag}
          {projectSelect}
        </div>
      ) : (
        <header className="canvas-header">
          <BackButton />
          <h1>{title}</h1>
          <span className="date">
            {prettyDate(date)}
            {timeLabel}
          </span>
          {labelTag}
          {projectSelect}
        </header>
      )}

      {/* The meeting's attached links (Slack, docs, …) — meeting may
          still be loading/absent; chips render from [] until then. */}
      <AttachedLinks
        event={event}
        links={meeting?.links ?? []}
        notesHtml={noteItem?.richContent ?? ''}
      />

      <div className={embedded ? 'stack' : 'today-grid'}>
        <section className="stack">
          <div className="section-label row">
            Prep
            {(prepProg?.total ?? 0) > 0 && (
              <span style={{ flex: 1, maxWidth: 120 }}>
                <ProgressBar done={prepProg!.done} total={prepProg!.total} />
              </span>
            )}
            <button
              className="btn ghost small"
              style={{ padding: '0 6px' }}
              title="Pick existing tasks as prep for this meeting"
              onClick={() => setPickerOpen(true)}
            >
              ＋
            </button>
          </div>
          <CheckableInput
            placeholder="Add a prep item…"
            value={prepDraft}
            onChange={(e) => setPrepDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPrep()}
          />
          {/* Full ItemCards, same as follow-ups (and tasks on Today):
              prep is editable in place wherever it appears. Dates stay
              off — prep is due AT this meeting, the pills would only
              repeat the header. Linked SUBTASKS don't get standalone
              cards (the Done section's rule): with a linked ancestor
              they already show inside its card's tree; otherwise they
              group under a lineage card naming their root. */}
          <PrepList preps={preps} ancestry={prepAncestry} />

          <div className="section-label">Follow-ups</div>
          <CheckableInput
            placeholder="Add a follow-up — it becomes a real task…"
            value={followUpDraft}
            onChange={(e) => setFollowUpDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFollowUp()}
          />
          <div className="item-list">
            <AnimatePresence>
              {followUps.map(({ link, item }) => (
                <ItemCard key={item.id} item={item} unlinkId={link.id} />
              ))}
            </AnimatePresence>
          </div>
        </section>

        <section className="meeting-notes">
          <div className="section-label">Notes</div>
          {notesQuery !== undefined && (
            <RichEditor
              key={eventKey}
              initialHtml={noteItem ? itemBodyHtml(noteItem) : ''}
              placeholder="Notes for this meeting — they format as you type…"
              onChange={onNotesChange}
            />
          )}
        </section>
      </div>

      {pickerOpen && <PrepPicker event={event} onClose={() => setPickerOpen(false)} />}
    </div>
  )
}

/**
 * The prep section's cards, one per ADDED item — a linked subtask never
 * becomes a standalone card. If one of its ancestors is linked too, it
 * already shows inside that card's subtask tree (rendering it again
 * put it in the section twice); otherwise it groups under a lineage
 * card that only NAMES its root — the root reads as context, not as an
 * added task (the Done section's rule).
 */
function PrepList({
  preps,
  ancestry
}: {
  preps: Array<{ link: Link; item: Item }>
  ancestry: Map<string, Item[]> | undefined
}): React.JSX.Element {
  const mutate = useMutate()
  const linkedIds = new Set(preps.map((p) => p.item.id))
  const standalone: typeof preps = []
  const roots = new Map<string, string>() // root id → title, insertion-ordered
  for (const p of preps) {
    const anc = ancestry?.get(p.item.id) ?? []
    if (anc.length === 0) standalone.push(p)
    else if (anc.some((a) => linkedIds.has(a.id))) continue
    else roots.set(anc[0].id, anc[0].title)
  }
  const linkOf = new Map(preps.map((p) => [p.item.id, p.link.id]))
  const unlink = (item: Item): void => {
    mutate(async () => {
      await window.api.deleteLink(linkOf.get(item.id)!)
      // The due date came from this meeting — it goes with the link.
      await window.api.updateItem(item.id, { dueDate: null })
    })
  }
  return (
    <div className="item-list">
      <AnimatePresence>
        {standalone.map(({ link, item }) => (
          <ItemCard key={item.id} item={item} unlinkId={link.id} showDate={false} showDue={false} />
        ))}
      </AnimatePresence>
      {[...roots].map(([rootId, rootTitle]) => (
        <PrepSubtaskGroup
          key={rootId}
          rootId={rootId}
          rootTitle={rootTitle}
          linkedIds={linkedIds}
          onUnlink={unlink}
        />
      ))}
    </div>
  )
}

/**
 * One root task's subtasks that are linked as prep, in true tree order
 * — the same shape as the Done section's lineage groups. Unfinished
 * intermediate levels are skipped, so each row indents under its
 * nearest shown ancestor.
 */
function PrepSubtaskGroup({
  rootId,
  rootTitle,
  linkedIds,
  onUnlink
}: {
  rootId: string
  rootTitle: string
  linkedIds: Set<string>
  onUnlink: (item: Item) => void
}): React.JSX.Element {
  const tree = useLiveQuery(() => window.api.subtaskTreeOf(rootId), [rootId]) ?? []
  const mutate = useMutate()

  const shown = tree.filter(({ item }) => linkedIds.has(item.id))
  const shownIds = new Set(shown.map((s) => s.item.id))
  const parentOf = new Map(tree.map((t) => [t.item.id, t.parentId]))
  const depthOf = (id: string): number => {
    let p = parentOf.get(id)
    while (p && p !== rootId) {
      if (shownIds.has(p)) return depthOf(p) + 1
      p = parentOf.get(p)
    }
    return 1
  }

  return (
    <Card>
      <div className="row">
        <span className="card-title" style={{ color: 'var(--text-soft)' }}>
          {rootTitle}
        </span>
        <span className="pill" style={{ marginLeft: 'auto' }}>
          subtasks
        </span>
      </div>
      <div className="subtasks" style={{ marginTop: 8 }}>
        {shown.map(({ item: sub }) => (
          <div key={sub.id} className="subtask-row" style={{ marginLeft: (depthOf(sub.id) - 1) * 22 }}>
            <Checkbox
              checked={sub.status === 'done'}
              onToggle={() =>
                mutate(() =>
                  window.api.updateItem(sub.id, {
                    status: sub.status === 'done' ? 'active' : 'done'
                  })
                )
              }
            />
            <span className={`subtask-title${sub.status === 'done' ? ' done' : ''}`}>{sub.title}</span>
            <button
              className="btn ghost small"
              style={{ marginLeft: 'auto' }}
              title="No longer prep for this meeting"
              onClick={() => onUnlink(sub)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * The meeting's attached links — the Slack thread, the doc, the deck —
 * shown by name (LinkChips owns the editing rules). Hyperlinks written
 * into the meeting's notes ride along at the end, read-only. Stored
 * whole on the meetings row via setMeetingLinks.
 */
function AttachedLinks({
  event,
  links,
  notesHtml
}: {
  event: CalendarEvent
  links: AttachedLink[]
  notesHtml: string
}): React.JSX.Element {
  const mutate = useMutate()
  return (
    <LinkChips
      links={links}
      derived={extractLinksFromHtml(notesHtml)}
      onSave={(next) => mutate(() => window.api.setMeetingLinks(event, next))}
    />
  )
}
