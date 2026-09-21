# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A single static page, `triage-review.html`, that is step 2 of a three-step email-triage loop. There is no build, no server, no dependencies, no test suite — edit the HTML, push to `master`, and GitHub Pages serves it.

- **Live URL:** `https://gabriel-serra-aus.github.io/claude-code-pa-email-triage/triage-review.html` (may move; nothing in the page depends on its own URL)
- `?type=gabriel` → shows only the Gabriel tab; `?type=gna` → only the "Gabriel & Arina" tab; no parameter → both.

The old Next.js app (Apr–Aug 2026) and the local `localhost:8765` server scripts were deleted on 29 Aug 2026; they live in git history only.

## The three-step loop (all decisions live in ONE file)

1. **pa-email-triage** (Cowork skill) — fetches Outlook + the Gabriel & Arina Gmail + the open tasks from **Google Tasks** (Gmail side) and **Microsoft To Do** (Outlook side), classifies, and writes `D:\Gabriel\OneDrive\Claude\Workspace\Personal Assistance\email-triage\triage-session.json` with both `groups.*.status: "pending-review"`.
2. **triage-review.html** — opened in Edge/Chrome from the GitHub Pages URL; reads and writes that same file via the File System Access API (no APIs, no Gmail/Outlook/task-app calls; the file handle is remembered per browser origin in IndexedDB). Gabriel accepts/rejects/edits task suggestions, sets email actions, completes/edits existing tasks, adds new ones; **Confirm & Save** flips `groups.<gabriel|gabriel-arina>.status` to `"reviewed"` and **Skip** to `"skipped"`, **for that tab only**. Nothing is written to disk until one of those two buttons is pressed.
3. **pa-email-triage-save** (Cowork skill) — refuses to run while either group is still `"pending-review"`; then applies every group whose status is `"reviewed"` to the task apps + the mailboxes and stamps that group `"processed"` (or `"processed-with-errors"`) + `processedAt`; `"skipped"` groups are left exactly as they are. The page then shows a read-only outcome summary in each processed tab.

**There is no Notion**, no group and no task tag anywhere in the file. One backend per mailbox: Gmail → Google Tasks (`provider: "gtasks"`), Outlook → Microsoft To Do (`provider: "todo"`). A task's identity is its `key` (`"<provider>:<listId>:<taskId>"`); emails point at one with `existingTaskKey`; `url` is an optional display link and may be null. Nothing in the page is backwards compatible — every session file comes from the current step 1.

## Threads: one row per conversation

Step 1 puts **every** message of a thread in `emails[]` with `threadId`, `threadRole` (`head` = newest, exactly one per thread | `child`), `inInbox`, and `newInThread` on heads. Only the head is interactive — it alone carries `category`, `suggestedTask`, `existingTaskKey` and the action Gabriel picks. Children render under it, collapsed behind "▸ N earlier messages" (`ui.expanded`, in memory only), muted and read-only, marked "already archived" when `inInbox` is false.

Child decisions are derived by `syncThread(head)` (called from `setAction` / `setCategory` / `setTaskState` and once on load):

| head's action | child action | child `flagged` |
| --- | --- | --- |
| `flag` / `create-task` / `update-task` | `flag` if `inInbox`, else `archive` | `false` |
| `archive` / `complete-task` / `cancel-task` | `archive` | `false` |

`"flag"` is never written on a child with `inInbox: false`. Counts, filters and the tab badges count **heads only** — hiding a head hides its thread.

## Decision model the page enforces

The **category** is the one thing Gabriel decides and it drives the **action** (`decision.emailAction`), which is exactly what the save skill will do. Category and action are one-click icon ribbons (`ribbonHTML`), not dropdowns.

- Non-tracked heads: Not Important → `archive` (locked); FYI → `flag` (default) | `archive`; Important → `create-task` (default) | `flag`. Every email ends up kept in the inbox or archived — no leave-alone, no create-email. `flag` (label "Keep in inbox") / `create-task` / `update-task` keep it; `archive` / `complete-task` / `cancel-task` archive it.
- Star/flag is a separate property: `decision.flagged` (toggle pill beside the action ribbon, `flagBtnHTML`; default `isFlagged`). **No action ever changes it** — `flag` only means "keep in inbox", so an unflagged email kept in the inbox stays unflagged. The save skill diffs it against `isFlagged`. Gmail `systemLabels` are shown read-only (`prettyLabel`) and never written.
- Heads with `existingTaskKey` ("tracked") show no category and get `trackedActions(e)`: `update-task` (default) | `complete-task` | `cancel-task`. Complete/cancel also archive the thread and are mirrored onto `existingTasks[].decision.complete` / `.cancel` (and back via the Open/Done/Cancelled select in the tasks section — both save as completed, Cancelled adds a note line).
- A matched task with `status: "completed"` is read-only end to end (`isClosed`): "✓ task completed" badge, `archive` as the only action, its state select disabled, no edits, no reopen.
- `decision.isTask` is derived (`emailAction === "create-task"`). An Important head without a suggestion gets a task built from subject + summary on Confirm (`fallbackTask`).
- **Task titles are written once, at creation.** The page never writes `edits.title`; the title input is editable only for suggested/new tasks. `titlePrefixFor()` shows the `Mount:` / `Arura:` / `Huberts:` prefix (from the email's `properties/*` label) as a read-only hint, and applies it only inside `fallbackTask`.
- Task descriptions are two plain-text sections: `-- notes` (Gabriel's — the only half the editor exposes) then `-- auto --` (written by step 1, shown muted and read-only). `splitNotes` / `joinNotes` handle the split; `edits.notes` is always the whole new string.
- A head with `newInThread` shows a "new email in thread" badge and `defaultLinkEdit()` points the matched task's `edits.link` at that head's deep link (shown as "link → latest email").
- **Gmail labels are email-only**: `labels` (now) and `decision.labels` (wanted). The head row shows **only the wanted labels** — hover a chip and click its × to remove it (`removeLabel`); **+ label** opens a fixed-position picker (`ui.labelPicker` = the email index, in memory only) listing just `addableLabels(e)` = `labelOptions()` minus what is already on, and a click adds one (`addLabel`) with the picker left open. An outside click, Escape, a scroll or a resize closes it. `labelOptions()` is still `gmailLabels` ∪ already-set, so a label removed by mistake comes back in the picker. Their only task-side effect is the title prefix.
- There is no "undecided" state — Confirm is always available.

## Tabs and per-group Confirm

Two tabs: **Gabriel** (Outlook emails + `provider: "todo"` tasks) and **Gabriel & Arina** (Gmail emails + `provider: "gtasks"` tasks) — `tabProvider()` / `taskInTab()`. Each tab has its **own independent status** in `groups.<gabriel|gabriel-arina> = { status, reviewedAt, processedAt }`: `pending-review` (editable) → `reviewed` (locked, awaiting save) or `skipped` (locked, save leaves it alone; **Reopen for review** puts it back to `pending-review`) → `processed` / `processed-with-errors` (reviewed groups only; tab shows its outcome summary). The sticky bar shows counts for the current tab; **Confirm & Save — <tab>** / **Skip — <tab>** set that group's status, write the whole file (`writeGroupStatus()`, the only write path), and lock that tab. The other tab is untouched and stays editable.

The save skill runs only once neither group is `pending-review`, then processes exactly the groups whose status is `reviewed`. **There is no session-level `status`** — the two group statuses are the only ones, and `groups` has exactly the keys `gabriel` / `gabriel-arina`. `ensureGroups()` only guarantees those two entries exist with a valid status; it migrates nothing.

## File contract rules

- **`triage-session.schema.jsonc` is the authoritative, commented contract** (every key, owner per step, action vocabulary). Update it whenever the page changes what it reads or writes; point the skills at it.
- The page never writes `processedAt` or per-item outcome fields — those belong to the save skill — and preserves every field it doesn't touch (the whole JSON is mutated in place and written back).
- Stale-tab guard: Confirm / Skip / Reopen re-read the file and refuse to write if *this group* is no longer in the state the page last saw on disk; the other group's entry and items are adopted from disk if it has moved on (`adoptGroupFromDisk`, matching emails by `id` and tasks by `key`).
- **No backwards compatibility.** `applyLoadDefaults()` fills in only what step 1 may omit (the `decision` blocks, `existingTasks`, `newTasks`) — there is no legacy handling and no migration path anywhere in the page.
- The save skill must understand the action vocabulary above (`archive | flag | create-task | update-task | complete-task | cancel-task`).

## Version stamp

The page shows a build stamp in the header: `<span class="version" id="app-version">` inside the `<h1>`, format **`v<yyyy>.<MM>.<dd> - <HH>-<mm>`** (local time, 24-hour), e.g. `v2026.09.01 - 11-43`.

- It is a **hardcoded string in the HTML** — nothing computes it at runtime, so it reflects when the page was last pushed, not when it is opened.
- **Bump it only as part of a commit + push**, in the same commit as the change: set it to the local time at that moment (`date "+%Y.%m.%d - %H-%M"`), then commit and push. Never bump it on an edit that is not being pushed, and never bump it twice for one push.
- If several changes are committed together, the stamp is set once, on that commit.

## Working on the page

- One file, vanilla JS, CSS variables for light/dark (`--accent`, `--green`, `--muted`, etc. are defined in both `:root` and the dark block — define new colours in both).
- Responsive: three media blocks at the end of the stylesheet — `max-width: 960px` (email rows become date / email / category + action via grid areas on `.cell-date` `.cell-main` `.cell-cat` `.cell-action`), `max-width: 600px` (everything stacks, full-screen modal, scrolling filter bar) and `(hover: none), (pointer: coarse)` (bigger targets, label × always visible). Phones/iPads still can't run the page — no File System Access API there.
- Quick syntax check after edits: extract the `<script>` body and run `node --check` on it.
- `improvements.md` is the backlog + change log; add to it when making a deliberate UX change.
