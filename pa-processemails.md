# PA Email Triage — App Spec

## Purpose

A Python script that connects to Gmail and Outlook via MCP connectors, fetches inbox emails, classifies each one using Claude, and outputs a single interactive HTML file for review. Gabriel can adjust classifications, then flag important emails and archive noise in one click.

---

## MCP Connectors

### Gmail
| Account | Connector | Tool prefix |
|---|---|---|
| gabrielserraaus@gmail.com | Claude AI Gmail MCP | `mcp__claude_ai_Gmail__gmail_*` |

Tools used:
- `gmail_search_messages` — fetch inbox emails
- `gmail_read_message` — get full body for classification

### Outlook
| Account | Server | Location |
|---|---|---|
| gabriel.serra@outlook.com.au | outlook-mcp (local) | `C:\Users\gabri\Documents\Claude\mcp-server\outlook-mcp` |

Tools used:
- `list_emails(folder="inbox", top=50)` — fetch inbox emails (returns id, subject, from, receivedAt, preview)
- `read_email(id)` — get full body for classification
- `flag_email(id, flagStatus="flagged")` — flag as Important
- `move_email(id, destinationFolder="Old")` — archive Not Important emails

---

## Step 1 — Fetch & Classify

For each account, fetch all emails currently in the **Inbox** folder.

Per email, extract:
- Date received
- Subject
- Sender name or email
- Body — first 500 characters of plain text (full body if under 500 characters)

Claude then assigns each email an initial **Category** and a one-line **Action** suggestion (see Classification Rules below).

---

## Step 2 — Generate HTML File

Output a single self-contained HTML file to:
`C:\Users\gabri\Documents\Claude\Personal Assistance\email-triage.html`

### Layout

Two sections on the page — **Gmail** and **Outlook** — each with its own table and filter controls.

### Table Columns

| Column | Description |
|---|---|
| **Date** | Date received, formatted as `DD MMM YYYY HH:MM` |
| **Subject** | Email subject — links to `https://mail.google.com/mail/u/0/#inbox/{messageId}` (Gmail) or best-effort Outlook deep link |
| **From** | Sender name or email |
| **Summary** | One-sentence summary of the email content |
| **Action** | What Gabriel should do, in a few words (e.g. "Reply with availability", "Review attachment", "No action needed") |
| **Category** | Dropdown: **Important** / **FYI** / **Not Important** — pre-set to Claude's classification, editable |

### Classification Rules

| Category | When to use |
|---|---|
| **Important** | Requires a response or action — direct questions, meeting requests, approvals, client emails, financial notifications needing action |
| **FYI** | Worth knowing but no action needed — newsletters Gabriel reads, status updates, receipts, confirmations, team announcements |
| **Not Important** | Noise — marketing, promotions, automated notifications with no value, social media digests |

### Category Dropdown Behaviour
- Each row's dropdown is pre-set to Claude's classification
- Gabriel can change any category before acting
- Row background updates instantly on change: Important = `#fce4ec`, FYI = `#e3f2fd`, Not Important = `#f5f5f5`

### Sorting & Filtering
- Column headers are clickable to sort ascending/descending
- Filter buttons above each table: **All | Important | FYI | Not Important**
- Default: all emails, sorted by date descending (newest first)

### Styling
- Clean, modern — sans-serif font, subtle borders, alternating row shading
- Section headers clearly separate Gmail and Outlook
- Responsive at different viewport widths

---

## Step 3 — Action Buttons

Two buttons appear at the top and bottom of the page. Both follow the same pattern:
1. Show a confirmation dialog (e.g. "Flag 5 important emails across Gmail and Outlook?")
2. Execute via MCP connector
3. Disable the button and show a loading state during processing
4. On completion, show a count (e.g. "Flagged 3 Gmail, 2 Outlook") and fade/strikethrough affected rows

### "Flag Important"
- Targets all emails where Category = **Important** (Claude-assigned or Gabriel-changed)
- Gmail: stars those emails via the Gmail MCP
- Outlook: flags those emails via the Outlook MCP

### "Archive Not Important"
- Targets all emails where Category = **Not Important**
- Gmail: archives those emails (removes Inbox label) via the Gmail MCP
- Outlook: moves those emails to the **Old** folder via the Outlook MCP
