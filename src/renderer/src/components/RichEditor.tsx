import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'

/**
 * The rich text editor for Pages — a Slack-canvas-style writing
 * surface: headings, bold/italic/underline/strike, lists, checklists,
 * quotes, code blocks, tables, and font choice.
 *
 * DELIBERATELY A THIN WALL: this is the only file in the app that
 * knows TipTap exists. Everyone else passes in HTML and receives
 * (html, plainText) back. If TipTap ever falls short, swap this
 * file's internals for another editor and nothing else changes —
 * the stored format is plain HTML.
 */
export interface RichEditorProps {
  /** Seed content. Changes to this prop are ignored after mount —
   *  remount with a `key` to load a different document. */
  initialHtml: string
  placeholder?: string
  onChange: (html: string, plainText: string) => void
  /**
   * 'full' (default): the whole toolbar, for Pages.
   * 'compact': a slim toolbar and short height, for notes inside
   * cards and the meeting notes pane. Markdown-style shortcuts
   * (`# `, `**bold**`, `- `, `> `…) work in both — text formats as
   * you type, Obsidian-style.
   */
  variant?: 'full' | 'compact'
}

const FONTS: Array<[label: string, css: string]> = [
  ['Default', ''],
  ['Serif', 'Georgia, serif'],
  ['Mono', 'ui-monospace, SFMono-Regular, Menlo, monospace'],
  ['Rounded', 'ui-rounded, "SF Pro Rounded", "Comic Sans MS", cursive']
]

export function RichEditor({
  initialHtml,
  placeholder,
  onChange,
  variant = 'full'
}: RichEditorProps): React.JSX.Element | null {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TableKit.configure({ table: { resizable: false } }),
      TextStyleKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write anything…' })
    ],
    content: initialHtml,
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText())
  })

  if (!editor) return null
  return (
    <div className={`rich-editor ${variant}`}>
      <Toolbar editor={editor} compact={variant === 'compact'} />
      <EditorContent editor={editor} />
    </div>
  )
}

function Toolbar({ editor, compact }: { editor: Editor; compact: boolean }): React.JSX.Element {
  // Re-renders the buttons as the selection moves, so active marks light up.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      inTable: e.isActive('table'),
      font: (e.getAttributes('textStyle').fontFamily as string | undefined) ?? ''
    })
  })

  // mousedown + preventDefault keeps the text selection while clicking.
  const btn = (
    label: string,
    title: string,
    run: () => void,
    active = false
  ): React.JSX.Element => (
    <button
      key={title}
      type="button"
      title={title}
      className={`rt-btn ${active ? 'on' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault()
        run()
      }}
    >
      {label}
    </button>
  )

  const chain = (): ReturnType<Editor['chain']> => editor.chain().focus()

  if (compact) {
    return (
      <div className="rich-toolbar">
        {btn('B', 'Bold (⌘B)', () => chain().toggleBold().run(), state.bold)}
        {btn('I', 'Italic (⌘I)', () => chain().toggleItalic().run(), state.italic)}
        {btn('S̶', 'Strikethrough', () => chain().toggleStrike().run(), state.strike)}
        <span className="rt-sep" />
        {btn('•', 'Bullet list', () => chain().toggleBulletList().run(), state.bullet)}
        {btn('1.', 'Numbered list', () => chain().toggleOrderedList().run(), state.ordered)}
        {btn('☑', 'Checklist', () => chain().toggleTaskList().run(), state.task)}
        {btn('❝', 'Quote', () => chain().toggleBlockquote().run(), state.quote)}
        <span className="rt-hint">md shortcuts work: # ** - [ ] &gt;</span>
      </div>
    )
  }

  return (
    <div className="rich-toolbar">
      {btn('H1', 'Heading 1', () => chain().toggleHeading({ level: 1 }).run(), state.h1)}
      {btn('H2', 'Heading 2', () => chain().toggleHeading({ level: 2 }).run(), state.h2)}
      {btn('H3', 'Heading 3', () => chain().toggleHeading({ level: 3 }).run(), state.h3)}
      <span className="rt-sep" />
      {btn('B', 'Bold (⌘B)', () => chain().toggleBold().run(), state.bold)}
      {btn('I', 'Italic (⌘I)', () => chain().toggleItalic().run(), state.italic)}
      {btn('U', 'Underline (⌘U)', () => chain().toggleUnderline().run(), state.underline)}
      {btn('S̶', 'Strikethrough', () => chain().toggleStrike().run(), state.strike)}
      <span className="rt-sep" />
      {btn('•', 'Bullet list', () => chain().toggleBulletList().run(), state.bullet)}
      {btn('1.', 'Numbered list', () => chain().toggleOrderedList().run(), state.ordered)}
      {btn('☑', 'Checklist', () => chain().toggleTaskList().run(), state.task)}
      {btn('❝', 'Quote', () => chain().toggleBlockquote().run(), state.quote)}
      {btn('</>', 'Code block', () => chain().toggleCodeBlock().run(), state.code)}
      <span className="rt-sep" />
      {state.inTable ? (
        <>
          {btn('+row', 'Add row below', () => chain().addRowAfter().run())}
          {btn('+col', 'Add column after', () => chain().addColumnAfter().run())}
          {btn('−row', 'Delete row', () => chain().deleteRow().run())}
          {btn('−col', 'Delete column', () => chain().deleteColumn().run())}
          {btn('⌫ table', 'Delete table', () => chain().deleteTable().run())}
        </>
      ) : (
        btn('⊞ table', 'Insert a 3×3 table', () =>
          chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        )
      )}
      <span className="rt-sep" />
      <select
        className="rt-font"
        title="Font"
        value={state.font}
        onChange={(e) => {
          const css = e.target.value
          if (css) editor.chain().focus().setFontFamily(css).run()
          else editor.chain().focus().unsetFontFamily().run()
        }}
      >
        {FONTS.map(([label, css]) => (
          <option key={label} value={css}>
            {label}
          </option>
        ))}
      </select>
      <span style={{ marginLeft: 'auto' }} />
      {btn('↩', 'Undo (⌘Z)', () => chain().undo().run())}
      {btn('↪', 'Redo (⇧⌘Z)', () => chain().redo().run())}
    </div>
  )
}
