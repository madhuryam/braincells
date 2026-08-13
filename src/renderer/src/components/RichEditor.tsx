import { forwardRef, useImperativeHandle, useRef } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { BulletList } from '@tiptap/extension-bullet-list'
import { Image as ImageExtension } from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import type { EditorView } from '@tiptap/pm/view'

/**
 * The rich text editor for Pages — a Slack-canvas-style writing
 * surface: headings, bold/italic/underline/strike, lists, checklists,
 * quotes, code blocks, tables, images (paste/drop/attach), and font
 * choice.
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
   * Commit-and-exit: fired on plain ⏎ (and Esc) from anywhere in the
   * notes — the caller saves and closes its editor. ⇧⏎ stays inside,
   * making a newline. When omitted, ⏎ keeps its default TipTap
   * behavior (new paragraph / next list item).
   */
  onExit?: () => void
  /**
   * 'full' (default): the whole toolbar, for Pages.
   * 'compact': a slim toolbar and short height, for notes inside
   * cards and the meeting notes pane. Markdown-style shortcuts
   * (`# `, `**bold**`, `- `, `> `…) work in both — text formats as
   * you type, Obsidian-style.
   */
  variant?: 'full' | 'compact'
  /** false hides the toolbar entirely (markdown shortcuts still work) —
   *  for tight surfaces like the detail-panel peek. Default true. */
  toolbar?: boolean
}

/** Imperative handle: move focus (caret at end) into the notes. */
export interface RichEditorHandle {
  focus: () => void
}

// Images embed as base64 data URIs inside the stored HTML, so the whole
// app stays one .sqlite3 file — no asset folder to lose in a backup. To
// keep the database sane we cap sources at 10MB and downscale/re-encode
// before embedding.
const MAX_IMAGE_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_EDGE_PX = 1600

async function imageFileToDataUri(file: File): Promise<string | null> {
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    console.warn(`RichEditor: image is ${file.size} bytes (>10MB), refusing to embed`)
    return null
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image()
      el.onload = (): void => resolve(el)
      el.onerror = (): void => reject(new Error('undecodable image'))
      el.src = url
    })
    const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    // PNG keeps transparency; everything else compresses far better as JPEG.
    return file.type === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    console.warn('RichEditor: could not decode image, not embedding')
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Shared by paste and drop. Inserts asynchronously (encoding takes a beat)
// but reports "handled" synchronously so ProseMirror doesn't also paste the
// raw file. `pos` anchors dropped images at the drop point.
function insertImageFiles(view: EditorView, files: File[], pos?: number): boolean {
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (images.length === 0) return false
  for (const file of images) {
    void imageFileToDataUri(file).then((src) => {
      if (!src) return
      const node = view.state.schema.nodes.image.create({ src })
      const tr =
        pos !== undefined
          ? view.state.tr.insert(pos, node)
          : view.state.tr.replaceSelectionWith(node)
      view.dispatch(tr)
    })
  }
  return true
}

// Keep bullet lists (toolbar button, existing/pasted lists) but drop the
// "- " / "* " / "+ " input rule — typing a dash at line start should stay
// a dash, not silently become a bullet.
const BulletListNoAutoformat = BulletList.extend({
  addInputRules() {
    return []
  }
})

const FONTS: Array<[label: string, css: string]> = [
  ['Default', ''],
  ['Serif', 'Georgia, serif'],
  ['Mono', 'ui-monospace, SFMono-Regular, Menlo, monospace'],
  ['Rounded', 'ui-rounded, "SF Pro Rounded", "Comic Sans MS", cursive']
]

export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { initialHtml, placeholder, onChange, onExit, variant = 'full', toolbar = true },
  ref
): React.JSX.Element | null {
  // Kept in a ref so the editor's keydown handler (built once) always
  // sees the latest callback without rebuilding the editor.
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ bulletList: false }),
      BulletListNoAutoformat,
      TableKit.configure({ table: { resizable: false } }),
      TextStyleKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      // base64 so the image lives in richContent (and thus SQLite);
      // block-level images read better in notes than inline ones.
      ImageExtension.configure({ allowBase64: true, inline: false }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write anything…' })
    ],
    content: initialHtml,
    editorProps: {
      // Commit-and-exit when the caller wants it: plain ⏎ (or Esc)
      // closes; ⇧⏎ is the "stay inside" newline. Handled here (not
      // just via bubbling) because ProseMirror consumes the keydown
      // before it reaches the card's own handler.
      handleKeyDown: (_view, event): boolean => {
        if (!onExitRef.current) return false
        const exits =
          (event.key === 'Enter' && !event.shiftKey) || event.key === 'Escape'
        if (!exits) return false
        event.preventDefault()
        onExitRef.current()
        return true
      },
      handlePaste: (view, event): boolean =>
        insertImageFiles(view, Array.from(event.clipboardData?.files ?? [])),
      handleDrop: (view, event, _slice, moved): boolean => {
        if (moved) return false // internal drag of existing content — let PM move it
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        return insertImageFiles(view, Array.from(event.dataTransfer?.files ?? []), pos)
      }
    },
    // Note: getText() skips images, so the plain-text mirror callers keep
    // for search/preview simply won't mention them — acceptable.
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText())
  })

  // Let callers drop the caret into the notes (e.g. ⏎ from the title).
  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus('end') }), [editor])

  if (!editor) return null
  return (
    <div className={`rich-editor ${variant}`}>
      {toolbar && <Toolbar editor={editor} compact={variant === 'compact'} />}
      <EditorContent editor={editor} />
    </div>
  )
})

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

  // Attach flow: hidden input so the 🖼 button can open the OS picker.
  const fileInput = useRef<HTMLInputElement>(null)
  const onImagePicked = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still fires change
    if (!file) return
    void imageFileToDataUri(file).then((src) => {
      if (src) editor.chain().focus().setImage({ src }).run()
    })
  }
  const imageControls = (
    <>
      {btn('🖼', 'Insert image', () => fileInput.current?.click())}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onImagePicked}
      />
    </>
  )

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
        {imageControls}
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
      {imageControls}
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
