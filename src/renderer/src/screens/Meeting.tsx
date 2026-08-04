import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { CalendarEvent, Item } from '@shared/types'
import { useLiveQuery, useMutate } from '../state/data'
import { ItemCard } from '../components/ItemCard'
import { ProjectPicker } from '../components/ProjectPicker'
import { BackButton, CheckableInput, EmptyState, ProgressBar } from '../components/bits'
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
  const mutate = useMutate()

  const [prepDraft, setPrepDraft] = useState('')
  const [followUpDraft, setFollowUpDraft] = useState('')
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

  // One action assigns this meeting to a project (SPEC §4.4).
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
          {projectSelect}
        </header>
      )}

      <div className={embedded ? 'stack' : 'today-grid'}>
        <section className="stack">
          <div className="section-label row">
            Prep
            {(prepProg?.total ?? 0) > 0 && (
              <span style={{ flex: 1, maxWidth: 120 }}>
                <ProgressBar done={prepProg!.done} total={prepProg!.total} />
              </span>
            )}
          </div>
          <CheckableInput
            placeholder="Add a prep item…"
            value={prepDraft}
            onChange={(e) => setPrepDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPrep()}
          />
          {/* Full ItemCards, same as follow-ups (and tasks on Today):
              prep is editable in place wherever it appears. */}
          <div className="item-list">
            <AnimatePresence>
              {preps.map(({ item }) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>

          <div className="section-label">Follow-ups</div>
          <CheckableInput
            placeholder="Add a follow-up — it becomes a real task…"
            value={followUpDraft}
            onChange={(e) => setFollowUpDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFollowUp()}
          />
          <div className="item-list">
            <AnimatePresence>
              {followUps.map(({ item }) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
          {followUps.length === 0 && preps.length === 0 && (
            <EmptyState art="📝">no todos here</EmptyState>
          )}
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
    </div>
  )
}
