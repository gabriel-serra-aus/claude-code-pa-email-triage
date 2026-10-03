# improvements.md

## Change log

### 3 Oct 2026 — Split by side: Gabriel / Gabriel & Arina never mixed
- Each side has its own session, context and run summary (`session-<side>`, `context-<side>`, `summary-<side>`); every connector tool takes a required `side`; `session_publish` takes the run summary; new `summary_get` and `/api/summary`.
- One side per page: no parameter (or `?type=gabriel-arina`) = Gabriel & Arina, `?type=gabriel` = Gabriel, anything else an error. `?type=gna` and the two-tab view are gone. Same on `rules.html`.
- Review page: collapsible **Run summary** panel; no more adopting the other tab from disk.
- The sides are independent — preparing, reviewing or saving one never waits for the other.

### 3 Oct 2026 — Triage Rules page, sender rule panel, context store

- **The triage context moved into the app.** What `PA/Email Triage/task-context.md` held
  (properties, senders, Gmail label registry + guide, topics, ignore list, rules, run settings)
  is now one document in Blobs (store `triage`, key `context`), strict zod schema in
  `netlify/lib/context.ts`. Step 1 reads it with the new read-only connector tool
  `context_get` (markdown by default, `NO_CONTEXT` if never loaded). Seeded once with
  `netlify blobs:set`; `PUT` never creates.
- **`/api/context`.** `GET` + `X-Context-ETag`, `?history`, `?version=<key>`; `PUT` with
  `X-Context-ETag` (428 / 412 / 422, Origin check), server stamps `updatedAt` / `updatedBy`.
  Every replaced version is kept under `context-history/<iso>`, newest 50.
- **New page `rules.html` ("Triage Rules").** Tabs Senders / Properties / Gmail labels (+ label
  guide) / Topics / Ignore list / Rules (ordered, on/off) / Run settings / History (view,
  restore). Every change saves at once; a lost race (412) redoes the change on a fresh copy, up
  to 3 times. Sign-in returns to it (`?type=rules`). Header **Rules** link on the review page.
- **Sender chip + Sender rule panel on the review page.** Each head's sender shows what the
  rules say ("👤 relationship · P# name", amber "ignored") or "+ sender rule"; clicking opens a
  panel (name, addresses/@domains, relationship, property, Gmail label, notes, ignore, add a
  rule). Confirm saves to the context straight away — separate from the session, never changes
  the review, applies from the next pa-email-triage run. Disabled on locked tabs.

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
