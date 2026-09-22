# Instructions — move the triage loop to Netlify

Runbook, in execution order. What the system does: [functional-spec.md](functional-spec.md). How to build it: [technical-spec.md](technical-spec.md).

## What and why

- **Problem:** the review page needs desktop Edge/Chrome (File System Access API) and all three steps share a local file, so no phone review and the loop is tied to this PC.
- **Change:** host the page on Netlify, keep the session in **Netlify Blobs**, sign in with **Google** (one allowed account), and give the two skills a **remote MCP connector** to the same store.
- **Unchanged:** the session JSON shape, the decision model, tabs, statuses, everything Gabriel does on the page.
- **Not solved here:** `outlook-mcp` and `gabrielandarina-google-tasks` stay local, so the skills still run on the PC.
- **Safe to do gradually:** work happens on branch `netlify`; `master` + GitHub Pages + the local file keep working until step 8.

## Who does what

| # | Who                       | Step                                                               | Done when                                                  |
| - | ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| 1 ✅ | Gabriel                | Netlify site, Google OAuth client, env vars                        | **Done 21 Sep 2026** — site `https://pa-email-triage.netlify.app` |
| 2 | Claude Code               | **Prompt A** — build                                        | typecheck + unit tests pass                                |
| 3 | Gabriel, then Claude Code | link the CLI, then**Prompt B** — verify locally             | checklist reported, all seen working                       |
| 4 | Claude Code, then Gabriel | **Prompt C** — docs, commit, push; switch production branch | site live on`https://<site>.netlify.app`                 |
| 5 | Gabriel                   | add the connector on claude.ai; phone check                        | connector lists 8 tools; Skip → Reopen works on the phone |
| 6 | Cowork                    | **Prompt D** — update both skills                           | both skills saved, diff reviewed                           |
| 7 | Gabriel + Cowork          | one full loop                                                      | step 3 reports applied; page shows the outcome summary     |
| 8 | Claude Code + Gabriel     | **Prompt E** — cut over                                     | `master` = `netlify`, GitHub Pages off                 |

Never paste a secret, the `/mcp/<secret>` URL or the mailbox address into the repo, a commit message or a prompt that ends up in a file — the repo is public.

---

## Step 1 — Gabriel: accounts and config ✅ done 21 Sep 2026

`<site>` everywhere below = `pa-email-triage`. Google OAuth client lives in the GCP project `claude-mcp-gabrielandarina`, both redirect URIs registered. `.gitignore` now covers `*.env`, `.env*` and `.playwright-mcp/`.

1. **Netlify** → Add new site → Import from GitHub → this repo. Branch `master` for now (the `netlify` branch doesn't exist yet). Leave build command empty. Note the site URL: `https://<site>.netlify.app`.
2. **Google Cloud console** → APIs & Services → Credentials → Create OAuth client ID → *Web application*.

   - Authorised redirect URIs: `https://<site>.netlify.app/api/auth/callback` and `http://localhost:8888/api/auth/callback`
   - OAuth consent screen: External; scopes `openid` and `email` only (non-sensitive — no verification). Either publish it, or keep it in Testing and add the Gabriel & Arina Gmail as a test user.
3. Generate two secrets (run twice, PowerShell):

   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString("x2") })
   ```
4. **Netlify** → Site configuration → Environment variables:

   | Name                     | Value                                                                                     |
   | ------------------------ | ----------------------------------------------------------------------------------------- |
   | `GOOGLE_CLIENT_ID`     | from step 2                                                                               |
   | `GOOGLE_CLIENT_SECRET` | from step 2 (mark as secret)                                                              |
   | `ALLOWED_EMAILS`       | the Gabriel & Arina Gmail address                                                         |
   | `SESSION_SECRET`       | first generated value (secret)                                                            |
   | `MCP_SECRET`           | second generated value (secret) — also save it in your password manager, step 5 needs it |

## Step 2 — Claude Code: build

New Claude Code session in this repo. Paste:

```text
Prompt A — build

Read, in this order: improvements/functional-spec.md, improvements/technical-spec.md,
CLAUDE.md, triage-session.schema.jsonc. They are the full brief — there is no other context.

Task: implement technical-spec.md sections 2–9 on a new branch `netlify` (create it from master).
- Backend: netlify.toml, package.json, tsconfig.json, .gitignore, netlify/lib/*, netlify/functions/*.
- Tests: test/*.test.ts with a SYNTHETIC fixture built from the schema example. Never copy real
  session data into the repo — it is public.
- Page: git mv triage-review.html public/triage-review.html, then the delete/add/change list in
  section 9. Do not touch the decision logic, rendering, or the status guard / adoptGroupFromDisk.
- Dependencies: exactly the six in section 2, already approved. Anything else: ask first.
- Resolve open items 1–4 in section 12 as you reach them: look up APIs with context7, report what
  you found, ask before deviating from the spec.

Rules: this touches more than 3 files, so show me the plan first. TypeScript strict, no `any`, ESM.
No mocks or stubs to make a test pass. Do not commit, push, or bump the version stamp — that is a
later step. Do not edit CLAUDE.md, the schema file, README.md or improvements.md yet.

Done when: `npx tsc --noEmit` is clean, `node --test` passes, and `node --check` passes on the
page's extracted <script>. Show me the output of all three, and list anything you could not verify.
```

## Step 3 — verify locally

**Gabriel first** (interactive, one-off), in the repo folder:

```powershell
npx netlify login
npx netlify link
```

Have Chrome open with the Playwright extension connected, signed in to Google with the Gabriel & Arina account (and a second Google account available for the "not allowed" check).

**Then Claude Code** (same session as step 2, or a new one):

```text
Prompt B — verify locally

Read improvements/technical-spec.md section 10. Branch `netlify`.

Start `npx netlify dev` in the background (http://localhost:8888). Attach Playwright to my open,
signed-in browser tab (--extension) — never launch a fresh browser.

Run the "Local" checklist, items 1–6, in order. For item 2, read the real session from
D:\Gabriel\OneDrive\Claude\Workspace\PA\Email Triage\triage-session.json in place, with a
throwaway script in your scratchpad directory — nothing from that file may be written into the
repo. Read MCP_SECRET from the environment netlify dev provides; never print it.

For each item report what you SAW (status codes, toasts, counts), not what you expected. Fix
failures in the code and rerun the affected items. Do not weaken a check to make it pass.
Finish with: a pass/fail table, and the list of things that cannot be tested from this machine.
Do not commit or push.
```

## Step 4 — docs, commit, push

```text
Prompt C — docs, commit, push

Branch `netlify`, verification from Prompt B is green.

1. Update the docs listed in improvements/technical-spec.md section 12 item 5: CLAUDE.md,
   triage-session.schema.jsonc (header comments only — the JSON shape is unchanged), README.md,
   and a change-log entry in improvements.md. Keep each file's existing style. Remove every claim
   that is no longer true (File System Access API, IndexedDB handle, "no build, no server, no
   dependencies", "Phones/iPads still can't run the page", the local file path).
2. Bump the version stamp in public/triage-review.html once, to the current local time, per the
   "Version stamp" rule in CLAUDE.md.
3. Check `git status` and the full diff for secrets, the /mcp secret, the mailbox address and any
   real email content. Stop and tell me if you find any.
4. Commit everything on `netlify` as one commit and push the branch to origin.

Show me the diff summary before committing.
```

**Gabriel:** Netlify → Site configuration → Build & deploy → Branches → **Production branch = `netlify`** → trigger a deploy. Open `https://<site>.netlify.app` on the PC and sign in.

## Step 5 — Gabriel: connector and phone

1. claude.ai → Settings → Connectors → **Add custom connector**
   - Name: `triage-session`
   - URL: `https://<site>.netlify.app/mcp/<MCP_SECRET>`
   - No OAuth fields.
2. Open the connector: it should list 8 tools — `session_status`, `session_begin`, `session_add_emails`, `session_add_tasks`, `session_publish`, `session_get_work`, `session_record_outcomes`, `session_finish_group`.
3. On the iPhone/iPad: open `https://<site>.netlify.app`, sign in, **Skip** then **Reopen for review** on one tab (non-destructive).

If the connector fails to connect, that is open item 1 (MCP transport) — go back to Claude Code with the exact error.

## Step 6 — Cowork: update the skills

Cowork session with the `triage-session` connector enabled. Paste:

```text
Prompt D — move both triage skills from the local file to the triage-session connector

Update two skills with the skill-creator skill: `pa-email-triage` and `pa-email-triage-save`.
Change ONLY how they read and write the triage session. Every other rule — classification,
threads, task matching, notes format, due dates, mailbox actions, outcome wording, reports —
stays word for word. Show me a diff of each skill before saving.

BACKGROUND
The session no longer lives in a local `triage-session.json`. It lives in a cloud store reached
only through the connector named `triage-session`. The JSON shape of emails, existingTasks,
newTasks and groups is unchanged. The session is too large to move in one call, so the tools are
granular and the skills never read or write the whole JSON. The connector validates everything:
on a `VALIDATION:` error, fix the named field and resend that batch.

Still local and unchanged: `task-context.md` and `triage-summary.md`. Their folder is now
`PA/Email Triage/` in the workspace — replace every `Personal Assistance/email-triage/` path.
Remove every reference to `C:\Users\gabri\Documents\Claude Code\Code\pa-email-triage\` and to
`triage-session.schema.jsonc`; the connector enforces the contract instead.

pa-email-triage (step 1) — replace "Step 6 — Write the temp triage JSON" file writing with:
 1. `session_status`. Overwrite gate, same rule as today: continue only if `exists` is false or
    every group status is `processed`, `processed-with-errors` or `skipped`. If a group is
    `pending-review` or `reviewed`, stop and ask Gabriel whether to discard it or run
    pa-email-triage-save first. Only if he says discard, pass `discard: true` in the next call.
 2. `session_begin` { generatedAt, mailboxes, gmailLabels, discard? }
 3. `session_add_emails` { emails: [...] } — at most 25 per call, repeat until all are sent.
    Same email objects as today. Never include `decision` or `outcome`.
 4. `session_add_tasks` { existingTasks: [...] } — at most 25 per call. Never `decision`/`outcome`.
 5. `session_publish` — on `VALIDATION:` fix what it lists (it names thread / email / task) and
    publish again. The connector sets both groups to `pending-review` and `newTasks: []` itself,
    so the skill no longer writes `groups` or `newTasks`.
 Keep the inline JSON example as the description of one email / one task. Keep writing
 `triage-summary.md` locally. Tell Gabriel to open the review page (no file to open any more).

pa-email-triage-save (step 3) — replace "Read the file" and "Update triage-session.json in place":
 1. `session_status`. Pre-gate unchanged: if either group is `pending-review`, stop, touch
    nothing, print the same message. `exists: false` → stop and report. Classify groups exactly
    as today (`reviewed` eligible, `processed-with-errors` retry, `skipped`/`processed` left alone).
 2. Per eligible group call `session_get_work` { group, kind, cursor? } for kind `emails`,
    then `tasks`, then `newTasks`, following `nextCursor` until it is null.
      - emails items: { id, source, threadId, threadRole, inInbox, subject, isFlagged, labels?,
        existingTaskKey?, action, flagged, wantedLabels?, task?, outcome? }.
        `action` is the old `decision.emailAction`; `flagged` is `decision.flagged`;
        `wantedLabels` is `decision.labels`; `task` is already `decision.task ?? suggestedTask`
        and is present only for `create-task`.
      - tasks items: only tasks with something to do: { key, provider, listId, title, status,
        notes, dueDate, link, threadId, complete, cancel, edits, outcome? }.
      - newTasks items: { index, title, notes, provider, dueDate, outcome? }.
    For a `processed-with-errors` group the connector already returns only the failed items.
 3. Apply to the mailboxes and task apps exactly as today.
 4. `session_record_outcomes` { group, emails: [{id, outcome}], tasks: [{key, outcome}],
    newTasks: [{index, outcome}] } — same outcome strings as today. Call it after each batch of
    work, not only at the end, so an interrupted run keeps its progress. Report anything it
    returns in `unknown`.
 5. `session_finish_group` { group, status: "processed" | "processed-with-errors" }. The
    connector stamps `processedAt`; the skill no longer writes it.
 Drop the "preserve every key you don't own" and "no migration / legacy keys" file checks — the
 connector owns that now. On `WRONG_STATUS:` or `NO_SESSION:` stop and report the message as is.

If the `triage-session` connector is not available in the session, both skills stop and say so —
never fall back to a local file.
```

## Step 7 — one full loop

1. Cowork: run `pa-email-triage`. Expect a summary and "open the review page".
2. Phone or PC: review, **Confirm & Save** one tab, **Skip** or confirm the other.
3. Cowork: run `pa-email-triage-save`. Expect the usual per-group report.
4. Reload the page: processed tab shows its outcome summary.

Anything off → back to Claude Code with the exact tool error or toast text.

## Step 8 — cut over

```text
Prompt E — cut over

The full loop has run successfully from the `netlify` branch.
1. Confirm `master` has no commits that `netlify` lacks (git log master..netlify / netlify..master).
2. Fast-forward `master` to `netlify` and push. No new version stamp — the page did not change.
3. Tell me when that is done so I can switch Netlify's production branch to `master` and turn off
   GitHub Pages. Do not change repo settings yourself.
4. After I confirm, update the Live URL in CLAUDE.md and README.md if it still mentions
   github.io, commit and push.
```

**Gabriel:** Netlify production branch → `master`; GitHub → Settings → Pages → disable. The Google redirect URIs and the connector URL don't change (same site).

## Rollback

- **Before step 8:** nothing to undo — `master`, GitHub Pages and the local-file page were never touched. Restore the previous skill versions on claude.ai if step 6 was done.
- **After step 8:** re-enable GitHub Pages on the last commit before the merge, restore the previous skill versions.

## Follow-ups (not part of this work)

- OAuth on the MCP endpoint instead of the secret in the URL.
- Host `outlook-mcp` and `gabrielandarina-google-tasks` remotely — what actually gets the skills off the PC.
- Dead `outlook` server in the repo's `.mcp.json`; stale `Personal Assistance` path in `.claude/settings.json`.
