import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Item, Section } from '@shared/types'
import { useMutate } from '../state/data'
import { ItemCard } from './ItemCard'
import { DraggableCard, DropZone } from './dnd'
import { CheckableInput } from './bits'
import { ConfirmButton } from './ConfirmButton'

interface SectionGroupsProps {
  projectId: string
  sections: Section[]
  /** Open to-dos, already in display order; grouping preserves it. */
  todos: Item[]
  /** The "new section" name input (opened from the To-dos header row). */
  addingSection: boolean
  onCloseAddSection: () => void
}

/**
 * A project's to-dos, separated into its sections ("Testing",
 * "Customer", …) — flat blocks under small headers, deliberately NOT
 * deeper nesting. Unsectioned tasks trail at the bottom under an
 * automatic "General" header (a display grouping, not a real section —
 * no rename/move/delete); a project that never makes a section looks
 * exactly like it always did. Each block is a drop target: dropping a
 * card files it into that section (General unfiles it).
 */
export function SectionGroups({
  projectId,
  sections,
  todos,
  addingSection,
  onCloseAddSection
}: SectionGroupsProps): React.JSX.Element {
  const mutate = useMutate()
  const known = new Set(sections.map((s) => s.id))
  // Guards against a stale sectionId (shouldn't happen — deletes SET
  // NULL — but an unknown id must not make the task vanish).
  const unfiled = todos.filter((t) => !t.sectionId || !known.has(t.sectionId))
  // Archived sections sink below the active ones, folded — around (the
  // filing they hold is still real) but out of the way.
  const ordered = [
    ...sections.filter((s) => s.status === 'active'),
    ...sections.filter((s) => s.status === 'archived')
  ]

  const move = (idx: number, dir: -1 | 1): void => {
    const ids = ordered.map((s) => s.id)
    ;[ids[idx], ids[idx + dir]] = [ids[idx + dir], ids[idx]]
    void mutate(() => window.api.reorderSections(ids))
  }

  return (
    <>
      {sections.length === 0 ? (
        <>
          {/* No sections: the plain flat list, exactly as before. */}
          {cardsFor(todos)}
          {addingSection && <NewSectionInput projectId={projectId} onClose={onCloseAddSection} />}
        </>
      ) : (
        <>
          {ordered.map((s, i) => (
            <SectionBlock
              key={s.id}
              section={s}
              projectId={projectId}
              items={todos.filter((t) => t.sectionId === s.id)}
              first={i === 0}
              last={i === ordered.length - 1}
              onMove={(dir) => move(i, dir)}
            />
          ))}
          {/* The name input sits where the section it creates will
              appear: after the last one, before the unsectioned tail. */}
          {addingSection && <NewSectionInput projectId={projectId} onClose={onCloseAddSection} />}
          <GeneralBlock projectId={projectId} items={unfiled} />
        </>
      )}
    </>
  )
}

/**
 * The automatic "General" section: everything not filed into a named
 * section. Same header look, none of the management actions — it
 * exists as long as the project has sections, even empty, so there's
 * always somewhere to drop a card to unfile it.
 */
function GeneralBlock({ projectId, items }: { projectId: string; items: Item[] }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <DropZone
      id={`section-none-${projectId}`}
      data={{ type: 'section', projectId, sectionId: null }}
      className="task-group unsectioned"
    >
      <div
        className="task-group-header"
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        <span aria-hidden>{collapsed ? '▸' : '▾'}</span>
        <span>General</span>
        {collapsed && <span className="pill">{items.length}</span>}
      </div>
      {!collapsed &&
        (items.length > 0 ? (
          cardsFor(items)
        ) : (
          <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>
            no tasks — drop one here to unfile it
          </span>
        ))}
    </DropZone>
  )
}

/**
 * One section: a foldable header (with quiet hover actions: rename,
 * move, delete) over its flat task list. The whole block is a drop
 * target for filing cards in.
 */
function SectionBlock({
  section,
  items,
  projectId,
  first,
  last,
  onMove
}: {
  section: Section
  items: Item[]
  projectId: string
  first: boolean
  last: boolean
  onMove: (dir: -1 | 1) => void
}): React.JSX.Element {
  const mutate = useMutate()
  const archived = section.status === 'archived'
  // Archived blocks start folded — present, not in the way.
  const [collapsed, setCollapsed] = useState(archived)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const saveRename = async (): Promise<void> => {
    const trimmed = nameDraft.trim()
    setRenaming(false)
    if (!trimmed || trimmed === section.name) return
    await mutate(() => window.api.renameSection(section.id, trimmed))
  }

  return (
    <DropZone
      id={`section-${section.id}`}
      data={{ type: 'section', projectId, sectionId: section.id }}
      className="task-group"
    >
      {/* A div, not a button: the hover actions inside are real
          buttons, and buttons can't nest. */}
      <div
        className="task-group-header"
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        <span aria-hidden>{collapsed ? '▸' : '▾'}</span>
        {renaming ? (
          <input
            className="section-name-input"
            autoFocus
            value={nameDraft}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => void saveRename()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span>{section.name}</span>
        )}
        {!archived && (
          <span
            className="task-group-add"
            role="button"
            aria-label={`Add a task to ${section.name}`}
            title={`Add a task to ${section.name}`}
            onClick={(e) => {
              e.stopPropagation()
              setAdding(!adding)
              setCollapsed(false) // typing into a folded block goes nowhere
            }}
          >
            ＋
          </span>
        )}
        {archived && <span className="pill">archived</span>}
        {collapsed && <span className="pill">{items.length}</span>}
        <span className="section-actions" onClick={(e) => e.stopPropagation()}>
          {!archived && (
            <>
              <button
                className="btn ghost small"
                title="Rename section"
                onClick={() => {
                  setNameDraft(section.name)
                  setRenaming(true)
                }}
              >
                ✎
              </button>
              <button className="btn ghost small" title="Move up" disabled={first} onClick={() => onMove(-1)}>
                ↑
              </button>
              <button className="btn ghost small" title="Move down" disabled={last} onClick={() => onMove(1)}>
                ↓
              </button>
              {/* Archive, not delete: the tasks keep their filing and
                  the section can come back. */}
              <button
                className="btn ghost small"
                title="Archive section — tasks keep their filing; restore any time"
                onClick={() =>
                  void mutate(() => window.api.setSectionStatus(section.id, 'archived'))
                }
              >
                🗄
              </button>
            </>
          )}
          {archived && (
            <>
              <button
                className="btn ghost small"
                title="Restore section"
                onClick={() => void mutate(() => window.api.setSectionStatus(section.id, 'active'))}
              >
                ↩
              </button>
              <ConfirmButton
                label="✕"
                className="btn ghost small"
                tooltip="Delete for good — its tasks unfile to General"
                onConfirm={() => void mutate(() => window.api.deleteSection(section.id))}
              />
            </>
          )}
        </span>
      </div>
      {!collapsed && (
        <>
          {adding && (
            <SectionAdder projectId={projectId} section={section} onClose={() => setAdding(false)} />
          )}
          {items.length > 0
            ? cardsFor(items)
            : !adding && (
                <span style={{ color: 'var(--text-faint)', fontSize: 14 }}>
                  {archived ? 'nothing filed here' : 'no tasks — drag one here, or ＋ to add'}
                </span>
              )}
        </>
      )}
    </DropZone>
  )
}

function cardsFor(items: Item[]): React.JSX.Element {
  return (
    <div className="item-list">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <DraggableCard key={item.id} item={item}>
            <ItemCard item={item} showProject={false} />
          </DraggableCard>
        ))}
      </AnimatePresence>
    </div>
  )
}

/**
 * Inline "add a task" typing straight into one section (the
 * TaskGroups GroupAdder pattern). Stays focused after each add for
 * rapid entry; an empty Enter/Escape/blur closes it.
 */
function SectionAdder({
  projectId,
  section,
  onClose
}: {
  projectId: string
  section: Section
  onClose: () => void
}): React.JSX.Element {
  const mutate = useMutate()
  const [draft, setDraft] = useState('')
  const add = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) {
      onClose()
      return
    }
    await mutate(() =>
      window.api.createItem({
        kind: 'task',
        title,
        status: 'active',
        projectId,
        sectionId: section.id
      })
    )
    setDraft('')
  }
  return (
    <CheckableInput
      autoFocus
      placeholder={`Add a task to ${section.name}…`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void add()
        else if (e.key === 'Escape') onClose()
      }}
      onBlur={() => !draft.trim() && onClose()}
    />
  )
}

/**
 * Names a new section. Enter creates it and stays open for the next
 * one; Escape or an empty blur closes. Sections append at the end of
 * the project's list — on the project page this input sits exactly
 * there. Also used by Today's project blocks (TaskGroups).
 */
export function NewSectionInput({
  projectId,
  onClose
}: {
  projectId: string
  onClose: () => void
}): React.JSX.Element {
  const mutate = useMutate()
  const [name, setName] = useState('')
  const add = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      onClose()
      return
    }
    await mutate(() => window.api.createSection(projectId, trimmed))
    setName('')
  }
  return (
    <input
      className="section-name-input new-section"
      autoFocus
      placeholder="New section name…"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => !name.trim() && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void add()
        if (e.key === 'Escape') onClose()
      }}
    />
  )
}
