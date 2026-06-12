# braincells 🧠

A personal, local-first productivity app for the Mac: one **Today** screen,
sub-2-second capture from anywhere, a meeting **prep → notes → follow-up**
loop, lightweight projects, an automatic daily log, and one-file backups.
Built around ADHD constraints: capture never requires a decision, nothing is
ever red or "overdue", and the plan resets every morning.

The full product spec lives in [`docs/SPEC.md`](docs/SPEC.md). The git
history implements it one feature per commit, in order — reading the log is
the best tour of the codebase.

## Running it

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install        # installs dependencies (takes a few minutes the first time)
npm run dev        # opens the app with hot reload
```

Useful commands:

| Command | What it does |
|---|---|
| `npm run dev` | run the app in development (edits reload live) |
| `npm test` | run the unit tests (data layer, capture shorthand, export) |
| `npm run typecheck` | strict TypeScript check of all three processes |
| `npm run build` | production build into `out/` |
| `npm run dist` | package a macOS .dmg (requires a Mac) |

> A note on `npm test` vs `npm run dev`: the SQLite driver is a native
> module that gets compiled per runtime. The `pretest`/`predev` scripts
> automatically rebuild it for Node (tests) or Electron (the app), so both
> always work — the rebuild takes a couple of seconds when switching.

## The five-minute tour

- **Today** (always opens here): manually-ordered top tasks on the left,
  the day's meeting timeline (with prep progress) on the right. Below the
  top tasks: a faded "carried over" group for yesterday's unfinished tasks
  (reschedule all or let go of all in one click) and a collapsible group
  for each of the next four days.
- **Scheduling** is a 5-day rolling window: today, tomorrow, and the next
  three weekdays — or "someday", which parks the task in the Inbox's
  Backlog section until you give it a day.
- **⌥Space from anywhere on the Mac**: a floating capture field. Type, hit
  return, done — it lands in the Inbox. Optional shorthand: `#project`,
  `!today`, `!tomorrow` (anything that doesn't parse just stays in the text).
- **Inbox**: triage each capture with one keystroke — `1`–`5` make it a task
  on that day of the window, `0` someday, `N` note, `P` project, `M` meeting
  prep, `X` drop. "Declare bankruptcy" sweeps the whole pile, guilt-free.
  Someday tasks and unfiled notes stay visible in sections at the bottom.
- **Meetings**: click any event on the timeline or the Calendar tab → prep
  checklist, markdown notes, and follow-ups that are real tasks the moment
  you type them. Assign the meeting to a project and it shows up on that
  project's page, live.
- **Calendar**: a month grid of every meeting, past and future — click any
  chip to open that meeting's notes.
- **Pages**: every project can hold full rich-text documents (headings,
  tables, checklists, fonts) for long-form brain dumps — the Slack-canvas
  replacement. Find them in the project's Pages section.
- **Drag everything**: cards onto sidebar projects, onto Today or any day
  group, onto the timeline (time blocking), onto meetings (prep), and
  up/down to reorder.
- **Daily Log**: what got done, which meetings happened, plus a journal box.
- **⌘K**: full-text search across every title, note, and page. **⌘N**:
  quick capture inside the app. **←** in any header goes back.

## Calendar

Out of the box the app uses a built-in **demo calendar** so the meeting loop
works immediately. To connect your real Google Calendar (read-only):

1. In [console.cloud.google.com](https://console.cloud.google.com) create a
   project, enable the **Google Calendar API**, and create an OAuth client of
   type **Desktop app**.
2. In the app: **Settings → Calendar → Google Calendar**, paste the client ID
   and secret, click **Connect** — your browser opens Google's consent page.

Credentials and tokens are stored only in the local database. The app never
writes to your calendar, and events are never copied: notes attach to an
event's stable ID and keep a title/date snapshot, so they survive the event
being moved or deleted.

## Your data

Everything lives in **one SQLite file**:
`~/Library/Application Support/braincells/braincells.sqlite3`

- **File → Create Backup…** copies it wherever you like.
- **File → Export as Markdown…** writes a folder of plain `.md` files plus a
  JSON manifest — readable forever, no special tools.
- **File → Restore from Backup…** swaps a backup in and relaunches.

No cloud, no account, no telemetry.

## How the code is laid out

Electron apps are three programs in a trenchcoat:

```
src/main/      Node process: owns SQLite, windows, the global hotkey,
               the calendar providers, menus, and backups
  store/       all database access (schema + queries) — start here
  calendar/    'demo' generator and the Google OAuth/REST client
  backup/      backup, markdown export (pure + tested), restore
src/preload/   the security bridge: defines the typed `window.api`
               the UI calls; one method per database operation
src/renderer/  the React UI (screens/, components/, state/, styles/)
src/shared/    types and small helpers used by both sides
```

Two ideas carry the whole design (SPEC §3): everything the user makes is an
**Item** (task / note / journal / prep) and **Links** connect items to each
other or to calendar events. New behaviors become new `kind`s and link
roles, not new tables.

Tech: Electron, React 19 + TypeScript (strict), Vite via electron-vite,
better-sqlite3 (+FTS5 for search), dnd-kit for drag & drop, Framer Motion
for the springs, vitest for tests.
