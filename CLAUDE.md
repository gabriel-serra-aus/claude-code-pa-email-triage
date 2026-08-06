# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # Next.js dev server at http://localhost:3000
npm run build   # production build
npm start       # run production build
```

No test suite, linter, or typecheck is configured.

## Architecture

Next.js 15 App Router + React 19. Single-page triage UI (`components/EmailTriage.js`) backed by two API routes under `app/api/`. The app is a bridge between an **external workspace folder** (email input) and the Gmail/Outlook mail backends (action output).

The old file-based action handoff (`/api/save-actions`, `/api/actions/*`, the `*-actions.json` files, and the Cowork `pa-action-emails` skill) was retired in Aug 2026 — the app now executes actions itself.

### External workspace (hardcoded absolute path)

One Windows path is hardcoded into `app/api/emails/route.js` and must exist:

- `D:\Gabriel\OneDrive\Claude\Workspace\Personal Assistance\email-source\` — input: `gmail-emails.json`, `outlook-emails.json` (produced by the fetch skill `pa-email-triage-retrieve`)

If you change it, update the `EMAIL_SOURCE` constant in that route file.

### API routes

| Route | Purpose |
|---|---|
| `GET  /api/emails` | Reads both source JSON files, returns `{gmail, outlook, gmailModified, outlookModified}`. Missing file → empty array (not an error). |
| `POST /api/execute-actions` | **Executes triage directly against Gmail/Outlook** using the payload in the request body. |

### execute-actions: direct backend calls

`app/api/execute-actions/route.js` is the non-obvious part. Instead of calling MCP servers, it reuses their OAuth token files directly to talk to Gmail/Graph APIs:

- **Gmail** — loads `credentials.json` + `token.json` from `C:\Users\gabri\Documents\Claude Code\mcp-server\gmail-emails\` via `googleapis`. Auto-persists refreshed tokens back to `token.json`. **Currently disabled** via the `GMAIL_EXECUTION_ENABLED = false` flag at the top of the route (temporary, owner plans to re-enable) — while false, gmail payloads are reported as skipped and no Gmail API call is made.
- **Outlook** — loads `token_cache.json` from `C:\Users\gabri\Documents\Claude Code\mcp-server\outlook-mcp\` via `@azure/msal-node` silent token refresh, then calls Microsoft Graph via `axios`. Azure client ID is hardcoded.

Triage action semantics (`action.triage` values): `"archive" | "important" | "do-nothing"`.

- Gmail archive → add `OLD` label + remove `INBOX`. Gmail important → add `STARRED`.
- Outlook archive → move to the built-in Archive folder via Graph's well-known `"archive"` destination (no hardcoded folder ID — the mailbox has two folders named "OLD", which made the old hardcoded-ID approach confusing). Outlook important → set `flag.flagStatus = "flagged"`.

If either MCP server's token file is missing, the route reports a per-provider error rather than crashing — the other provider still processes.

**Stale-ID gotcha:** Outlook message IDs change when a message moves folders, so executing actions invalidates the IDs in the source JSON. A second execute from the same snapshot fails with `ErrorItemNotFound` ("The specified object was not found in the store"). The fetch skill must re-run after every execute.

### Data shapes

Source email objects and the execute payload are documented in `README.md`. The source files are the contract between this app and the external fetch skill (`pa-email-triage-retrieve`, which fetches + classifies).

## User context

Owner is new to Next.js. Existing route files use heavy explanatory comments about App Router conventions (`route.js` → URL mapping, `Response.json()` vs Express patterns, etc.) — match that style when adding new routes or modifying existing ones.
