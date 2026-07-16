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

Next.js 15 App Router + React 19. Single-page triage UI (`components/EmailTriage.js`) backed by four API routes under `app/api/`. The app is a bridge between an **external workspace folder** and Gmail/Outlook mail backends.

### External workspace (hardcoded absolute paths)

Two Windows paths are hardcoded into the API routes and must exist:

- `C:\Users\gabri\Documents\Claude\Workspace\Personal Assistance\email-source\` — input: `gmail-emails.json`, `outlook-emails.json` (produced by Skill 1)
- `C:\Users\gabri\Documents\Claude\Workspace\Personal Assistance\email-triage\` — output: `gmail-actions.json`, `outlook-actions.json`

If you change these, update `EMAIL_SOURCE` / `EMAIL_TRIAGE` / `TRIAGE_DIR` constants in the route files.

### API routes

| Route | Purpose |
|---|---|
| `GET  /api/emails` | Reads both source JSON files, returns `{gmail, outlook, gmailModified, outlookModified}`. Missing file → empty array (not an error). |
| `POST /api/save-actions` | Writes the UI payload to `{gmail,outlook}-actions.json` for downstream Skill 2 consumption. |
| `POST /api/execute-actions` | **Executes triage directly against Gmail/Outlook** — bypasses Skill 2 entirely. |
| `/api/actions/{gmail,outlook}` | Additional action endpoints. |

### execute-actions: direct backend calls

`app/api/execute-actions/route.js` is the non-obvious part. Instead of calling MCP servers, it reuses their OAuth token files directly to talk to Gmail/Graph APIs:

- **Gmail** — loads `credentials.json` + `token.json` from `C:\Users\gabri\Documents\Claude\mcp-server\gmail-emails\` via `googleapis`. Auto-persists refreshed tokens back to `token.json`.
- **Outlook** — loads `token_cache.json` from `C:\Users\gabri\Documents\Claude\mcp-server\outlook-mcp\` via `@azure/msal-node` silent token refresh, then calls Microsoft Graph via `axios`. Azure client ID is hardcoded.

Triage action semantics (`action.triage` values): `"archive" | "important" | "do-nothing"`.

- Gmail archive → add `OLD` label + remove `INBOX`. Gmail important → add `STARRED`.
- Outlook archive → move to hardcoded `OUTLOOK_OLD_FOLDER_ID` folder. Outlook important → set `flag.flagStatus = "flagged"`.

After processing (success or failure), both action JSON files are overwritten with an empty template.

If either MCP server's token file is missing, the route reports a per-provider error rather than crashing — the other provider still processes.

### Data shapes

Source email objects and action payloads are documented in `README.md` and are the contract between this app and the two external Claude Code skills (Skill 1 fetches+classifies, Skill 2 would execute — though `/api/execute-actions` now does Skill 2's job in-process).

## User context

Owner is new to Next.js. Existing route files use heavy explanatory comments about App Router conventions (`route.js` → URL mapping, `Response.json()` vs Express patterns, etc.) — match that style when adding new routes or modifying existing ones.
