
## 7. Two email outcomes only: flag or archive
"None" and "Create email" are gone. An email is either **flagged** (kept in the
inbox) or **archived**; a task is created, updated, completed or cancelled.
FYI → 📥 Archive | 🚩 Flag; Important → ✅ Create task | 🚩 Flag | 📥 Archive.
Legacy `none` / `create-email` values migrate to `flag` on load.

### Status
Implemented in `triage-review.html` (29 Aug 2026).

## 8. Skip a tab; save only when both tabs are decided
The sticky bar gets **Skip — <tab>** next to Confirm & Save. Skip writes
`groups.<tab>.status = "skipped"` (same stale-tab guard, drafts kept in the
file) and locks the tab with a **Reopen for review** button that puts it back
to `pending-review`. `pa-email-triage-save` now refuses to run while either
tab is still `pending-review`, applies `reviewed` tabs and leaves `skipped`
ones alone. Confirm / Skip / Reopen share one write path (`writeGroupStatus`).
Also: `ensureGroups()` promotes an orphan `reviewedGroups.<tab>` stamp (left
by the pre-rework page next to a `pending-review` group) and drops the key.

### Status
Implemented in `triage-review.html` (30 Aug 2026).
