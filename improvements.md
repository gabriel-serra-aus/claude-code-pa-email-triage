# improvements.md

## Change log

### 21 Sep 2026 — keep in inbox without flagging, responsive layout

- **Keep in inbox no longer flags.** `setAction` used to switch `decision.flagged` on for every
  keep-in-inbox action, so an email could only end up flagged or archived. Now no action touches
  `decision.flagged`; only the star/flag toggle does. No contract change — "keep" is still
  `emailAction: "flag"`.
- **New defaults.** FYI → Keep in inbox (default) | Archive. Important → Create task (default) |
  Keep in inbox (no task). Not Important → Archive, locked (unchanged).
- **Star/flag toggle moved** from the date cell to the right, beside the action ribbon; the
  keep-in-inbox icon is an inbox tray instead of a flag.
- **Responsive.** Media blocks at 960px / 600px plus a touch block: rows stack, filter bar and
  confirm summary scroll sideways, modal goes full-screen, bigger tap targets, label × always
  visible on touch. Phones / iPads still show "Browser not supported" (no File System Access API).

## Backlog

- If pa-email-triage pre-writes `decision.emailAction: "archive"` on FYI heads, the page keeps it
  (still an allowed value) and the new Keep-in-inbox default never shows — check a real session file.
