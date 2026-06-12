import { useEffect, useState } from 'react'
import type { Item } from '@shared/types'
import { ItemCard } from '../components/ItemCard'
import { EmptyState } from '../components/bits'

/**
 * Full-text search over everything — tasks, notes, journals, meeting
 * notes (they're all items). Reachable from the sidebar or ⌘K.
 */
export function Search(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Item[]>([])

  // Search as you type, lightly debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim()) window.api.search(query).then(setResults)
      else setResults([])
    }, 120)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="canvas" style={{ maxWidth: 760 }}>
      <header className="canvas-header">
        <h1>Search</h1>
      </header>
      <input
        id="search-input"
        autoFocus
        style={{ width: '100%', marginBottom: 16, fontSize: 16 }}
        placeholder="Search everything — titles, notes, journal entries…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query.trim() !== '' && results.length === 0 && (
        <EmptyState art="🔍">No matches. It either never existed or it’s called something else.</EmptyState>
      )}
      <div className="stack">
        {results.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
