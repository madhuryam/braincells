import { useEffect, useState, type ReactNode } from 'react'
import { todayYmd } from '@shared/dates'
import { useData, useLiveQuery } from '../state/data'
import { useNav, type View } from '../state/nav'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { projectLabel } from '../format'
import { ProjectDot } from './bits'
import { DropZone, SortableProjectRow } from './dnd'
import { HotkeysHelp, isTyping } from './HotkeysHelp'

export const DEFAULT_TIME_ZONE = 'America/New_York'

/** A live clock with date in the configured time zone, always AM/PM. */
function Clock(): React.JSX.Element {
  const timeZone =
    useLiveQuery(() => window.api.getSetting<string>('timeZone'), []) ?? DEFAULT_TIME_ZONE
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // An invalid/unknown zone would throw; fall back to the system zone.
  const fmt = (opts: Intl.DateTimeFormatOptions): string => {
    try {
      return now.toLocaleString(undefined, { timeZone, ...opts })
    } catch {
      return now.toLocaleString(undefined, opts)
    }
  }
  const abbr = fmt({ timeZoneName: 'short' }).split(' ').pop()

  return (
    <div className="sidebar-clock" title={timeZone}>
      <span className="sidebar-time">
        {fmt({ hour: 'numeric', minute: '2-digit', hour12: true })}
      </span>
      <span className="sidebar-date">
        {fmt({ weekday: 'short', month: 'short', day: 'numeric' })} · {abbr}
      </span>
    </div>
  )
}

function NavItem({
  view,
  icon,
  label,
  badge,
  isActive
}: {
  view: View
  icon: ReactNode
  label: string
  badge?: number
  isActive: boolean
}): React.JSX.Element {
  const { navigate } = useNav()
  return (
    <button
      className={`nav-item ${isActive ? 'active' : ''}`}
      title={label}
      onClick={() => navigate(view)}
    >
      <span className="nav-icon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="badge">{badge}</span>}
    </button>
  )
}

export function Sidebar(): React.JSX.Element {
  // `dark` comes from context state (not the DOM attribute) so the
  // toggle button always re-renders in step with the actual theme.
  const { projects, dark, toggleDark } = useData()
  const { view, navigate } = useNav()
  const [collapsed, setCollapsed] = useState(false)
  const [keysOpen, setKeysOpen] = useState(false)

  // "?" opens the shortcut cheat-sheet from anywhere (unless typing).
  // Lives here because the sidebar is mounted on every screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !isTyping(e)) {
        e.preventDefault()
        setKeysOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">{collapsed ? 'b.' : 'braincells'}</div>
      {!collapsed && <Clock />}

      {/* Dropping any card on "Today" schedules it for today. */}
      <DropZone id="nav-today" data={{ type: 'schedule', date: todayYmd() }}>
        <NavItem view={{ name: 'today' }} icon="📅" label="Today" isActive={view.name === 'today'} />
      </DropZone>
      <NavItem view={{ name: 'log' }} icon="📑" label="Weekly Log" isActive={view.name === 'log'} />
      <NavItem
        view={{ name: 'calendar' }}
        icon="🗓️"
        label="Calendar"
        isActive={view.name === 'calendar'}
      />
      <NavItem view={{ name: 'search' }} icon="🔍" label="Search" isActive={view.name === 'search'} />

      {/* Starred canvases live on their project's overview now — the
          sidebar stays pure navigation. */}
      {!collapsed && <div className="nav-section">Projects</div>}
      <NavItem
        view={{ name: 'projects' }}
        icon="📂"
        label="All projects"
        isActive={view.name === 'projects'}
      />
      {/* Drag a project to reorder; drop a card on one to file it there
          (SPEC §7 drag & drop). */}
      {!collapsed && (
        <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          {projects.map((p) => (
            <SortableProjectRow key={p.id} projectId={p.id} projectIds={projects.map((x) => x.id)}>
              <button
                className={`nav-item nav-item-nested ${view.name === 'project' && view.projectId === p.id ? 'active' : ''}`}
                onClick={() => navigate({ name: 'project', projectId: p.id })}
              >
                <ProjectDot color={p.color} />
                {/* Names too long for this rail fall back to the
                    nickname when one is set. */}
                <span className="nav-label" title={p.name}>
                  {p.name.length > 18 ? projectLabel(p) : p.name}
                </span>
              </button>
            </SortableProjectRow>
          ))}
        </SortableContext>
      )}

      {/* Collapsed rail: dot-only rows so a project is still one click
          away. Reordering (drag) lives on the expanded sidebar. */}
      {collapsed &&
        projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item nav-item-dot ${view.name === 'project' && view.projectId === p.id ? 'active' : ''}`}
            title={p.name}
            onClick={() => navigate({ name: 'project', projectId: p.id })}
          >
            <ProjectDot color={p.color} />
          </button>
        ))}

      {/* When collapsed, only the expand button remains — the footer
          used to overflow the 64px rail, leaving it unclickable. */}
      <div className="sidebar-footer">
        {!collapsed && (
          <>
            <button
              className="btn ghost icon-btn"
              title="Toggle light/dark (remembers your light theme)"
              onClick={toggleDark}
            >
              {dark ? '☀️' : '🌙'}
            </button>
            <button
              className="btn ghost icon-btn"
              title="Keyboard shortcuts (?)"
              onClick={() => setKeysOpen(true)}
            >
              ❔
            </button>
            <button
              className="btn ghost icon-btn"
              title="Settings"
              onClick={() => navigate({ name: 'settings' })}
            >
              ⚙️
            </button>
          </>
        )}
        <button
          className="btn ghost icon-btn"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed(!collapsed)}
          style={collapsed ? undefined : { marginLeft: 'auto' }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <HotkeysHelp open={keysOpen} onClose={() => setKeysOpen(false)} />
    </nav>
  )
}
