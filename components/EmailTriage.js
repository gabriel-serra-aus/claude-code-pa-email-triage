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

  // Controls the "action required" modal that appears after saving.
  const [showModal, setShowModal] = useState(false);

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

  // ── Build the output payload for saving ───────────────────────────────────
  function buildOutput() {
    const generated = new Date().toISOString();
    const result = {};

    for (const src of ["gmail", "outlook"]) {
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

  // ── Save actions ──────────────────────────────────────────────────────────
  async function saveActions() {
    const output = buildOutput();
    try {
      // POST to our Next.js API route
      const res = await fetch("/api/save-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(output),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      // Show the modal reminding the user to run the action skill
      setShowModal(true);
    } catch (err) {
      showToast("Save failed — check the console for details");
      console.error(err);
    }
  }

  // ── Compute action summary counts ─────────────────────────────────────────
  const allEmails = [...emails.gmail, ...emails.outlook];
  const toFlag = allEmails.filter((e) => e.category === "Important").length;
  const toMove = allEmails.filter((e) => e.category !== "Important").length;
  const total = allEmails.length;

  // ── Check if source files are stale (older than 24 hours) ────────────────
  // We compare each file's modification time against "now". If either file
  // was modified more than a day ago, we show a red warning banner.
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Find the most recent modification time across both files
  const modifiedTimes = [fileModified.gmail, fileModified.outlook]
    .filter(Boolean)
    .map((iso) => new Date(iso).getTime());
  const latestModified = modifiedTimes.length > 0 ? Math.max(...modifiedTimes) : null;
  const isStale = latestModified !== null && now - latestModified > ONE_DAY_MS;

  /** Format a modification timestamp into a human-readable relative string */
  function formatAge(isoString) {
    if (!isoString) return "unknown";
    const ageMs = now - new Date(isoString).getTime();
    const hours = Math.floor(ageMs / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    return "just now";
  }

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
          <h1>Email Triage</h1>
          <div className="meta">{lastLoaded || "No data loaded"}</div>
        </div>
        <button className="btn-save" onClick={saveActions}>
          Save Flag &amp; Archive Script
        </button>
      </header>

      {/* ── Error banner (only shows if loading failed) ────────────── */}
      {loadError && (
        <div className="load-error">
          <strong>Could not load email data.</strong>
          Make sure the email source JSON files exist in the workspace folder.
        </div>
      )}

      {/* ── Stale data warning (source files older than 24 hours) ─── */}
      {isStale && (
        <div className="stale-warning">
          <strong>Source files are outdated!</strong>
          Gmail data: {formatAge(fileModified.gmail)} — Outlook data: {formatAge(fileModified.outlook)}.
          <br />
          Refresh by running <code>/pa-fetch-emails</code> from the
          Personal Assistance project in Co Work.
        </div>
      )}

      {/* ── Source file info (shows when data is fresh) ─────────────── */}
      {!isStale && latestModified && (
        <div className="source-info">
          Source files updated: Gmail {formatAge(fileModified.gmail)} — Outlook {formatAge(fileModified.outlook)}
        </div>
      )}

      {/* ── Main content — one section per email source ────────────── */}
      <main>
        <EmailSection
          src="gmail"
          label="Gmail"
          account="gabrielserraaus@gmail.com"
          emails={emails.gmail}
          sort={sorts.gmail}
          filter={filters.gmail}
          onSort={onSort}
          onFilter={onFilter}
          onCategoryChange={onCategoryChange}
        />
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
      </main>

      {/* ── Bottom save bar ────────────────────────────────────────── */}
      <div className="save-bar">
        <div className="summary">
          <span>{total}</span> emails loaded — <span>{toFlag}</span> to flag,{" "}
          <span>{toMove}</span> to move
        </div>
        <button className="btn-save" onClick={saveActions}>
          Save Flag &amp; Archive Script
        </button>
      </div>

      {/* ── Toast notification ─────────────────────────────────────── */}
      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>

      {/* ── Modal — appears after saving to remind user to action ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          {/* stopPropagation prevents clicking inside the modal from closing it */}
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Actions saved successfully</h2>
            <p>
              To execute the flag &amp; archive actions on your emails,
              run the following skill in Co Work:
            </p>
            <div className="modal-command">
              <code>/pa-action-emails</code>
              <span>from the Personal Assistance project</span>
            </div>
            <button className="btn-save modal-ok" onClick={() => setShowModal(false)}>
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
  const willAction = email.category === "Important" ? "flag" : "move";

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
          ) : (
            <span className="status-will will-move">→ Move to folder</span>
          )}
        </div>
      </td>
    </tr>
  );
}
