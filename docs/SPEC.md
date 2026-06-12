# Focus Dashboard — Product & Technical Spec (v1)

A personal productivity desktop app (web tech, runs on Mac) that replaces a sprawl of Slack canvases with one opinionated dashboard: meetings, prep, notes, todos, daily log, and light time blocking — designed around ADHD constraints (low-friction capture, no guilt debt, one default screen).

---

## 1. Problem

Tasks, meeting prep, meeting notes, project notes, and daily plans currently live across many Slack canvases. Capture works, but retrieval, linking, and daily orientation don't. The result is chaos and dropped threads — especially the meeting → prep → notes → follow-up loop.

## 2. Goals (v1)

1. **One "Today" screen** that answers "what's happening and what should I do" with zero navigation.
2. **Sub-2-second capture** from anywhere on the Mac (global hotkey → inbox).
3. **The meeting loop**: every calendar event can have attached prep items, notes, and follow-up todos.
4. **Projects** as lightweight containers for notes and tasks.
5. **Daily log**: an automatic record of what got done each day, plus free-form journaling.
6. **Local backups** on demand — no cloud dependency, no paid accounts required.

### Non-goals (v1)

- No time-tracking, analytics, streaks, or gamification.
- No collaboration/sharing.
- No writing to the calendar (read-only).
- No custom fields, nested folders, or tag taxonomies. The organizational vocabulary is fixed: Projects, Items, Links.
- No cloud sync or multi-device sync in v1 (may revisit later).

## 3. Core concepts & data model

Everything is an **Item**. Items have a `kind`, markdown `content`, optional dates, and a status. **Links** connect items to each other and to calendar events. This flat model is what allows new behaviors later without schema upheaval.

### Item
| Field | Notes |
|---|---|
| `id` | UUID |
| `kind` | `task` \| `note` \| `journal` \| `prep` |
| `title` | short text |
| `content` | Markdown |
| `status` | `inbox` \| `active` \| `done` \| `dropped` |
| `dueDate` / `scheduledDate` | optional; `scheduledDate` powers Today & time blocks |
| `timeEstimateMinutes` | optional, for time blocking |
| `createdAt` / `completedAt` | timestamps |

### Project
`id`, `name`, `color`, `status (active/archived)`. Items optionally belong to one project.

### Link
`fromItemId`, `toTarget` (another Item **or** a calendar event identifier), `role` (`prep-for`, `notes-for`, `follow-up-from`, `related`), `eventSnapshot` (denormalized `{title, date}` captured at link time for calendar targets).

Calendar links are **optional** — most tasks and notes stand alone. The snapshot guarantees notes survive event deletion: if the source event disappears, linked items remain fully browsable (shown as "Title — Date (event removed)"). If an event is rescheduled, the link follows automatically (Google Calendar event IDs persist across edits); the snapshot date refreshes on next sight of the event.

### CalendarEvent (not stored — read live)
Read via Google Calendar API (OAuth). Events are referenced by their stable Google event ID + occurrence date; never duplicated into the database. Links use this ID so notes survive event edits.

## 4. Screens (v1)

### 4.1 Today (default, always opens here)
- Timeline of today's calendar events; each shows attached prep status (e.g. "2 of 3 prep items done") and a one-tap "open notes."
- "Top tasks" — manually ordered short list (soft cap ~5 visible).
- Inbox count badge with one-key triage.
- Quick capture field always focused-able via `⌘N`.
- Yesterday's unfinished scheduled tasks appear in a quiet "carried over" group — never red, never counted as "overdue."

### 4.2 Inbox
Raw captures. Triage actions (single keystrokes): assign to project, make it a task with a date, attach to a meeting, convert to note, or drop it. Empty inbox is the only "win state" in the app.

### 4.3 Meeting view
Opened from any calendar event: prep checklist, notes pane (markdown), and a "follow-ups" section where any line can be promoted to a task with one action. Past meetings remain browsable; notes are searchable.

### 4.4 Projects
List of projects → project page = its notes and tasks, newest activity first. No further hierarchy.

**Embedded meetings**: each meeting can be assigned to a project (from the meeting view, one action). The project page then includes a "Meetings" section — one collapsed row per meeting (title, date, follow-up status), expandable inline to reveal full notes and follow-ups. This is a **live view** of the same meeting items, not copied text, so there is exactly one source of truth and no need to navigate the calendar to find past notes.

### 4.5 Daily log
Auto-assembled per day: tasks completed, meetings held (with note links), plus a free-form journal item. Read-mostly; exists so "what did I even do this week" has an answer.

### 4.6 Time blocking (v1-lite)
On Today, drag tasks onto the day timeline to set `scheduledDate` + time. Blocks are *suggestions*: a missed block just returns the task to the Today list. No auto-reflow engine in v1.

## 5. Capture

- **Global hotkey** (e.g. `⌥Space`): floating window, type, hit return → lands in Inbox. No required fields.
- Optional inline shorthand parsed on save: `#project`, `!today`, `!tomorrow`. Parsing failures degrade gracefully to plain inbox items.

## 6. ADHD design principles (binding constraints)

1. Capture must never require a decision.
2. The app must never shame: no overdue counts, no red, no streaks. Old tasks fade and can be bulk-dropped guiltlessly ("declare bankruptcy" action on the Inbox and carried-over groups).
3. Today resets every morning; the plan is disposable.
4. Organizing is rationed: if a workflow invites fiddling (custom views, tag systems), it's out.
5. One default screen. Everything important is ≤1 click from Today.

## 7. Visual design & interaction

### Personality
This is not a corporate productivity tool. It should feel like a workspace you *want* to open — closer to a well-designed game menu than a spreadsheet. Warm, playful, opinionated. The UI has a voice.

### Color & theming
- A rich default palette — not monochrome. Projects each get a user-chosen accent color that carries through cards, sidebar dots, and subtle background tints so the eye can orient by color without reading labels.
- Light and dark modes, both colorful. Dark mode is not "gray on darker gray" — it keeps the vibrancy.
- Gentle gradients, soft shadows, and rounded corners on cards. Nothing flat and clinical.

### Cards everywhere
- Every item (task, note, meeting, prep) renders as a **card** — a contained, tactile-feeling unit with a subtle shadow and hover lift. Cards give the UI a spatial, magazine-style layout rather than a top-down plaintext list.
- Cards show just enough at a glance (title, project color pip, status icon, due date) and expand inline or open into a detail pane.
- Meeting cards on Today show a mini progress bar for prep items — satisfying to watch fill up.

### Drag & drop as a first-class interaction
- **Inbox → Project**: drag a card to a project in the sidebar to assign it.
- **Task → Meeting**: drag a task card onto a meeting card to attach it as prep or follow-up.
- **Today reorder**: drag to reprioritize the task list.
- **Time blocking**: drag a task card onto the timeline to schedule it into a block.
- **Cross-list movement**: drag a task between "Today," "This Week," and project boards freely.
- All drags show a smooth ghost card with a clear drop target highlight — the interaction should feel physical and satisfying.

### Micro-interactions & delight
- Completing a task: the card does a small, satisfying collapse animation (not just a checkbox toggle — the card physically exits the list).
- "Declare bankruptcy" on old tasks: a playful sweep animation, not a grim bulk-delete confirmation.
- Inbox zero state: a fun, rotating set of small illustrations or messages ("Nothing here. Go touch grass." / "Inbox clear. You're dangerous today.").
- Subtle spring physics on drag, card reorder, and panel open/close — the UI should feel alive, not rigid.

### Layout
- **Sidebar + main canvas**, not a top nav. Sidebar holds navigation (Today, Inbox, Projects list, Daily Log) with project color dots. Collapsible to maximize focus.
- Today screen uses a **two-column layout**: timeline/calendar on one side, task cards + inbox badge on the other — not a single scrolling list.
- Project pages use a **masonry or column layout** for notes/tasks/meetings cards, not a flat vertical stack.

### Typography
- A single clean sans-serif (Inter, Satoshi, or similar) with generous sizing. Headlines should feel bold and confident, not whisper-quiet.
- Markdown content renders with comfortable line height and reading-width constraints — it should feel like a good blog post, not a code editor.

## 8. Architecture

- **Shell**: Electron (broad ecosystem, proven) or Tauri (lighter, Rust-based). Either wraps a web UI as a native Mac app with menu bar, dock icon, and global hotkey support.
- **Frontend**: React + TypeScript. A single-page app with client-side routing (Today / Inbox / Projects / Daily Log). Drag-and-drop via `dnd-kit` (or `@hello-pangea/dnd`). Animations via Framer Motion (spring physics on drags, card transitions, collapse/expand). Markdown editing via a lightweight library (e.g., Milkdown, or a plain `<textarea>` in v1).
- **Persistence**: SQLite via `better-sqlite3` (Electron) or the Tauri SQL plugin. Single file, lives in `~/Library/Application Support/FocusDashboard/`. The Items+Links schema maps directly to 3–4 tables.
- **Calendar**: Google Calendar API, read-only, OAuth 2.0 flow handled in-app. Token stored locally in the SQLite DB or OS keychain.
- **Search**: SQLite FTS5 over titles + content; simple substring/full-text search is fine for v1.
- **Backup**: a menu command ("Create Backup") that copies the SQLite file to a user-chosen location, plus a separate "Export as Markdown" that dumps everything as a folder of `.md` files + JSON manifest. Restore = point the app at a backup file. No cloud dependency.
- **Quick capture**: Electron/Tauri global shortcut (e.g. `⌥Space`) opens a small floating window. Type, hit return → Inbox. Window dismisses.

### Why this doesn't paint you into a corner
- Items+Links model absorbs new "kinds" (e.g., habits, reading list) without migrations.
- Web tech means the UI could ship as a hosted web app, PWA, or mobile wrapper later without a rewrite.
- SQLite is the most portable database on earth; backup is literally copying one file.
- Markdown content + export keeps the data human-readable and tool-agnostic.
- Calendar is referenced, not copied — no sync drift between the app and Google.
- If you want cloud sync later, options include SQLite replication (Litestream, cr-sqlite for CRDTs), or promoting to a hosted backend — none require changing the data model.

## 9. Milestones

1. **M1 — Skeleton**: Electron/Tauri shell, SQLite schema, React app with card-based UI, color system, Projects + Items CRUD, Inbox, basic Today list.
2. **M2 — Capture + drag-drop**: global hotkey floating window, shorthand parsing, triage keystrokes, drag-and-drop between lists/projects/meetings.
3. **M3 — Calendar loop**: Google Calendar OAuth + read, Today timeline, meeting view with prep/notes/follow-ups.
4. **M4 — Daily log + FTS5 search + backup/export.**
5. **M5 — Time-block drag on Today; animation polish (spring physics, card transitions, completion animations); carried-over behavior.**
6. **Later**: cloud sync, mobile version (PWA or native wrapper), auto-reflow scheduling, Slack canvas importer.

## 10. Resolved decisions

- Recurring meetings: **notes attach per-occurrence**.
- Completed tasks appear in **both** the project page and the daily log.
- Markdown editor: **plain textarea** in v1 (no live preview).
