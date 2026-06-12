import { useState, type ReactNode } from 'react'
import { todayYmd } from '@shared/dates'
import { useData } from '../state/data'
import { useNav, type View } from '../state/nav'
import { ProjectDot } from './bits'
import { DropZone } from './dnd'

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
  const { projects, inboxCount, dark, setTheme } = useData()
  const { view, navigate } = useNav()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <nav className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">{collapsed ? 'b.' : 'braincells'}</div>

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
      <NavItem view={{ name: 'log' }} icon="📓" label="Daily Log" isActive={view.name === 'log'} />
      <NavItem view={{ name: 'search' }} icon="🔍" label="Search" isActive={view.name === 'search'} />

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
              title="Toggle light/dark"
              onClick={() => setTheme(dark ? 'light' : 'dark')}
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
