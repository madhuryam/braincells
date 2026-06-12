import { useState, type ReactNode } from 'react'
import { useData } from '../state/data'
import { useNav, type View } from '../state/nav'
import { ProjectDot } from './bits'

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

      <NavItem view={{ name: 'today' }} icon="☀️" label="Today" isActive={view.name === 'today'} />
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
      {!collapsed &&
        projects.map((p) => (
          <button
            key={p.id}
            className={`nav-item ${view.name === 'project' && view.projectId === p.id ? 'active' : ''}`}
            onClick={() => navigate({ name: 'project', projectId: p.id })}
          >
            <ProjectDot color={p.color} />
            <span>{p.name}</span>
          </button>
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
