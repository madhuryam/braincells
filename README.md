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

- **Today** (always opens here): the day's meetings on the left with their
  prep progress, your manually-ordered top tasks on the right. Yesterday's
  unfinished tasks appear in a faded "carried over" group — reschedule them
  all with one click or let them all go with one click.
- **⌥Space from anywhere on the Mac**: a floating capture field. Type, hit
  return, done — it lands in the Inbox. Optional shorthand: `#project`,
  `!today`, `!tomorrow` (anything that doesn't parse just stays in the text).
- **Inbox**: triage each capture with one keystroke — `1`/`2`/`3` make it a
  task (today/tomorrow/someday), `N` note, `P` project, `M` meeting prep,
  `X` drop. "Declare bankruptcy" sweeps the whole pile, guilt-free.
- **Meetings**: click any event on the timeline → prep checklist, markdown
  notes, and follow-ups that are real tasks the moment you type them. Assign
  the meeting to a project and it shows up on that project's page, live.
- **Drag everything**: cards onto sidebar projects, onto Today, onto the
  timeline (time blocking), onto meetings (prep), and up/down to reorder.
- **Daily Log**: what got done, which meetings happened, plus a journal box.
- **⌘K**: full-text search across every title and note. **⌘N**: quick
  capture inside the app.

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
