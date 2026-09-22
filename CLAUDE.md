# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

One Netlify site: a static page, `public/triage-review.html` (step 2 of a three-step email-triage loop), plus a handful of Netlify Functions that own the session store and the skills' MCP connector. Vanilla JS in the page; strict TypeScript (ESM, no `any`) in `netlify/`. Push the branch Netlify builds from (`netlify` until cut-over, then `master`) and it deploys — there is no build step, functions are bundled by Netlify.

- **Live URL:** `https://pa-email-triage.netlify.app` (`/` → `/triage-review.html`); local: `npx netlify dev` → `http://localhost:8888` (needs `netlify link`, env pulled from the site).
- `?type=gabriel` → shows only the Gabriel tab; `?type=gna` → only the "Gabriel & Arina" tab; no parameter → both. Both survive the sign-in round trip.
- Dependencies are exactly `@netlify/blobs`, `@modelcontextprotocol/sdk`, `zod` (runtime) and `@netlify/functions`, `typescript`, `netlify-cli`, `@types/node` (dev). Anything else needs Gabriel's OK.
- Checks: `npx tsc --noEmit`, `node --test` (Node's own TypeScript stripping, ≥ 22.18; tests import `.ts` directly), and `node --check` on the page's extracted `<script>`.
- The spec of the Netlify move lives in `improvements/` (functional-spec, technical-spec, instructions).

The old Next.js app (Apr–Aug 2026), the `localhost:8765` server scripts (deleted 29 Aug 2026) and the local-file version of the page (File System Access API + IndexedDB handle, Aug–Sep 2026) live in git history only.

## The three-step loop (all decisions live in ONE session)

The session is one JSON document in **Netlify Blobs** (store `triage`, key `session`; step 1's work in progress is key `draft`). Only the functions touch Blobs — the page goes through `/api/session`, the skills through the `triage-session` connector (`/mcp/<MCP_SECRET>`), and there is no local file.

1. **pa-email-triage** (Cowork skill) — fetches Outlook + the Gabriel & Arina Gmail + the open tasks from **Google Tasks** (Gmail side) and **Microsoft To Do** (Outlook side), classifies, then builds a draft with `session_begin` → `session_add_emails` / `session_add_tasks` (≤ 25 per call, no `decision` / `outcome`) → `session_publish`, which checks the whole draft and makes it the live session with both `groups.*.status: "pending-review"` and `newTasks: []`. `session_begin` refuses (`WRONG_STATUS`) while the live session has a group `pending-review` or `reviewed`, unless `discard: true` — passed only after Gabriel explicitly says to discard it.
2. **triage-review.html** — any browser, signed in with Google; `GET /api/session` on load (no Gmail/Outlook/task-app calls). Gabriel accepts/rejects/edits task suggestions, sets email actions, completes/edits existing tasks, adds new ones; **Confirm & Save** flips `groups.<gabriel|gabriel-arina>.status` to `"reviewed"` and **Skip** to `"skipped"`, **for that tab only**, with one `PUT /api/session` + `If-Match`. Nothing is written until one of those two buttons is pressed.
3. **pa-email-triage-save** (Cowork skill) — `session_status`; refuses to run while either group is still `"pending-review"`; then, per group whose status is `"reviewed"` (or `"processed-with-errors"`, retrying only items whose `outcome` starts with `failed`), pages through `session_get_work` (`emails` / `tasks` / `newTasks`), applies to the task apps + the mailboxes, stamps outcomes with `session_record_outcomes` (as often as it likes), and ends with `session_finish_group`, which sets `"processed"` / `"processed-with-errors"` + `processedAt`; `"skipped"` groups are left exactly as they are. The page then shows a read-only outcome summary in each processed tab.

**There is no Notion**, no group and no task tag anywhere in the session. One backend per mailbox: Gmail → Google Tasks (`provider: "gtasks"`), Outlook → Microsoft To Do (`provider: "todo"`). A task's identity is its `key` (`"<provider>:<listId>:<taskId>"`); emails point at one with `existingTaskKey`; `url` is an optional display link and may be null. Nothing in the page is backwards compatible — every session comes from the current step 1 through `session_publish`.

## Backend (`netlify/`)

- `lib/contract.ts` — zod mirror of `triage-session.schema.jsonc` (loose objects: unknown keys survive). `checkSession()` = schema + every invariant (exactly two groups, one head per thread, head-only fields only on heads, every `existingTaskKey` matches a task, `sourceId === source:id`, vocabularies, strict ISO dates, `http(s)` task urls, no `title` in edits, no session-level `status`). `parseStep1Email` / `parseStep1Task` additionally reject `decision` / `outcome`. **If the schema file and the zod disagree, the schema file wins — fix the zod.**
- `lib/session-ops.ts` — pure, unit-tested: `canOverwrite`, `beginDraft`, `appendEmails`, `appendTasks`, `checkDraft`, `publishDraft`, `statusOf`, `groupOf`, `extractWork`, `applyOutcomes`, `finishGroup`, `checkPageWrite`. Refusals are `OpError(code)` with codes `NO_SESSION | NO_DRAFT | VALIDATION | WRONG_STATUS | CONFLICT`. Group membership: emails by `source` (`gmail` → `gabriel-arina`), tasks/newTasks by `provider` (`gtasks` → `gabriel-arina`).
- `lib/store.ts` — `readDoc` / `writeDoc` / `deleteDoc` on `getStore({ name: "triage", consistency: "strong" })`. Every write that must not lose an update is `onlyIfMatch: etag`; `modified === false` → HTTP `412` / MCP `CONFLICT`. (The `netlify dev` emulator sends no etag on reads, so `readDoc` looks it up from a listing there — production never takes that path.)
- `lib/auth.ts` — `env(name)` throws with the name when missing (no defaults). Session cookie `__Host-tr_session` = `base64url({email, exp})` + `.` + HMAC-SHA256 (`SESSION_SECRET`), 30 days, `HttpOnly; Secure; SameSite=Lax`; `requireUser` verifies with `timingSafeEqual`, checks `exp` and re-checks `ALLOWED_EMAILS` (removing an address revokes it). CSRF = `SameSite=Lax` + `Origin` check on `PUT` / `POST`; no CORS headers.
- `functions/auth-login.ts`, `auth-callback.ts`, `auth-logout.ts` — Google OAuth (`openid email`, `prompt=select_account`, `login_hint` = first allowed address), state in the 10-minute `tr_oauth` cookie, `redirect_uri` from the request origin (so localhost works). The `id_token` comes straight from Google's token endpoint over TLS, so it is decoded without JWKS; `aud`, `email_verified` and the allowlist are still checked. Not allowed → `/triage-review.html?auth=denied`.
- `functions/session.ts` — `GET` → `200` + `ETag` | `401` | `404`; `PUT` checks in order: cookie + `Origin` (`401` / `403`), `If-Match` present (`428`), etag matches (`412`), contract (`422` `{ error, details[] }`), ownership via `checkPageWrite` (`422`: `processedAt` and every `outcome` unchanged, same emails/tasks, only `pending-review → reviewed | skipped` and `skipped → pending-review`), then `writeDoc` with `onlyIfMatch` (`412`). `PUT` never creates a session.
- `functions/mcp.ts` — `/mcp/:secret`, `timingSafeEqual` against `MCP_SECRET` (mismatch → `404`), `POST` only, a new `McpServer` + stateless `WebStandardStreamableHTTPServerTransport` (JSON responses) per request, the eight `session_*` tools as thin wrappers with a 3-attempt read–patch–`onlyIfMatch` loop. Tool errors: `{ isError: true, "<CODE>: <message>" }`. Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS`, `SESSION_SECRET`, `MCP_SECRET` — Netlify UI only, never the repo (public). Known v1 weakness: the connector secret sits in the URL (claude.ai custom connectors take OAuth or nothing).
- `test/` — `node --test`; the fixture is **synthetic** (built from the schema example). Never copy a real session into the repo.

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

Two tabs: **Gabriel** (Outlook emails + `provider: "todo"` tasks) and **Gabriel & Arina** (Gmail emails + `provider: "gtasks"` tasks) — `tabProvider()` / `taskInTab()`. Each tab has its **own independent status** in `groups.<gabriel|gabriel-arina> = { status, reviewedAt, processedAt }`: `pending-review` (editable) → `reviewed` (locked, awaiting save) or `skipped` (locked, save leaves it alone; **Reopen for review** puts it back to `pending-review`) → `processed` / `processed-with-errors` (reviewed groups only; tab shows its outcome summary). The sticky bar shows counts for the current tab; **Confirm & Save — <tab>** / **Skip — <tab>** set that group's status, write the whole session (`writeGroupStatus()`, the only write path: `readSession()` → guard → `writeSession(text, etag)`), and lock that tab. The other tab is untouched and stays editable.

The save skill runs only once neither group is `pending-review`, then processes exactly the groups whose status is `reviewed`. **There is no session-level `status`** — the two group statuses are the only ones, and `groups` has exactly the keys `gabriel` / `gabriel-arina`. `ensureGroups()` only guarantees those two entries exist with a valid status; it migrates nothing.

## Session contract rules

- **`triage-session.schema.jsonc` is the authoritative, commented contract** (every key, owner per step, action vocabulary); `netlify/lib/contract.ts` mirrors it and the server enforces it. Update both whenever the page changes what it reads or writes; the skills only see the connector tools.
- The page never writes `processedAt` or per-item outcome fields — those belong to the save skill — and preserves every field it doesn't touch (the whole JSON is mutated in place and written back). The server refuses a `PUT` that changes anything the page doesn't own (`422`).
- Stale guard = status + etag. Confirm / Skip / Reopen re-read the session and refuse to write if *this group* is no longer in the state the page last saw (toast `Not saved — <tab> is already "<status>". Reload to see it.`); the other group's entry and items are adopted from the stored copy if it has moved on (`adoptGroupFromDisk`, matching emails by `id` and tasks by `key`). The `PUT` then carries the etag of that re-read; if the stored session changed in any other way meanwhile the server answers `412` → "Not saved — session changed. Reload." and `session.groups` is rolled back. Sign-in expired on save → "Signed out — sign in and press again" + a header **Sign in** link (`target="_blank"`, so in-memory edits survive).
- **No backwards compatibility.** `applyLoadDefaults()` fills in only what step 1 may omit (the `decision` blocks, `existingTasks`, `newTasks`) — there is no legacy handling and no migration path anywhere in the page.
- The save skill must understand the action vocabulary above (`archive | flag | create-task | update-task | complete-task | cancel-task`).
- Page CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:` — no token is readable by JS, so a missed escape cannot exfiltrate mail. Still route every email-derived string through `esc()` before `innerHTML`; the two places that can't (`formatDate`, task `url` in an `href`) are covered by the contract (strict ISO dates, `http(s)` urls).

## Version stamp

The page shows a build stamp in the header: `<span class="version" id="app-version">` inside the `<h1>`, format **`v<yyyy>.<MM>.<dd> - <HH>-<mm>`** (local time, 24-hour), e.g. `v2026.09.01 - 11-43`.

- It is a **hardcoded string in the HTML** — nothing computes it at runtime, so it reflects when the page was last pushed, not when it is opened.
- **Bump it only as part of a commit + push**, in the same commit as the change: set it to the local time at that moment (`date "+%Y.%m.%d - %H-%M"`), then commit and push. Never bump it on an edit that is not being pushed, and never bump it twice for one push.
- If several changes are committed together, the stamp is set once, on that commit.

## Working on the page

- One file, vanilla JS, CSS variables for light/dark (`--accent`, `--green`, `--muted`, etc. are defined in both `:root` and the dark block — define new colours in both).
- Responsive: three media blocks at the end of the stylesheet — `max-width: 960px` (email rows become date / email / category + action via grid areas on `.cell-date` `.cell-main` `.cell-cat` `.cell-action`), `max-width: 600px` (everything stacks, full-screen modal, scrolling filter bar) and `(hover: none), (pointer: coarse)` (bigger targets, label × always visible). Phones and iPads run the page.
- Quick syntax check after edits: extract the `<script>` body and run `node --check` on it. After backend edits: `npx tsc --noEmit` and `node --test`.
- Local runtime checks: `npx netlify dev` (env comes from the linked site — never from a file in the repo). Seed the emulated store through the MCP tools with a throwaway script in the scratchpad; never print `MCP_SECRET`, never write real session data into the repo.
- `improvements.md` is the backlog + change log; add to it when making a deliberate UX change.
