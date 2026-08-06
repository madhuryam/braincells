import { useState } from 'react'
import type { Meeting } from '@shared/types'
import { useLiveQuery } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from './Card'
import { ItemCard } from './ItemCard'
import { ItemBody } from './Markdown'
import { mmdd } from '../format'

/**
 * One collapsed row per meeting on a project page (SPEC §4.4):
 * title, date, follow-up status — expandable inline to the full notes
 * and follow-ups. This is a live view of the same linked items the
 * meeting screen shows, not a copy; there is exactly one source of
 * truth.
 */
export function MeetingRow({
  meeting,
  onPeek
}: {
  meeting: Meeting
  /** When given, clicking the row peeks it (in a detail panel) instead of expanding inline. */
  onPeek?: (meeting: Meeting) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { openOverlay } = useNav()
  const followUps =
    useLiveQuery(() => window.api.itemsForEvent(meeting.eventKey, 'follow-up-from'), [meeting.eventKey]) ?? []
  const notes =
    useLiveQuery(() => window.api.itemsForEvent(meeting.eventKey, 'notes-for'), [meeting.eventKey]) ?? []
  const done = followUps.filter((f) => f.item.status === 'done').length

  return (
    <Card>
      <div
        className="row"
        style={{ cursor: 'pointer' }}
        onClick={() => (onPeek ? onPeek(meeting) : setOpen(!open))}
      >
        {!onPeek && <span aria-hidden>{open ? '▾' : '▸'}</span>}
        {/* A fixed-width date column beats an emoji: it says *when*
            and keeps every title starting at the same x. */}
        <span className="meeting-date">{mmdd(meeting.date)}</span>
        <span className="card-title">{meeting.title}</span>
        {followUps.length > 0 && (
          <span className="pill">
            {done}/{followUps.length} follow-ups
          </span>
        )}
        {/* Clicking the row opens the side panel — that's implied, no
            label needed. Standalone rows keep an explicit Open. */}
        {!onPeek && (
          <button
            className="btn ghost"
            style={{ marginLeft: 'auto' }}
            onClick={(e) => {
              e.stopPropagation()
              openOverlay({
                name: 'meeting',
                eventKey: meeting.eventKey,
                title: meeting.title,
                date: meeting.date
              })
            }}
          >
            Open ↗
          </button>
        )}
      </div>

      {open && (
        <div className="stack" style={{ marginTop: 12 }}>
          {notes[0]?.item.content || notes[0]?.item.richContent ? (
            <ItemBody item={notes[0].item} />
          ) : (
            <span style={{ color: 'var(--text-faint)' }}>No notes for this one.</span>
          )}
          {followUps.length > 0 && (
            <div className="item-list">
              {followUps.map(({ item }) => (
                <ItemCard key={item.id} item={item} showProject={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
