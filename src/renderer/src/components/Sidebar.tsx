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
    <button className={`nav-item ${isActive ? 'active' : ''}`} onClick={() => navigate(view)}>
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="badge">{badge}</span>}
    </button>
  )
}

export function Sidebar(): React.JSX.Element {
  const { projects, inboxCount, setTheme } = useData()
  const { view, navigate } = useNav()
  const [collapsed, setCollapsed] = useState(false)

  const dark = document.documentElement.dataset.theme === 'dark'

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

      <div className="sidebar-footer">
        <button
          className="btn ghost"
          title="Toggle light/dark"
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          {dark ? '☀️' : '🌙'}
        </button>
        <button
          className="btn ghost"
          title="Settings"
          onClick={() => navigate({ name: 'settings' })}
        >
          ⚙️
        </button>
        <button
          className="btn ghost"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed(!collapsed)}
          style={{ marginLeft: 'auto' }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
    </nav>
  )
}
