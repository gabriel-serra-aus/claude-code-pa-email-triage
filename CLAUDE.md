# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A single static page, `triage-review.html`, that is step 2 of a three-step email-triage loop. There is no build, no server, no dependencies, no test suite — edit the HTML, push to `master`, and GitHub Pages serves it.

- **Live URL:** `https://gabriel-serra-aus.github.io/claude-code-pa-email-triage/triage-review.html` (may move; nothing in the page depends on its own URL)
- `?type=gabriel` → shows only the Personal tab; `?type=gna` → only the "Gabriel & Arina" tab; no parameter → both.

The old Next.js app (Apr–Aug 2026) and the local `localhost:8765` server scripts were deleted on 29 Aug 2026; they live in git history only.

## The three-step loop (all decisions live in ONE file)

1. **pa-email-triage** (Cowork skill) — fetches Outlook + shared Gmail + open Notion tasks, classifies, and writes `D:\Gabriel\OneDrive\Claude\Workspace\Personal Assistance\email-triage\triage-session.json` with `status: "pending-review"`.
2. **triage-review.html** — opened in Edge/Chrome from the GitHub Pages URL; reads and writes that same file via the File System Access API (no APIs, no Gmail/Outlook/Notion calls; the file handle is remembered per browser origin in IndexedDB). Gabriel accepts/rejects/edits task suggestions, sets email actions, completes/edits existing tasks, adds new ones; Confirm flips `status` to `"reviewed"`.
3. **pa-email-triage-save** (Cowork skill) — applies the reviewed file to Notion + the mailboxes and stamps `status: "processed"` (or `"processed-with-errors"`). The page then shows a read-only outcome summary.

## Decision model the page enforces

The **category** is the one thing Gabriel decides and it drives the **action** (`decision.emailAction`), which is exactly what the save skill will do. Category and action are one-click icon ribbons (`ribbonHTML`), not dropdowns.

- Non-tracked emails: Not Important → `archive` (locked); FYI → `archive` (default) | `none`; Important → `create-task` (default) | `create-email` | `none`.
- Emails with `existingTaskUrl` ("tracked") show no category and get only `update-task` (default) | `complete-task` | `cancel-task`. Complete/cancel also archive the email and are mirrored onto `existingTasks[].decision.complete` / `.cancel` (and back via the Open/Done/Cancelled select in the tasks section).
- `decision.isTask` is derived (`emailAction === "create-task"`). An Important email without a suggestion gets a task built from subject + summary on Confirm (`fallbackTask`).
- Task description updates go into `existingTasks[].decision.edits.notes`: everything above the literal marker `-- auto comment --` is Gabriel's and never touched; everything below is Claude's one-or-two-line briefing (one `DD Mon: summary` line per matched email), replaced on each run.
- Gmail-sourced tasks are locked to group "Gabriel & Arina"; Outlook-sourced tasks can never have it.
- There is no "undecided" state — Confirm is always available.

## Tabs and per-group Confirm

Two tabs: **Personal** (Outlook emails + tasks in any group except the shared one) and **Gabriel & Arina** (Gmail emails + tasks in that group). The sticky bar shows counts for the current tab; **Confirm & Save — <tab>** stamps `reviewedGroups.<personal|shared>` with an ISO timestamp, writes the whole file, and locks that tab read-only.

`status` becomes `"reviewed"` once every *visible* tab is confirmed. When a tab is hidden by `?type=…`, the hidden group is **neutralised** before the write — its emails get `emailAction: "none"`, its existing tasks get `complete/cancel: false, edits: null`, its new tasks are removed — and it is listed in `skippedGroups`. So the save skill keys off `status` alone and never acts on a group that wasn't reviewed.

## File contract rules

- The page never writes `processedAt` or per-item outcome fields — those belong to the save skill — and preserves every field it doesn't touch (the whole JSON is mutated in place and written back).
- Stale-tab guard: Confirm re-reads the file and refuses to write if it is no longer `pending-review`.
- `applyLoadDefaults()` migrates legacy values (old `flag`/`isTask` yes-no) so older session files still load.
- The save skill must understand the action vocabulary above (`archive | none | create-task | create-email | update-task | complete-task | cancel-task`).

## Working on the page

- One file, vanilla JS, CSS variables for light/dark (`--accent`, `--green`, `--muted`, etc. are defined in both `:root` and the dark block — define new colours in both).
- Quick syntax check after edits: extract the `<script>` body and run `node --check` on it.
- `improvements.md` is the log of the Aug 2026 UI rework; add to it when making a deliberate UX change.
