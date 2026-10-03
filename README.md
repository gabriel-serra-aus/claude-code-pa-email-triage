# PA Email Triage

Turns an inbox into tasks in three steps: Claude prepares, Gabriel reviews, then Claude applies the decisions. It runs separately for each of two sides that never mix.

**Live:** https://pa-email-triage.netlify.app · **Full spec:** [`docs/functional-spec.md`](docs/functional-spec.md) · **Session contract:** [`triage-session.schema.jsonc`](triage-session.schema.jsonc) (wins over everything) · **Working on the code:** [`CLAUDE.md`](CLAUDE.md)

## The two sides

| Side | Mailbox | Task app | Review page |
|---|---|---|---|
| `gabriel` | Outlook | Microsoft To Do | `/triage-review.html?type=gabriel` |
| `gabriel-arina` | shared Gmail | Google Tasks | `/triage-review.html` |

Each side has its own session, rules, run summary and status. Neither side ever waits on the other.

## The loop

1. **`pa-email-triage`** (Cowork skill) reads the side's rules, inbox (one row per thread) and tasks. It matches threads to existing tasks, classifies each thread as Important / FYI / Not Important, and suggests tasks. It then publishes a session and a run summary. It only suggests: nothing is written to the mailbox or the task app.
2. **Review page** (any browser, Google sign-in) — Gabriel sets the category and action for each thread, sets the star and labels, and edits tasks. **Confirm & Save** or **Skip**.
3. **`pa-email-triage-save`** (Cowork skill) applies the confirmed decisions. It creates, updates or completes tasks, keeps or archives each thread, and sets the star/flag and Gmail labels. It then stamps an outcome on each item. Nothing is ever deleted or un-archived.

Status per side: `pending-review → reviewed | skipped → processed | processed-with-errors`.

The **Rules page** (`/rules.html`, `?type=gabriel` for Gabriel) edits each side's triage rules: tracked senders, properties, labels, topics, ignore list and rules. Changes apply from the next prepare run.

## Parts

- `public/` — the two pages (vanilla JS, one file each).
- `netlify/functions/` — sign-in, `/api/session`, `/api/context` and `/api/summary`, plus the `triage-session` MCP connector the skills use.
- `netlify/lib/` — the contract (zod), session logic, context, storage (Netlify Blobs).
- `test/` — `node --test`, synthetic fixtures only (the repo is public).

## Run and check

```
npx netlify dev        # http://localhost:8888 (needs `netlify link`)
npx tsc --noEmit
node --test
```

Deploy: work on `netlify`, fast-forward `master`, push.
