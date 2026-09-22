# improvements.md

## Change log

### 22 Sep 2026 — Confirm & Save failed on Netlify: "If-Match required"

- Netlify's edge strips the `If-Match` request header before a function sees it (verified from
  the live site: a PUT sent with `If-Match` answered `428`), so every Confirm / Skip / Reopen
  failed. The page now sends the etag as `X-Session-ETag` (and still `If-Match`); the server
  checks `X-Session-ETag` first and falls back to `If-Match`. Nothing else changed.
- Second round, same evening: the write then answered `412` because Netlify's CDN rewrites the
  `ETag` it serves when it compresses the response (`"abc"` → `"abc-df"`), so the page echoed a
  mangled etag. `GET` / `PUT` now also return the raw Blobs etag as `X-Session-ETag`, the page
  prefers that header, and the server's normaliser strips a `-df`-style suffix as well.

### 22 Sep 2026 — Netlify: cloud session, Google sign-in, MCP connector

- **No more local file.** The session lives in Netlify Blobs (store `triage`, key `session`).
  The page reads it with `GET /api/session` and writes it with `PUT /api/session` + `If-Match`;
  the skills use the `triage-session` MCP connector (`/mcp/<secret>`, 8 `session_*` tools) and
  never see the whole JSON. The JSON shape and the decision model are unchanged.
- **Any browser, phones included.** The File System Access API, the IndexedDB handle, "Open
  file…", "Reopen" and the "Browser not supported" screen are gone. Landing card = **Sign in with
  Google** (one allowed address, 30-day cookie, `?type=` survives the round trip); header =
  **Reload** / **Sign out**.
- **Stale guard = status + etag.** The status guard and `adoptGroupFromDisk` are as before; the
  server additionally refuses a write over a session that changed since the page re-read it
  (`412` → "Not saved — session changed. Reload.") and any change to a key the page doesn't own
  (`422`). Sign-in expired on save → "Signed out — sign in and press again" + a header Sign in
  link that opens a new tab, so edits stay in memory.
- **Server-side contract.** `netlify/lib/contract.ts` mirrors the schema file; `session_publish`
  checks every invariant, so the page only ever sees a valid session. Two rules tightened on top:
  dates must be strict ISO-8601 and a task `url` must be `http(s)` (both reach the DOM unescaped).
- Repo: `public/triage-review.html` (moved), `netlify/`, `test/` (96 unit tests, synthetic
  fixture), `netlify.toml`, `package.json`, `tsconfig.json`. Spec and runbook in `improvements/`.
  Page CSP added (`connect-src 'self'`, no external scripts).

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
  visible on touch. (Phones / iPads still showed "Browser not supported" at the time — no File
  System Access API; lifted on 22 Sep.)

## Backlog

- **MCP secret in a request header, not the URL.** claude.ai custom connectors now accept
  request headers (seen 22 Sep 2026 in "Add custom connector"), which the technical spec assumed
  they didn't. Change `netlify/functions/mcp.ts` to expect `Authorization: Bearer <MCP_SECRET>`
  on a plain `/mcp` path (`timingSafeEqual` as now; missing/wrong → 404), one test, docs;
  rotate `MCP_SECRET` (the current one has been in a URL and a screenshot); re-add the connector
  with the header. Keeps the secret out of Netlify request logs and the connector URL.

- If pa-email-triage pre-writes `decision.emailAction: "archive"` on FYI heads, the page keeps it
  (still an allowed value) and the new Keep-in-inbox default never shows — check a real session file.
