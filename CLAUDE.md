# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A single static page, `triage-review.html`, that is step 2 of a three-step email-triage loop. There is no build, no server, no dependencies, no test suite — edit the HTML, push to `master`, and GitHub Pages serves it.

- **Live URL:** `https://gabriel-serra-aus.github.io/claude-code-pa-email-triage/triage-review.html` (may move; nothing in the page depends on its own URL)
- `?type=gabriel` → shows only the Personal tab; `?type=gna` → only the "Gabriel & Arina" tab; no parameter → both.

The old Next.js app (Apr–Aug 2026) and the local `localhost:8765` server scripts were deleted on 29 Aug 2026; they live in git history only.

## The three-step loop (all decisions live in ONE file)

1. **pa-email-triage** (Cowork skill) — fetches Outlook + shared Gmail + open Notion tasks, classifies, and writes `D:\Gabriel\OneDrive\Claude\Workspace\Personal Assistance\email-triage\triage-session.json` with both `groups.*.status: "pending-review"` (plus `gmailLabels` / `emails[].labels` for Gmail).
2. **triage-review.html** — opened in Edge/Chrome from the GitHub Pages URL; reads and writes that same file via the File System Access API (no APIs, no Gmail/Outlook/Notion calls; the file handle is remembered per browser origin in IndexedDB). Gabriel accepts/rejects/edits task suggestions, sets email actions, completes/edits existing tasks, adds new ones; **Confirm & Save** flips `groups.<personal|shared>.status` to `"reviewed"` and **Skip** to `"skipped"`, **for that tab only**. Nothing is written to disk until one of those two buttons is pressed.
3. **pa-email-triage-save** (Cowork skill) — refuses to run while either group is still `"pending-review"`; then applies every group whose status is `"reviewed"` to Notion + the mailboxes and stamps that group `"processed"` (or `"processed-with-errors"`) + `processedAt`; `"skipped"` groups are left exactly as they are. The page then shows a read-only outcome summary in each processed tab.

## Decision model the page enforces

The **category** is the one thing Gabriel decides and it drives the **action** (`decision.emailAction`), which is exactly what the save skill will do. Category and action are one-click icon ribbons (`ribbonHTML`), not dropdowns.

- Non-tracked emails: Not Important → `archive` (locked); FYI → `archive` (default) | `flag`; Important → `create-task` (default) | `flag` | `archive`. Every email ends up kept in the inbox or archived — no leave-alone, no create-email. `flag` (label "Keep in inbox") / `create-task` / `update-task` keep it; `archive` / `complete-task` / `cancel-task` archive it.
- Star/flag is a separate property: `decision.flagged` (toggle button per row, `flagBtnHTML`; default `isFlagged`, switched on by `setAction` for keep-in-inbox actions). The save skill diffs it against `isFlagged`. Gmail `systemLabels` are shown read-only (`prettyLabel`) and never written.
- Emails with `existingTaskUrl` ("tracked") show no category and get only `update-task` (default) | `complete-task` | `cancel-task`. Complete/cancel also archive the email and are mirrored onto `existingTasks[].decision.complete` / `.cancel` (and back via the Open/Done/Cancelled select in the tasks section).
- `decision.isTask` is derived (`emailAction === "create-task"`). An Important email without a suggestion gets a task built from subject + summary on Confirm (`fallbackTask`).
- Task description updates go into `existingTasks[].decision.edits.notes`: everything above the literal marker `-- auto comment --` is Gabriel's and never touched; everything below is Claude's one-or-two-line briefing (one `DD Mon: summary` line per matched email), replaced on each run.
- Gmail-sourced tasks are locked to group "Gabriel & Arina"; Outlook-sourced tasks can never have it.
- **Gmail labels ≡ Notion Tags** (same names). Gmail emails carry `labels` (now) and `decision.labels` (wanted); clickable chips on the row. For an email linked to a task the labels and the task's tags are one value — `syncTaskFromLabels` / `syncLabelsFromTags` keep them equal, `materializeDecisions` re-syncs before writing. Tag options everywhere = `labelOptions()` = `gmailLabels ∪ TAGS ∪ already-set`.
- There is no "undecided" state — Confirm is always available.

## Tabs and per-group Confirm

Two tabs: **Personal** (Outlook emails + tasks in any group except the shared one) and **Gabriel & Arina** (Gmail emails + tasks in that group). Each tab has its **own independent status** in `groups.<personal|shared> = { status, reviewedAt, processedAt }`: `pending-review` (editable) → `reviewed` (locked, awaiting save) or `skipped` (locked, save leaves it alone; **Reopen for review** puts it back to `pending-review`) → `processed` / `processed-with-errors` (reviewed groups only; tab shows its outcome summary). The sticky bar shows counts for the current tab; **Confirm & Save — <tab>** / **Skip — <tab>** set that group's status, write the whole file (`writeGroupStatus()`, the only write path), and lock that tab. The other tab is untouched and stays editable — no neutralisation, no `skippedGroups` key.

The save skill runs only once neither group is `pending-review`, then processes exactly the groups whose status is `reviewed`. **There is no session-level `status`** — the two group statuses are the only ones, and `groups` has exactly the keys `personal` / `shared`. `ensureGroups()` migrates legacy files (`status` / `reviewedGroups` / `skippedGroups` / `processedAt`, including an orphan `reviewedGroups.<tab>` stamp next to a `pending-review` `groups.<tab>`) on load, then deletes those keys and any extra group.

## File contract rules

- **`triage-session.schema.jsonc` is the authoritative, commented contract** (every key, owner per step, action vocabulary). Update it whenever the page changes what it reads or writes; point the skills at it.

- The page never writes `processedAt` or per-item outcome fields — those belong to the save skill — and preserves every field it doesn't touch (the whole JSON is mutated in place and written back).
- Stale-tab guard: Confirm / Skip / Reopen re-read the file and refuse to write if *this group* is no longer in the state the page last saw on disk; the other group's entry and items are adopted from disk if it has moved on (`adoptGroupFromDisk`).
- `applyLoadDefaults()` migrates legacy values (old `flag`/`isTask` yes-no) so older session files still load.
- The save skill must understand the action vocabulary above (`archive | flag | create-task | update-task | complete-task | cancel-task`).

## Working on the page

- One file, vanilla JS, CSS variables for light/dark (`--accent`, `--green`, `--muted`, etc. are defined in both `:root` and the dark block — define new colours in both).
- Quick syntax check after edits: extract the `<script>` body and run `node --check` on it.
- `improvements.md` is the log of the Aug 2026 UI rework; add to it when making a deliberate UX change.
