import { createContext, useContext, type ReactNode } from 'react'

export interface MeetingRef {
  eventKey: string
  title: string
  date: string
}

/**
 * Lets a deeply nested card (the 📅 meeting chip in a task's editor)
 * open the current screen's meeting peek panel. Screens that own a
 * DetailPanel slot (Today, ProjectPage, DailyLog) provide their
 * setter; on screens that don't, consumers fall back to opening the
 * full meeting overlay.
 */
const MeetingPeekContext = createContext<((m: MeetingRef) => void) | null>(null)

export function MeetingPeekProvider({
  onPeek,
  children
}: {
  onPeek: (m: MeetingRef) => void
  children: ReactNode
}): React.JSX.Element {
  return <MeetingPeekContext.Provider value={onPeek}>{children}</MeetingPeekContext.Provider>
}

/** The screen's peek opener, or null when no screen provides one. */
export function useMeetingPeek(): ((m: MeetingRef) => void) | null {
  return useContext(MeetingPeekContext)
}
