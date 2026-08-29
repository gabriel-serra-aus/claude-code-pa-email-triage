# Improvements

## 1. Drop the tracked-email hint
Remove the sentence "Already has a task — only the task action applies." under the
**Tracked in Notion** badge — the badge alone is enough.

### Status
Implemented in `triage-review.html` (29 Aug 2026).

## 2. Action column: no explanatory text
The Action column shows only what is needed to act — nothing describing what
will be updated ("Moved to Archive…", "auto comment will be refreshed", etc.).

- Create task → task title + meta + **Edit task** / **Reset**
- Tracked → task title + **Open & edit task**
- Archive / None / Create email → nothing under the picker

### Status
Implemented in `triage-review.html` (29 Aug 2026).

## 3. Open & edit shows what changed
When opening a tracked task, show a very user-friendly diff of the title and
description against what is currently in Notion: unchanged lines muted, added
lines green, removed lines red, `-- auto comment --` clearly separated. It
updates live while typing.

### Status
Implemented in `triage-review.html` (29 Aug 2026).

## 4. Category as a one-click icon ribbon
Category is chosen with one click on an icon (radio ribbon), no dropdown:
❗ Important · ℹ️ FYI · 🗑️ Not Important.

### Status
Implemented in `triage-review.html` (29 Aug 2026).

## 5. FYI actions = Archive | None
"Create email" is only offered for **Important** emails.

### Status
Implemented in `triage-review.html` (29 Aug 2026).

## 6. Action as a one-click icon ribbon
Action is chosen with one click on an icon (radio ribbon), no dropdown:
📥 Archive · ⏸️ None · ✅ Create task · ✉️ Create email ·
🔄 Update task · ☑️ Complete task · ✖️ Cancel task.
Not Important stays locked to Archive.

### Status
Implemented in `triage-review.html` (29 Aug 2026).
