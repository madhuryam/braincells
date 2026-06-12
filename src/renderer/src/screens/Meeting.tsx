import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { CalendarEvent } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { ItemCard } from '../components/ItemCard'
import { Card } from '../components/Card'
import { CheckableInput, Checkbox, EmptyState, ProgressBar } from '../components/bits'
import { prettyDate } from '../format'

interface MeetingProps {
  eventKey: string
  title: string
  date: string
}

/**
 * The meeting loop (SPEC §4.3): prep checklist, markdown notes, and
 * follow-ups that are real tasks from the moment they're typed.
 * Everything here is linked to the calendar event by its stable key,
 * so this screen works identically for past meetings and survives the
 * event being deleted from the calendar.
 */
export function Meeting({ eventKey, title, date }: MeetingProps): React.JSX.Element {
  const preps = useLiveQuery(() => window.api.itemsForEvent(eventKey, 'prep-for'), [eventKey]) ?? []
  const notes = useLiveQuery(() => window.api.itemsForEvent(eventKey, 'notes-for'), [eventKey]) ?? []
  const followUps =
    useLiveQuery(() => window.api.itemsForEvent(eventKey, 'follow-up-from'), [eventKey]) ?? []
  const meeting = useLiveQuery(() => window.api.getMeeting(eventKey), [eventKey])
  const { projects } = useData()
  const mutate = useMutate()

  const [prepDraft, setPrepDraft] = useState('')
  const [followUpDraft, setFollowUpDraft] = useState('')
  const noteItem = notes[0]?.item ?? null
  const [noteText, setNoteText] = useState('')
  useEffect(() => setNoteText(noteItem?.content ?? ''), [noteItem?.id])

  // The minimal event identity needed for links and snapshots.
  const event: CalendarEvent = { eventKey, title, date, startTime: null, endTime: null }

  const addPrep = async (): Promise<void> => {
    const t = prepDraft.trim()
    if (!t) return
    await mutate(async () => {
      const item = await window.api.createItem({ kind: 'prep', title: t, status: 'active' })
      await window.api.linkToEvent(item.id, event, 'prep-for')
    })
    setPrepDraft('')
  }

  // "Any line can be promoted to a task with one action" — here the
  // line *is* a task as soon as it's entered, linked as follow-up.
  const addFollowUp = async (): Promise<void> => {
    const t = followUpDraft.trim()
    if (!t) return
    await mutate(async () => {
      const item = await window.api.createItem({
        kind: 'task',
        title: t,
        status: 'active',
        projectId: meeting?.projectId ?? null
      })
      await window.api.linkToEvent(item.id, event, 'follow-up-from')
    })
    setFollowUpDraft('')
  }

  const saveNotes = (): void => {
    const text = noteText
    if (noteItem) {
      if (text !== noteItem.content) mutate(() => window.api.updateItem(noteItem.id, { content: text }))
    } else if (text.trim()) {
      // The note item is created lazily, the first time anything is written.
      mutate(async () => {
        const item = await window.api.createItem({
          kind: 'note',
          title: `Notes — ${title}`,
          content: text,
          status: 'active'
        })
        await window.api.linkToEvent(item.id, event, 'notes-for')
      })
    }
  }

  const prepDone = preps.filter((p) => p.item.status === 'done').length

  return (
    <div className="canvas">
      <header className="canvas-header">
        <h1>{title}</h1>
        <span className="date">{prettyDate(date)}</span>
        {/* One action assigns this meeting to a project (SPEC §4.4). */}
        <select
          value={meeting?.projectId ?? ''}
          onChange={(e) =>
            mutate(() =>
              window.api.assignMeetingProject(
                { eventKey, title, date },
                e.target.value || null
              )
            )
          }
        >
          <option value="">No project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </header>

      <div className="today-grid">
        <section className="stack">
          <div className="section-label row">
            Prep
            {preps.length > 0 && (
              <span style={{ flex: 1, maxWidth: 120 }}>
                <ProgressBar done={prepDone} total={preps.length} />
              </span>
            )}
          </div>
          <CheckableInput
            placeholder="Add a prep item…"
            value={prepDraft}
            onChange={(e) => setPrepDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPrep()}
          />
          <div className="stack">
            <AnimatePresence>
              {preps.map(({ item }) => (
                <Card key={item.id} done={item.status === 'done'}>
                  <div className="row">
                    <Checkbox
                      checked={item.status === 'done'}
                      onToggle={() =>
                        mutate(() =>
                          window.api.updateItem(item.id, {
                            status: item.status === 'done' ? 'active' : 'done'
                          })
                        )
                      }
                    />
                    <span className="card-title">{item.title}</span>
                  </div>
                </Card>
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
          <div className="stack">
            <AnimatePresence>
              {followUps.map(({ item }) => (
                <ItemCard key={item.id} item={item} />
              ))}
            </AnimatePresence>
          </div>
          {followUps.length === 0 && preps.length === 0 && (
            <EmptyState art="🧘">No prep, no follow-ups. Some meetings are like that.</EmptyState>
          )}
        </section>

        <section>
          <div className="section-label">Notes</div>
          <textarea
            rows={18}
            style={{ width: '100%', resize: 'vertical' }}
            placeholder="Markdown notes for this meeting…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={saveNotes}
          />
        </section>
      </div>
    </div>
  )
}
