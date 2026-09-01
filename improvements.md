# improvements.md

Two changes ship together:

- **Native tasks.** Google Tasks for the Gabriel & Arina Gmail, Microsoft To Do for Outlook.
- **Thread awareness.** One row per conversation; the task points at the **latest** email
  in the thread.

---

## Rules

1. **No Notion, no legacy, no migration.** No Notion call in any step; the Notion
   group/list/tag structure is gone. Nothing reads or upgrades an older session file
   either — this is a fresh start, so every migration path is deleted rather than kept.
   `GROUPS`, `TAGS`, `edits.tags`, `syncTaskFromLabels`, `syncLabelsFromTags` and the Group
   select are deleted.
2. **One backend per mailbox.** Gmail email → Google Tasks (default list). Outlook email →
   Microsoft To Do (default list). No cross-posting, no list picking.
3. **The two tabs are Gabriel and Gabriel & Arina.** Group keys `gabriel` and `gabriel-arina`.
   Gabriel = Outlook emails + `todo` tasks. Gabriel & Arina = Gmail emails + `gtasks` tasks.
   `?type=gabriel` / `?type=gna` are unchanged.
4. **Task identity is a key**, not a url: `gtasks:<listId>:<taskId>` / `todo:<listId>:<taskId>`.
   Emails carry `existingTaskKey`. `url` is an optional display link.
5. **The task points at the latest email in its thread.** Its `Latest email:` line is
   repointed to the newest message on every run; on To Do, `linkedResources[0]` too.
6. **Title is written once, at creation.** Never rename an existing task — Gabriel may have
   renamed it himself. There is no `title` key in `edits`, and the title field of a tracked
   task is read-only on the page.
7. **Title prefix from property labels** (creation only, see table).
8. **Notes have two sections** (see format). `-- notes` is Gabriel's, typed in the task
   itself; step 1 **reads it and takes it into account** when writing the summary, and never
   modifies it. Everything below `-- auto --` is regenerated every run.
9. **Tags are gone from tasks.** Gmail labels stay Gmail-only — still shown and editable on
   Gmail rows, but they no longer mirror anything on a task. Their only task-side effect is
   the title prefix.
10. **Done and Cancelled both save as completed** (both backends only have
    `needsAction` / `completed`); cancel adds a `Cancelled DD Mon: …` line to the auto block.
11. **An open thread stays whole in the inbox**, only the head starred. Completing or
    cancelling archives and unstars the whole thread. An email already archived
    (`inInbox: false`) is never moved back to the inbox.
12. **Closed tasks are read-only.** A matched task that is already `completed` shows a badge
    and offers `archive` as the only action. No reopen.

## Notes format

```
-- notes
<Gabriel's own text, typed in the task — read by step 1, never written by it>

-- auto --
One line: what this is and what needs to be done.
26 Aug — Ana sent the first quote
30 Aug — asked for the itemised version
31 Aug — quote v2 arrived, approve by Fri
Latest email: <deep link to the newest message of the thread>
[triage] thread=<threadId> src=gmail|outlook
```

- The auto block is the whole-thread summary written **as a timeline** — one dated line per
  message, oldest first, newest 10 only (`… N earlier messages` when truncated).
- On creation the task is written with an empty `-- notes` section so Gabriel has a place to
  type.
- `[triage]` is how the next run re-finds the task (Google Tasks has no custom fields). On
  To Do it is mirrored into `linkedResources[0].externalId`.

## Title prefix (at creation only)

| email label (case-insensitive) | title becomes    |
| ------------------------------ | ---------------- |
| `properties/mount st`          | `Mount: <title>` |
| `properties/arura st`          | `Arura: <title>` |
| `properties/St Huberts`        | `Huberts: <title>` |

Any other label → no prefix. Applied once, when the task is created; never re-applied or
corrected on an existing task.

## Threads

Step 1 writes on every email: `threadId` (Gmail `threadId` / Outlook `conversationId`),
`threadRole` (`head` = newest message | `child`), `inInbox`, and on heads `newInThread`.
Only the head carries `category`, `suggestedTask`, `existingTaskKey` and an action Gabriel
picks. Children are read-only on the page and get derived decisions:

| head's action                               | child action                        | child `flagged` |
| ------------------------------------------- | ----------------------------------- | --------------- |
| `flag` / `create-task` / `update-task`      | `flag` if `inInbox`, else `archive` | `false`         |
| `archive` / `complete-task` / `cancel-task` | `archive`                           | `false`         |

---

## Desired JSON structure

Replaces `triage-session.schema.jsonc`. Changed or new keys are marked **NEW** / **GONE**.

```jsonc
{
  "generatedAt": "2026-08-31T08:00:00.000Z",
  "mailboxes": ["outlook", "gmail"],
  "gmailLabels": ["Travel", "properties/mount st", "properties/St Huberts"],

  // unchanged: two independent review queues, no session-level status
  "groups": {
    "gabriel": { "status": "pending-review", "reviewedAt": null, "processedAt": null },
    "gabriel-arina": { "status": "pending-review", "reviewedAt": null, "processedAt": null }
  },

  "emails": [
    {
      "id": "18f3a2b9c0d1e999",
      "source": "gmail",                    // "gmail" → gabriel-arina tab · "outlook" → gabriel tab
      "sourceId": "gmail:18f3a2b9c0d1e999",
      "from": "Arina <arina@example.com>",
      "subject": "Re: Mount St plumber quote",
      "date": "2026-08-31T03:40:00.000Z",
      "summary": "Quote v2 arrived, $1,240, needs approval by Friday.",
      "isFlagged": true,
      "labels": ["properties/mount st"],    // gmail user labels (email-only now)
      "systemLabels": ["IMPORTANT"],        // read-only

      "threadId": "18f3a2b9c0d1e000",       // NEW  gmail threadId / outlook conversationId
      "threadRole": "head",                 // NEW  "head" (newest) | "child"
      "inInbox": true,                      // NEW  false = already archived, never un-archive
      "newInThread": true,                  // NEW  head only: newer than the task's current link

      "category": "Important",              // head only
      "existingTaskKey": "gtasks:MTIz:abc789",  // NEW, replaces existingTaskUrl; null if untracked
      "suggestedTask": null,                // head only; null when tracked

      "decision": {
        "emailAction": "update-task",       // vocabulary unchanged
        "isTask": false,
        "flagged": true,
        "labels": ["properties/mount st"],  // gmail label diff only — no task side any more
        "task": null
      },
      "outcome": "task updated"             // step 3 only
    },
    {
      // a NEW task from an Outlook head
      "id": "AAMkAGI2...",
      "source": "outlook",
      "sourceId": "outlook:AAMkAGI2...",
      "from": "Council <rates@council.gov.au>",
      "subject": "Rates notice due 15 Sep",
      "date": "2026-08-28T22:14:00.000Z",
      "summary": "Council rates $612 due 15 Sep; pay via BPAY.",
      "isFlagged": false,
      "threadId": "AAQkAGI2...",
      "threadRole": "head",
      "inInbox": true,
      "category": "Important",
      "existingTaskKey": null,
      "suggestedTask": {
        "title": "Huberts: Pay council rates ($612)",   // prefix already applied by step 1
        "notes": "-- notes\n\n-- auto --\nPay $612 by BPAY before 15 Sep.\n28 Aug — rates notice issued\nLatest email: https://outlook.live.com/mail/0/inbox/id/AAMkAGI2...\n[triage] thread=AAQkAGI2... src=outlook",
        "dueDate": "2026-09-15",
        "link": "https://outlook.live.com/mail/0/inbox/id/AAMkAGI2..."
        // GONE: "group", "tags"
      },
      "decision": { "emailAction": "create-task", "isTask": true, "flagged": true, "task": null }
    }
    // children: same email fields + threadRole "child"; no category / suggestedTask /
    // existingTaskKey. Their `decision` is derived by the page.
  ],

  "existingTasks": [
    {
      "key": "gtasks:MTIz:abc789",          // NEW  the identity ("<provider>:<listId>:<taskId>")
      "provider": "gtasks",                 // NEW  "gtasks" | "todo" — also decides the tab
      "listId": "MTIz",                     // NEW
      "listName": "My Tasks",               // NEW
      "url": null,                          // optional display link, may be null
      "title": "Mount: plumber quote",      // read-only — never renamed after creation
      "notes": "-- notes\nAsk about the water damage too.\n\n-- auto --\n27 Aug — quote requested\nLatest email: …\n[triage] thread=18f3a2b9c0d1e000 src=gmail",
      "status": "needsAction",              // "needsAction" | "completed"
      "dueDate": "2026-09-05",
      "link": "https://mail.google.com/mail/u/0/#inbox/18f2...",   // currently the latest-email link
      "threadId": "18f3a2b9c0d1e000",       // NEW  parsed from the [triage] footer
      // GONE: "group", "tags", "source", "sourceId"

      "decision": {
        "complete": false,
        "cancel": false,
        "edits": {                          // only changed keys; null when nothing changed
          "notes": "<full new notes: Gabriel's -- notes section verbatim + regenerated -- auto -- block>",
          "dueDate": "2026-09-04",
          "link": "https://mail.google.com/mail/u/0/#inbox/18f3a2b9c0d1e999"  // → latest email
          // GONE: "title" (never rename), "tags", "group"
        }
      },
      "outcome": "updated"                  // step 3 only
    }
  ],

  "newTasks": [
    {
      "title": "Renew passport",
      "notes": "-- notes\nExpires Feb 2027.\n\n-- auto --",
      "provider": "todo",                   // NEW, replaces "group": decides backend + tab
      "dueDate": "",
      "outcome": "created"                  // step 3 only
    }
  ]
}
```

---

## Prompt 1 — `pa-email-triage` (fetch + classify) (pendind creation of new mcp server for google task)

````text
Rewrite the pa-email-triage skill: tasks now live in Google Tasks (Gabriel & Arina Gmail)
and Microsoft To Do (Outlook), never Notion, and the skill becomes thread-aware. The
authoritative contract is triage-session.schema.jsonc in the pa-email-triage repo — read it
first and rewrite it to match improvements.md's "Desired JSON structure".

1. NO NOTION. No Notion call, no groups, no tags on tasks, nothing migrated.

2. TASKS. Fetch from Google Tasks (Gabriel & Arina Gmail) and Microsoft To Do (Outlook), open and
   recently completed. Write each into existingTasks[] with: key ("gtasks:<listId>:<taskId>"
   or "todo:<listId>:<taskId>"), provider, listId, listName, url (or null), title, notes,
   status ("needsAction" | "completed"), dueDate, link, threadId.

3. MATCHING. Task notes end with:  [triage] thread=<threadId> src=gmail|outlook
   Parse it (on To Do, linkedResources[0].externalId carries the same threadId) and set
   `existingTaskKey` on the matching HEAD email. There is no Source ID property.

4. THREADS. Write threadId (gmail threadId / outlook conversationId) on every email. For
   every thread with at least one inbox message, include EVERY message of that thread in
   emails[], with inInbox true|false. Write threadRole: exactly one "head" per thread (the
   newest by date), "child" for the rest. category, existingTaskKey and suggestedTask are
   HEAD-ONLY — never more than one task per thread.

5. NOTES — the shape of every task description you write:
     -- notes
     <Gabriel's own text — READ IT, take it into account in your summary, never change it>

     -- auto --
     One line: what this is and what needs to be done.
     DD Mon — one line per message of the thread, oldest first, newest 10 only
     Latest email: <deep link to the HEAD>
     [triage] thread=<threadId> src=gmail|outlook
   Plain text, no markdown (Google Tasks has no formatting). Regenerate everything below
   `-- auto --` on every run; copy everything above it byte-for-byte. For a new task, write
   an empty `-- notes` section. This goes in suggestedTask.notes for new tasks and in
   existingTasks[].notes for existing ones.

6. TITLE + PREFIX (new tasks only). suggestedTask.title is short and already carries the
   prefix, if the email has one of these labels (case-insensitive):
     properties/mount st   → "Mount: "
     properties/arura st   → "Arura: "
     properties/St Huberts → "Huberts: "
   No other label gets a prefix. NEVER propose a new title for an existing task — its title
   is Gabriel's after creation.

7. NEW EMAIL IN THREAD. Set newInThread: true on a head that is newer than the message the
   matched task's "Latest email:" line points at. Page badge only.

8. STILL FORBIDDEN. No `decision` blocks, no `outcome` fields, no top-level `status`. Write
   groups.gabriel and groups["gabriel-arina"] as "pending-review", plus gmailLabels, mailboxes,
   newTasks: []. Gmail user labels stay on the email (labels / systemLabels); they are not
   task tags any more.
````

## Prompt 2 — `triage-review.html` (the review page) (done 31 Aug 2026)

````text
In the pa-email-triage repo, update triage-review.html for the new model: tasks live in
Google Tasks / Microsoft To Do (no Notion), and the page is thread-aware. One static file,
vanilla JS, no build. Read CLAUDE.md and triage-session.schema.jsonc (rewritten per
improvements.md) first, and update both to match your changes.

1. NOTION IS GONE. Delete the GROUPS and TAGS constants, the Group select and its hint,
   allowedGroups(), edits.tags, syncTaskFromLabels, syncLabelsFromTags and the tags row of
   the task editor. Tabs no longer key off a task's group: gabriel = outlook emails +
   provider "todo" tasks; gabriel-arina = gmail emails + provider "gtasks" tasks.

2. IDENTITY. existingTasks[] are matched by `key`; emails carry `existingTaskKey`. Replace
   every `t.url === e.existingTaskUrl` lookup. `url` may be null — render "✓ Tracked" as a
   link when present, plain text otherwise, and drop all "Notion" wording.

3. TITLE IS READ-ONLY ON EXISTING TASKS. Never write edits.title. The title input in the
   task editor is editable only for suggested/new tasks (before creation).

4. NOTES EDITOR. Notes are two sections: `-- notes` (Gabriel's) then `-- auto --` (generated,
   replaced every run). Let Gabriel edit only the `-- notes` part; show the auto part muted
   and read-only. Plain text, no markdown. edits.notes is still the full new string.

5. GMAIL LABELS stay exactly as they are on email rows (chips, decision.labels,
   labelOptions() = gmailLabels ∪ already-set) but touch no task. Show the title prefix a
   new task will get (Mount / Arura / Huberts, from properties/* labels) as a read-only hint
   in the task editor.

6. DONE vs CANCELLED. Keep the three-way Open / Done / Cancelled select mirrored onto
   decision.complete / decision.cancel; add a hint that both save as completed and Cancelled
   adds a note line.

7. ONE ROW PER THREAD. Group emails by threadId; render only the HEAD as an interactive row.
   Children go under it, collapsed behind "▸ N earlier messages", MUTED AND READ-ONLY (date,
   sender, subject, one-line summary, star state, labels — no ribbons, no buttons). Mark
   children with inInbox false as "already archived". Expansion state in memory only.

8. DERIVED CHILD DECISIONS. Add syncThread(head), called from setAction / setCategory /
   setTaskState and once on load:
     head flag / create-task / update-task      → child "flag" if inInbox, else "archive";
                                                  flagged false
     head archive / complete-task / cancel-task → child "archive"; flagged false
   Never write "flag" on a child with inInbox false.

9. BADGES. head.newInThread → "🆕 new email in thread", and default the matched task's
   edits.link to that head's deep link (shown read-only as "link → latest email"). Matched
   task with status "completed" → "✓ task completed" badge, `archive` as the ONLY action
   (replace the flat TRACKED_ACTIONS constant with trackedActions(e)), its Open/Done/Cancelled
   select read-only, no edits written, no reopen.

10. COUNTS AND FILTERS count HEADS only; hiding a head hides its children.

11. UNCHANGED. The star model (auto-set by setAction for keep-in-inbox actions, still
    toggleable, now heads only), per-tab Confirm & Save / Skip / Reopen, the stale-tab guard
    and writeGroupStatus() as the only write path.

12. NO BACKWARDS COMPATIBILITY. Every session file is written by the new step 1, so
    delete migration code instead of adding it: no fallbacks for a missing threadId /
    threadRole, no deriving `key` from `url` or `existingTaskKey` from `existingTaskUrl`,
    no legacy `tags` / `group` / `title` handling. applyLoadDefaults() only fills in what
    step 1 is allowed to omit (the `decision` blocks, `existingTasks`, `newTasks`) and
    ensureGroups() only guarantees the two group entries exist with a valid status.

Quick syntax check after editing: extract the <script> body and run `node --check` on it.
````

## Prompt 3 — `pa-email-triage-save` (apply)

````text
Rewrite the pa-email-triage-save skill: apply to Google Tasks (Gabriel & Arina Gmail) and Microsoft
To Do (Outlook) instead of Notion, and handle threads. The authoritative contract is
triage-session.schema.jsonc (rewritten per C:\Users\gabri\Documents\Claude Code\Code\pa-email-triage\improvements.md) — read it first.

1. NO NOTION, NO GROUPS, NO TAGS. Gmail-sourced task → Google Tasks default list;
   Outlook-sourced → To Do default list. newTasks[] go by their `provider`. Match existing
   tasks by `key`, never by url.

2. NOTES. Every task you write ends up as:
     -- notes
     <Gabriel's section, byte-for-byte as it is in the task right now>

     -- auto --
     one line on what this is and what's needed
     DD Mon — one line per message of the thread, oldest first, newest 10
     Latest email: <deep link to the NEWEST message of the thread>
     [triage] thread=<threadId> src=gmail|outlook
   Re-read the live task before writing so a `-- notes` section Gabriel typed since the
   fetch survives. Never omit the [triage] line — the next run re-finds the task by it. On
   To Do also set linkedResources[0] = { webUrl: <latest email link>, externalId: <threadId>,
   applicationName: "Outlook" }.

3. TITLE ONLY AT CREATION. Set the title when creating a task, with the prefix already in
   decision.task/suggestedTask.title. NEVER rename an existing task, even if the file
   carries a title that differs — Gabriel may have renamed it himself.

4. edits: apply only the keys present — `notes`, `dueDate`, `link` (rewrite the
   "Latest email:" line and, on To Do, linkedResources.webUrl); there is no `title` or
   `tags` key. Google Tasks due dates are date-only; To Do takes midnight local.

5. COMPLETE vs CANCEL. Both mark the task completed; cancel also appends
   "Cancelled DD Mon: <reason or email subject>" to the auto block.

6. NEVER UN-ARCHIVE. An email with inInbox false is never moved back to the inbox — for it,
   "flag" means apply the star/flag diff only.

7. THREADS. Apply each email's decision, but keep the thread consistent: head
   complete-task / cancel-task → every child archived and unstarred; head flag /
   create-task / update-task → children stay where they are, unstarred. If a child's
   decision is missing or contradicts its head, use the derived rule. Only heads create or
   update tasks.

8. ALREADY-COMPLETED TASKS are read-only: don't edit, reopen or re-complete. Perform their
   emails' actions (archive) and stamp outcome "task already completed".

9. GMAIL LABELS are email-only: apply decision.labels vs labels to the message, never touch
   systemLabels, never write a tag anywhere.

10. OUTCOMES. Stamp `outcome` on every item touched, including the created/updated task's
    key; say "archived (thread)" / "unstarred (thread)" for derived child actions.

11. UNCHANGED. The gate (refuse to run while either group is "pending-review"), per-group
    processing of "reviewed" groups only, leaving "skipped" groups alone, the
    decision.flagged vs isFlagged diff, and no session-level status.
````

---

# Change log

## 9. Notion out; Google Tasks + Microsoft To Do in, thread-aware (planned)

Tasks move to each mailbox's own task app. Nothing is migrated and nothing is kept
backwards compatible — the session file starts fresh. Groups and tags disappear;
the task's identity is `provider:listId:taskId`; the tab follows the email source. The two
tabs are **Gabriel** (key `gabriel`) and **Gabriel & Arina** (key `gabriel-arina`). Notes
become `-- notes` (Gabriel's, read but never written) + `-- auto --` (a regenerated timeline
summary of the whole thread, ending in the latest-email link and a `[triage]` footer). Task
titles are written once at creation with a `Mount:` / `Arura:` / `Huberts:` prefix from the
`properties/*` labels and never renamed afterwards. One row per conversation, the thread kept
whole in the inbox until its task closes, only the head starred, closed tasks read-only.

### Status

Specified 31 Aug 2026. **Step 2 (triage-review.html) is done** — prompt 2 applied in full on
31 Aug 2026, with `CLAUDE.md` and `triage-session.schema.jsonc` rewritten to match: no
Notion/groups/tags, task identity by `key`, read-only titles on existing tasks, the
`-- notes` / `-- auto --` split editor, one row per thread with derived child decisions,
the new-in-thread and completed-task badges, head-only counts and filters, and no migration
code anywhere. One behaviour worth noting: the page no longer generates the `-- auto --`
block (it has no thread summary of its own) — it keeps whatever step 1 wrote byte-for-byte
and only writes `edits.notes` when Gabriel edits his own section.

**Step 1 (pa-email-triage) rewritten 1 Sep 2026** — prompt 1 applied against the rewritten
schema: no Notion, Google Tasks via the `gabrielandarina-google-tasks` MCP, Microsoft To Do
via `outlook-mcp` task tools, thread-aware fetch (every message of every inbox thread, one
head per thread), `[triage]`-footer matching by threadId, `-- notes` / `-- auto --`
descriptions, label-based title prefixes, and a hard drop of any side whose task backend is
unreachable.

Step 3 (pa-email-triage-save) is **not implemented** yet.
