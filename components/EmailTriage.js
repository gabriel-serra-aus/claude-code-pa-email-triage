/**
 * EmailTriage — the main interactive component.
 *
 * "use client" tells Next.js this component runs in the BROWSER (not on the server).
 * You need "use client" whenever you use:
 *   - React hooks (useState, useEffect, useCallback, etc.)
 *   - Browser APIs (window, document, fetch from the client, etc.)
 *   - Event handlers (onClick, onChange, etc.)
 *
 * Without "use client", Next.js treats the component as a server component,
 * and you'd get an error trying to use useState or onClick.
 */
"use client";

import { useState, useEffect, useCallback } from "react";

// ── Helper functions ────────────────────────────────────────────────────────

/** Return the CSS class name for a category (used on table rows) */
function getCatClass(cat) {
  if (cat === "Important") return "cat-important";
  if (cat === "FYI") return "cat-fyi";
  return "cat-notimportant";
}

/** Format an ISO date string into a readable "DD Mon YYYY HH:MM" format */
function formatDate(iso) {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-AU", { month: "short" });
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

/**
 * Parse the "from" field to extract name and email separately.
 * Input:  "Sarah Connor <sarah@company.com>"
 * Output: { name: "Sarah Connor", email: "sarah@company.com" }
 */
function parseFrom(from) {
  const match = from.match(/^(.*?)\s*<(.+?)>$/);
  return {
    name: match ? match[1].trim() : from,
    email: match ? match[2] : "",
  };
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function EmailTriage() {
  // ── State ──────────────────────────────────────────────────────────────────
  //
  // In React, "state" is data that can change over time and triggers a re-render
  // when it does. useState returns [currentValue, setterFunction].

  // Store the emails for each source (gmail & outlook) in a single state object.
  // We keep them together to make it easy to compute totals across both.
  const [emails, setEmails] = useState({ gmail: [], outlook: [] });

  // Sort settings for each table — which column to sort by and direction.
  const [sorts, setSorts] = useState({
    gmail: { col: "date", dir: "desc" },
    outlook: { col: "date", dir: "desc" },
  });

  // Active filter for each table (e.g. "All", "Important", "FYI", "Not Important").
  const [filters, setFilters] = useState({ gmail: "All", outlook: "All" });

  // Toast notification message — empty string means hidden.
  const [toast, setToast] = useState("");

  // The timestamp when data was last loaded.
  const [lastLoaded, setLastLoaded] = useState("");

  // Whether there was an error loading the email data.
  const [loadError, setLoadError] = useState(false);

  // Stores when each source file was last modified (ISO string from the server).
  const [fileModified, setFileModified] = useState({ gmail: null, outlook: null });

  // Loading state for the "Update Emails" button.
  const [isUpdating, setIsUpdating] = useState(false);

  // Results from the execute-actions API (shown in a results modal).
  const [updateResults, setUpdateResults] = useState(null);

  // Which provider's table is currently shown: "gmail", "outlook", or null.
  // Only ONE provider is displayed at a time. null means "not chosen yet" —
  // this happens when BOTH source files have data (the user must pick one
  // via the chooser buttons) or when neither file has data.
  const [activeProvider, setActiveProvider] = useState(null);

  // ── Toast helper ───────────────────────────────────────────────────────────
  // Show a toast message for 3 seconds, then hide it.
  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }, []);

  // ── Load email data from our API ──────────────────────────────────────────
  //
  // useEffect runs code AFTER the component renders. The empty [] dependency
  // array means "run this once, when the component first appears."
  // This is the React equivalent of "onload" or "DOMContentLoaded".
  useEffect(() => {
    async function loadEmails() {
      try {
        // Fetch from our Next.js API route at /api/emails
        const res = await fetch("/api/emails");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Store the emails in state — React will re-render the UI automatically
        setEmails({
          gmail: data.gmail || [],
          outlook: data.outlook || [],
        });

        // Store file modification timestamps so we can warn if data is stale
        setFileModified({
          gmail: data.gmailModified || null,
          outlook: data.outlookModified || null,
        });

        // Decide which provider to show automatically:
        //   - only Gmail has data   → show Gmail
        //   - only Outlook has data → show Outlook
        //   - both have data        → show neither; the user must pick one
        //     with the chooser buttons at the top of the page
        const hasGmail = (data.gmail || []).length > 0;
        const hasOutlook = (data.outlook || []).length > 0;
        if (hasGmail && !hasOutlook) setActiveProvider("gmail");
        else if (hasOutlook && !hasGmail) setActiveProvider("outlook");
        else setActiveProvider(null);

        // Record when we loaded the data
        const now = new Date().toLocaleString("en-AU", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        setLastLoaded(`Last loaded: ${now}`);
      } catch (err) {
        console.warn("Failed to load emails:", err.message);
        setLoadError(true);
        setLastLoaded("Failed to load data");
      }
    }

    loadEmails();
  }, []);

  // ── Category change handler ───────────────────────────────────────────────
  // Called when the user picks a different category from the dropdown.
  function onCategoryChange(src, id, newCat) {
    // Create a new copy of the emails with the updated category.
    // In React, you should never mutate state directly — always create a new
    // object/array so React knows something changed and re-renders.
    setEmails((prev) => ({
      ...prev,
      [src]: prev[src].map((e) =>
        e.id === id ? { ...e, category: newCat } : e
      ),
    }));
  }

  // ── Sort handler ──────────────────────────────────────────────────────────
  // Toggle sort direction if clicking the same column, otherwise switch column.
  function onSort(src, col) {
    setSorts((prev) => {
      const current = prev[src];
      if (current.col === col) {
        // Same column — flip direction
        return {
          ...prev,
          [src]: { col, dir: current.dir === "asc" ? "desc" : "asc" },
        };
      }
      // Different column — default direction
      return {
        ...prev,
        [src]: { col, dir: col === "date" ? "desc" : "asc" },
      };
    });
  }

  // ── Filter handler ────────────────────────────────────────────────────────
  function onFilter(src, cat) {
    setFilters((prev) => ({ ...prev, [src]: cat }));
  }

  // ── Build the output payload for executing ────────────────────────────────
  // Only the ACTIVE provider is included in the payload. Gmail actions are
  // not implemented yet, so the update button is only enabled when Outlook is
  // displayed, and the API route skips any provider absent from the payload.
  function buildOutput() {
    const generated = new Date().toISOString();
    const result = {};

    for (const src of [activeProvider]) {
      if (!src) continue;
      const actions = emails[src].map((e) => ({
        id: e.id,
        date: e.date,
        from: e.from,
        subject: e.subject,
        summary: e.summary,
        action: e.action,
        category: e.category,
        triage:
          e.category === "Important"
            ? "important"
            : e.category === "FYI"
              ? "do-nothing"
              : "archive",
      }));

      result[src] = {
        generated,
        total: actions.length,
        important: actions.filter((a) => a.triage === "important").length,
        doNothing: actions.filter((a) => a.triage === "do-nothing").length,
        archive: actions.filter((a) => a.triage === "archive").length,
        actions,
      };
    }
    return result;
  }

  // ── Execute actions (the "Update Emails" flow) ────────────────────────────
  async function updateEmails() {
    // Safety net — the button is disabled for Gmail, but guard anyway
    // (Gmail execution is not implemented yet).
    if (activeProvider !== "outlook") {
      showToast("Updating is only available for Outlook right now");
      return;
    }
    setIsUpdating(true);
    const output = buildOutput();

    try {
      // Execute the actions against Gmail & Outlook
      const execRes = await fetch("/api/execute-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(output),
      });
      if (!execRes.ok) throw new Error("Execute failed");

      const results = await execRes.json();
      setUpdateResults(results);
    } catch (err) {
      showToast("Update failed — " + err.message);
      console.error(err);
    } finally {
      setIsUpdating(false);
    }
  }

  // ── Compute action summary counts (active provider only) ─────────────────
  // Only one provider is displayed at a time, so the totals in the save bar
  // reflect just the visible table.
  const activeEmails = activeProvider ? emails[activeProvider] : [];
  const toFlag = activeEmails.filter((e) => e.category === "Important").length;
  const toMove = activeEmails.filter((e) => e.category !== "Important").length;
  const total = activeEmails.length;

  // Which providers actually have data — drives the chooser buttons.
  const hasData = {
    gmail: emails.gmail.length > 0,
    outlook: emails.outlook.length > 0,
  };

  // ── Per-provider staleness check (6-hour threshold) ───────────────────────
  // Each source file is checked individually. A stale provider can still be
  // selected, but its grid is replaced with a warning until the file is
  // refreshed. A fresh provider is unaffected.
  const now = Date.now();
  const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours

  /** True when a provider's source file is more than 6 hours old */
  function isStale(src) {
    const iso = fileModified[src];
    if (!iso) return false; // no timestamp → can't judge, don't block
    return now - new Date(iso).getTime() > STALE_MS;
  }

  /** Split a file's age into whole days + leftover hours */
  function ageParts(iso) {
    const totalHours = Math.floor((now - new Date(iso).getTime()) / (1000 * 60 * 60));
    return { days: Math.floor(totalHours / 24), hours: totalHours % 24 };
  }

  /** Short age label for the chooser buttons, e.g. "2h old", "1d 3h old" */
  function formatAgeShort(iso) {
    if (!iso) return "no file";
    const { days, hours } = ageParts(iso);
    if (days > 0) return `${days}d ${hours}h old`;
    if (hours > 0) return `${hours}h old`;
    return "<1h old";
  }

  /** Long age wording for the stale warning, e.g. "1 day and 3 hours" */
  function formatAgeLong(iso) {
    const { days, hours } = ageParts(iso);
    return `${days} day${days === 1 ? "" : "s"} and ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  // Can the user save/execute right now? Only Outlook actions are implemented,
  // and only when its data is fresh and there is something to act on.
  const activeIsStale = activeProvider ? isStale(activeProvider) : false;
  const canAct = activeProvider === "outlook" && !activeIsStale && total > 0;

  // ── Render ────────────────────────────────────────────────────────────────
  //
  // In React, the UI is described with JSX — HTML-like syntax inside JavaScript.
  // Key differences from regular HTML:
  //   - Use className instead of class
  //   - Use onClick instead of onclick
  //   - Use {expression} to embed JavaScript values
  //   - Self-closing tags need a slash: <br /> not <br>
  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header>
        <div>
          <h1>Gabriel Email Triage Tool</h1>
          <div className="meta">{lastLoaded || "No data loaded"}</div>
        </div>
        <div className="header-buttons">
          <button
            className="btn-save btn-update"
            onClick={updateEmails}
            disabled={isUpdating || !canAct}
          >
            {isUpdating ? "Updating…" : "Update Emails"}
          </button>
        </div>
      </header>

      {/* ── Error banner (only shows if loading failed) ────────────── */}
      {loadError && (
        <div className="load-error">
          <strong>Could not load email data.</strong>
          Make sure the email source JSON files exist in the workspace folder.
        </div>
      )}

      {/* ── Provider chooser — only one inbox is shown at a time ───── */}
      {/* Each button shows the age of its source file so staleness is   */}
      {/* visible before picking. A provider with no data is disabled.   */}
      {(hasData.gmail || hasData.outlook) && (
        <div className="provider-chooser">
          <span className="chooser-label">Inbox:</span>
          <button
            className={`provider-btn ${activeProvider === "gmail" ? "active" : ""}`}
            onClick={() => setActiveProvider("gmail")}
            disabled={!hasData.gmail}
          >
            Gmail (Us)
            <span className={`provider-age ${isStale("gmail") ? "age-stale" : ""}`}>
              {hasData.gmail ? formatAgeShort(fileModified.gmail) : "no data"}
            </span>
          </button>
          <button
            className={`provider-btn ${activeProvider === "outlook" ? "active" : ""}`}
            onClick={() => setActiveProvider("outlook")}
            disabled={!hasData.outlook}
          >
            Outlook
            <span className={`provider-age ${isStale("outlook") ? "age-stale" : ""}`}>
              {hasData.outlook ? formatAgeShort(fileModified.outlook) : "no data"}
            </span>
          </button>
          {activeProvider === null && hasData.gmail && hasData.outlook && (
            <span className="choose-prompt">
              Both sources have data — pick which inbox to triage.
            </span>
          )}
        </div>
      )}

      {/* ── Source file timestamps — shown individually per provider ── */}
      {(fileModified.gmail || fileModified.outlook) && (
        <div className="source-info">
          Source updated — Gmail:{" "}
          {fileModified.gmail
            ? `${formatDate(fileModified.gmail)} (${formatAgeShort(fileModified.gmail)})`
            : "no file"}
          {"  ·  "}Outlook:{" "}
          {fileModified.outlook
            ? `${formatDate(fileModified.outlook)} (${formatAgeShort(fileModified.outlook)})`
            : "no file"}
        </div>
      )}

      {/* ── Gmail actions not implemented yet (friendly notice) ─────── */}
      {activeProvider === "gmail" && !activeIsStale && (
        <div className="gmail-notice">
          <strong>Heads up — updating Gmail emails isn&apos;t implemented yet.</strong>
          You can review and triage below, but the save buttons are disabled
          and nothing will be saved or executed for Gmail.
        </div>
      )}

      {/* ── Main content — the active provider's table (or a warning) ── */}
      <main>
        {/* Nothing selected yet */}
        {activeProvider === null && (hasData.gmail || hasData.outlook) && (
          <div className="empty-state">Select an inbox above to start triaging.</div>
        )}
        {activeProvider === null && !hasData.gmail && !hasData.outlook && !loadError && (
          <div className="empty-state">No email data loaded.</div>
        )}

        {/* Stale provider — block the grid until the source is refreshed */}
        {activeProvider && activeIsStale && (
          <div className="stale-warning">
            <strong>Source file is too old to display.</strong>
            The {activeProvider === "gmail" ? "Gmail" : "Outlook"} source file is{" "}
            {formatAgeLong(fileModified[activeProvider])} old. Please close this
            page and re-run the <code>/pa-triage-email</code> skill in Claude
            Cowork (PA project) to refresh it.
          </div>
        )}

        {/* Fresh provider — show its table */}
        {activeProvider === "gmail" && !activeIsStale && (
          <EmailSection
            src="gmail"
            label="Gmail (Us)"
            account="gabrielandarina@gmail.com"
            emails={emails.gmail}
            sort={sorts.gmail}
            filter={filters.gmail}
            onSort={onSort}
            onFilter={onFilter}
            onCategoryChange={onCategoryChange}
          />
        )}
        {activeProvider === "outlook" && !activeIsStale && (
          <EmailSection
            src="outlook"
            label="Outlook"
            account="gabriel.serra@outlook.com.au"
            emails={emails.outlook}
            sort={sorts.outlook}
            filter={filters.outlook}
            onSort={onSort}
            onFilter={onFilter}
            onCategoryChange={onCategoryChange}
          />
        )}
      </main>

      {/* ── Bottom save bar ────────────────────────────────────────── */}
      <div className="save-bar">
        <div className="summary">
          <span>{total}</span> emails loaded — <span>{toFlag}</span> to flag,{" "}
          <span>{toMove}</span> to move
        </div>
        <div className="header-buttons">
          <button
            className="btn-save btn-update"
            onClick={updateEmails}
            disabled={isUpdating || !canAct}
          >
            {isUpdating ? "Updating…" : "Update Emails"}
          </button>
        </div>
      </div>

      {/* ── Toast notification ─────────────────────────────────────── */}
      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>

      {/* ── Progress overlay (blocks all interaction while updating) ── */}
      {isUpdating && (
        <div className="progress-overlay">
          <div className="progress-dialog">
            <div className="progress-spinner" />
            <p>Updating emails…</p>
            <div className="progress-bar-track">
              <div className="progress-bar-fill" />
            </div>
          </div>
        </div>
      )}

      {/* ── Results modal — appears after Update Emails completes ── */}
      {updateResults && (
        <div className="modal-overlay" onClick={() => setUpdateResults(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {updateResults.gmail.failed + updateResults.outlook.failed === 0
                ? "Emails updated successfully"
                : "Emails updated with errors"}
            </h2>
            <div className="results-summary">
              <div className="result-provider">
                <div className="result-provider-title">Gmail</div>
                <div className="result-stats">
                  {updateResults.gmail.archived > 0 && (
                    <span className="result-stat">{updateResults.gmail.archived} archived</span>
                  )}
                  {updateResults.gmail.starred > 0 && (
                    <span className="result-stat">{updateResults.gmail.starred} starred</span>
                  )}
                  {updateResults.gmail.skipped > 0 && (
                    <span className="result-stat stat-muted">{updateResults.gmail.skipped} skipped</span>
                  )}
                  {updateResults.gmail.failed > 0 && (
                    <span className="result-stat stat-error">{updateResults.gmail.failed} failed</span>
                  )}
                </div>
              </div>
              <div className="result-provider">
                <div className="result-provider-title">Outlook</div>
                <div className="result-stats">
                  {updateResults.outlook.archived > 0 && (
                    <span className="result-stat">{updateResults.outlook.archived} archived</span>
                  )}
                  {updateResults.outlook.flagged > 0 && (
                    <span className="result-stat">{updateResults.outlook.flagged} flagged</span>
                  )}
                  {updateResults.outlook.skipped > 0 && (
                    <span className="result-stat stat-muted">{updateResults.outlook.skipped} skipped</span>
                  )}
                  {updateResults.outlook.failed > 0 && (
                    <span className="result-stat stat-error">{updateResults.outlook.failed} failed</span>
                  )}
                </div>
              </div>
            </div>
            {/* Show error details if any */}
            {(updateResults.gmail.errors.length > 0 || updateResults.outlook.errors.length > 0) && (
              <div className="result-errors">
                {[...updateResults.gmail.errors, ...updateResults.outlook.errors].map((e, i) => (
                  <div key={i} className="error-item">{e}</div>
                ))}
              </div>
            )}
            <button className="btn-save modal-ok" onClick={() => setUpdateResults(null)}>
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── EmailSection sub-component ──────────────────────────────────────────────
//
// This renders one "card" — either the Gmail section or the Outlook section.
// It receives all its data and callbacks as "props" (arguments from the parent).
//
// In React, you can define multiple components in the same file. Since this
// component is only used by EmailTriage, it makes sense to keep them together.

function EmailSection({
  src,
  label,
  account,
  emails,
  sort,
  filter,
  onSort,
  onFilter,
  onCategoryChange,
}) {
  // Apply the active filter
  const visible =
    filter === "All" ? emails : emails.filter((e) => e.category === filter);

  // Sort the visible emails
  const sorted = [...visible].sort((a, b) => {
    const va = sort.col === "date" ? a.date : a.from.toLowerCase();
    const vb = sort.col === "date" ? b.date : b.from.toLowerCase();
    if (va < vb) return sort.dir === "asc" ? -1 : 1;
    if (va > vb) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });

  // Filter button definitions — used to render the filter bar
  const filterOptions = ["All", "Important", "FYI", "Not Important"];

  /** Get the CSS class for a filter button based on its label */
  function getFilterBtnClass(cat) {
    if (cat === "Important") return "f-important";
    if (cat === "FYI") return "f-fyi";
    if (cat === "Not Important") return "f-notimportant";
    return "";
  }

  /** Get the sort icon character for a column header */
  function getSortIcon(col) {
    if (sort.col !== col) return "↕";
    return sort.dir === "asc" ? "↑" : "↓";
  }

  return (
    <div className="section">
      {/* ── Section header with title, badge, and filter buttons ──── */}
      <div className="section-header">
        <div className="section-title">
          {label}
          <span className="account">{account}</span>
          <span className="badge-count">
            {visible.length} of {emails.length}
          </span>
        </div>
        <div className="filters">
          {filterOptions.map((cat) => (
            <button
              key={cat}
              className={`filter-btn ${getFilterBtnClass(cat)} ${filter === cat ? "active" : ""}`}
              onClick={() => onFilter(src, cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* ── Email table ──────────────────────────────────────────── */}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th
                className={`sortable ${sort.col === "date" ? "sorted" : ""}`}
                onClick={() => onSort(src, "date")}
              >
                Date{" "}
                <span className="sort-icon">{getSortIcon("date")}</span>
              </th>
              <th>Subject</th>
              <th
                className={`sortable ${sort.col === "from" ? "sorted" : ""}`}
                onClick={() => onSort(src, "from")}
              >
                From{" "}
                <span className="sort-icon">{getSortIcon("from")}</span>
              </th>
              <th>Summary</th>
              <th>Action</th>
              <th>Category</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              // Show a message when there are no emails to display
              <tr className="empty-row">
                <td colSpan={7}>No emails to show.</td>
              </tr>
            ) : (
              // Render one row per email.
              // The "key" prop helps React efficiently update the list when items
              // change — always use a unique identifier (like the email ID).
              sorted.map((email) => (
                <EmailRow
                  key={email.id}
                  src={src}
                  email={email}
                  onCategoryChange={onCategoryChange}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── EmailRow sub-component ──────────────────────────────────────────────────
//
// Renders a single table row for one email. Broken out as its own component
// so each row can update independently when its category changes.

function EmailRow({ src, email, onCategoryChange }) {
  const { name, email: fromEmail } = parseFrom(email.from);
  // Must match buildOutput(): Important → flag, FYI → nothing, rest → archive
  const willAction =
    email.category === "Important"
      ? "flag"
      : email.category === "FYI"
        ? "nothing"
        : "move";

  return (
    <tr className={getCatClass(email.category)}>
      {/* Date */}
      <td className="date-cell">{formatDate(email.date)}</td>

      {/* Subject */}
      <td className="subject-cell">{email.subject}</td>

      {/* From — name and email on separate lines */}
      <td className="from-cell">
        <div className="from-name">{name}</div>
        {fromEmail && <div className="from-email">{fromEmail}</div>}
      </td>

      {/* Summary */}
      <td className="summary-cell">{email.summary}</td>

      {/* Suggested action */}
      <td className="action-cell">{email.action}</td>

      {/* Category buttons — one click to switch category */}
      <td>
        <div className="cat-buttons">
          {["Important", "FYI", "Not Important"].map((cat) => (
            <button
              key={cat}
              className={`cat-btn cat-btn-${getCatClass(cat)} ${email.category === cat ? "active" : ""}`}
              onClick={() => onCategoryChange(src, email.id, cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </td>

      {/* Status — current flag state + what will happen */}
      <td className="status-cell">
        <div className="status-block">
          {email.isFlagged ? (
            <span className="status-current is-flagged">🚩 Flagged</span>
          ) : (
            <span className="status-current not-flagged">— Not flagged</span>
          )}
          {willAction === "flag" ? (
            <span className="status-will will-flag">→ Flag</span>
          ) : willAction === "move" ? (
            <span className="status-will will-move">→ Archive</span>
          ) : (
            <span className="status-will will-nothing">→ Do nothing</span>
          )}
        </div>
      </td>
    </tr>
  );
}
