# PA Email Triage

A local web app to review, reclassify, and action emails from Gmail and Outlook.

---

## Overview

PA Email Triage is a personal inbox management tool that combines Claude's AI classification with a lightweight browser-based review interface.

Each session works like this: a Claude Code skill connects to your Gmail and Outlook inboxes via MCP connectors, fetches inbox emails, and uses Claude to summarise each one and assign it an initial category — **Important** (needs your attention), **FYI** (worth knowing, no action needed), or **Not Important** (noise). The results are written to local JSON files and loaded into a single-page web app.

In the app you can review every email in one place, see what Claude suggested, override any classification, and sort or filter the list however you like. Each row also shows whether an email is already flagged in your mail client alongside what action will be taken. When you're happy, one click on **Update Emails** applies the actions directly to your mailboxes — flagging Important emails and moving everything else out of your inbox.

---

## How it works

The workflow has two stages:

```
Fetch skill (Claude Code)           Web App (localhost:3000)
─────────────────────────           ────────────────────────
Fetch Gmail + Outlook         →     Review & reclassify, then
via MCP connectors                  "Update Emails" executes the
Write JSON source files             actions via Gmail/Graph APIs
```

There is no separate "execute" skill anymore — the app talks to the Gmail API
and Microsoft Graph itself, reusing the MCP servers' saved OAuth tokens.

> **Important:** executing actions changes the emails' message IDs (Outlook IDs
> change when a message moves folders). After an update, re-run the fetch skill
> to refresh the source files before triaging again — a second execute from the
> same stale snapshot will fail with "object not found" errors.

---

## Project structure

```
pa-email-triage/
├── app/                       # Next.js App Router directory
│   ├── layout.js              # Root layout (wraps all pages, imports global CSS)
│   ├── page.js                # Home page (renders the EmailTriage component)
│   ├── globals.css            # All styles
│   └── api/
│       ├── emails/route.js           # GET /api/emails — reads email JSON files
│       └── execute-actions/route.js  # POST /api/execute-actions — applies triage
├── components/
│   └── EmailTriage.js         # Main interactive component (client-side React)
├── next.config.mjs            # Next.js configuration
├── package.json               # Dependencies (next, react, googleapis, msal, axios)
└── README.md
```

Email source files live outside the repo, in the Personal Assistance workspace:
`D:\Gabriel\OneDrive\Claude\Workspace\Personal Assistance\email-source\`

---

## Setup & usage

### 1. Start the dev server

```bash
npm install   # first time only
npm run dev
```

Then open: [http://localhost:3000](http://localhost:3000)
(Or run `start-triage.bat`, which does both.)

### 2. Populate email data (fetch skill)

Run the **pa-email-triage-retrieve** skill. It will:
- Connect to Gmail (`gabrielandarina@gmail.com`) via the Gmail MCP connector
- Connect to Outlook (`gabriel.serra@outlook.com.au`) via the local `outlook-mcp` server
- Fetch inbox emails, classify each one using Claude
- Write `gmail-emails.json` and `outlook-emails.json` to the workspace `email-source` folder

Reload the browser page after running it.

### 3. Review in the app

- Emails are colour-coded: **pink** = Important, **blue** = FYI, **grey** = Not Important
- Change any category with the buttons — row colour and status update instantly
- Sort by **Date** or **From** (click column header)
- Filter by category using the buttons above each table
- The **Status** column shows:
  - Current flag state (`🚩 Flagged` / `— Not flagged`)
  - What will happen (`→ Flag` / `→ Archive` / `→ Do nothing`)

### 4. Update Emails

Click **Update Emails**. The app POSTs your decisions to `/api/execute-actions`,
which applies them directly:

| Category | Outlook |
|---|---|
| Important | Flag |
| FYI | Nothing |
| Not Important | Move to the built-in **Archive** folder |

A results dialog shows the counts and any errors.

**Gmail execution is temporarily disabled** — Gmail is review-only for now. The
update button is only enabled for Outlook, and the API skips any Gmail payload.
To re-enable, set `GMAIL_EXECUTION_ENABLED = true` in
`app/api/execute-actions/route.js` (Gmail: Important → star, Not Important →
add `OLD` label + remove from Inbox).

---

## JSON formats

### email-source/gmail-emails.json / outlook-emails.json

Produced by the fetch skill. One array of email objects per file:

```json
[
  {
    "id": "abc123",
    "date": "2026-03-28T10:30:00Z",
    "subject": "Meeting tomorrow",
    "from": "John Smith <john@example.com>",
    "summary": "John is asking to reschedule tomorrow's meeting.",
    "action": "Reply with availability",
    "category": "Important",
    "isFlagged": false
  }
]
```

| Field | Description |
|---|---|
| `id` | Unique message ID from Gmail or Outlook |
| `date` | ISO 8601 received timestamp |
| `subject` | Email subject |
| `from` | Sender — `Name <email>` format preferred |
| `summary` | One-sentence summary (generated by Claude) |
| `action` | Suggested action (generated by Claude) |
| `category` | `Important` / `FYI` / `Not Important` |
| `isFlagged` | Whether the email is already flagged in the mail system |

### POST /api/execute-actions request body

Built by the UI (`buildOutput()`); only the active provider is included:

```json
{
  "outlook": {
    "generated": "2026-08-06T14:00:00Z",
    "total": 50, "important": 3, "doNothing": 17, "archive": 30,
    "actions": [
      { "id": "abc123", "subject": "...", "triage": "archive" }
    ]
  }
}
```

`triage` is `"archive"` (Not Important), `"important"` (Important), or
`"do-nothing"` (FYI). The response returns per-provider counts:
`{ archived, starred/flagged, skipped, failed, errors[] }`.

---

## MCP connectors / auth

| Account | Connector | Used for |
|---|---|---|
| gabrielandarina@gmail.com | gmail-emails MCP (local) | Fetch; execution disabled for now (see flag above) |
| gabriel.serra@outlook.com.au | outlook-mcp (local) | Fetch; app reuses its `token_cache.json` to execute actions |

Both servers live under:
`C:\Users\gabri\Documents\Claude Code\mcp-server\`
