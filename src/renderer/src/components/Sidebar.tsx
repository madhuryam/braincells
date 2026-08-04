import { useEffect, useState, type ReactNode } from 'react'
import { KIND_ICON } from '../format'
import { todayYmd } from '@shared/dates'
import { useData, useLiveQuery } from '../state/data'
import { useNav, type View } from '../state/nav'
import { ProjectDot } from './bits'
import { DropZone } from './dnd'

export const DEFAULT_TIME_ZONE = 'America/New_York'

/** A live clock in the configured time zone, always AM/PM. */
function Clock(): React.JSX.Element {
  const timeZone =
    useLiveQuery(() => window.api.getSetting<string>('timeZone'), []) ?? DEFAULT_TIME_ZONE
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(id)
  }, [])
  let label: string
  try {
    label = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZone })
  } catch {
    label = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return (
    <div className="sidebar-clock" title={timeZone}>
      {label}
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
  const { projects, inboxCount, starred, dark, toggleDark } = useData()
  const { view, navigate } = useNav()
  const [collapsed, setCollapsed] = useState(false)
  const [starredOpen, setStarredOpen] = useState(true)

  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">{collapsed ? 'b.' : 'braincells'}</div>
      {!collapsed && <Clock />}

      {/* Dropping any card on "Today" schedules it for today. */}
      <DropZone id="nav-today" data={{ type: 'schedule', date: todayYmd() }}>
        <NavItem view={{ name: 'today' }} icon="☀️" label="Today" isActive={view.name === 'today'} />
      </DropZone>
      <NavItem
        view={{ name: 'inbox' }}
        icon="📥"
        label="Inbox"
        badge={inboxCount}
        isActive={view.name === 'inbox'}
      />
      <NavItem view={{ name: 'log' }} icon="📓" label="Weekly Log" isActive={view.name === 'log'} />
      <NavItem
        view={{ name: 'calendar' }}
        icon="🗓️"
        label="Calendar"
        isActive={view.name === 'calendar'}
      />
      <NavItem view={{ name: 'search' }} icon="🔍" label="Search" isActive={view.name === 'search'} />

      {/* Quick access to starred notes/pages, no project digging. */}
      {!collapsed && starred.length > 0 && (
        <button className="nav-section nav-section-toggle" onClick={() => setStarredOpen(!starredOpen)}>
          {starredOpen ? '▾' : '▸'} Starred
        </button>
      )}
      {!collapsed &&
        starredOpen &&
        starred.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${view.name === 'page' && view.itemId === item.id ? 'active' : ''}`}
            title={item.title}
            onClick={() => navigate({ name: 'page', itemId: item.id })}
          >
            <span className="nav-icon" aria-hidden>
              {KIND_ICON[item.kind]}
            </span>
            <span>{item.title || 'Untitled'}</span>
          </button>
        ))}

      {!collapsed && <div className="nav-section">Projects</div>}
      <NavItem
        view={{ name: 'projects' }}
        icon="🗂️"
        label="All projects"
        isActive={view.name === 'projects'}
      />
      {/* Dropping a card on a project assigns it (SPEC §7 drag & drop). */}
      {!collapsed &&
        projects.map((p) => (
          <DropZone key={p.id} id={`nav-project-${p.id}`} data={{ type: 'project', projectId: p.id }}>
            <button
              className={`nav-item ${view.name === 'project' && view.projectId === p.id ? 'active' : ''}`}
              onClick={() => navigate({ name: 'project', projectId: p.id })}
            >
              <ProjectDot color={p.color} />
              <span>{p.name}</span>
            </button>
          </DropZone>
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
    </nav>
  )
}
