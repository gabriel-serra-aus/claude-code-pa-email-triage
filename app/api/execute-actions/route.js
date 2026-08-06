/**
 * POST /api/execute-actions
 *
 * Receives the buildOutput() payload from the UI and applies the triage
 * actions to Gmail and Outlook.
 *
 * Gmail:  archive → add "OLD" label + remove INBOX.  important → star.
 * Outlook: archive → move to OLD folder.  important → flag.
 *
 * Auth tokens are reused from the existing MCP servers (no duplicate OAuth).
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";
import * as msal from "@azure/msal-node";
import axios from "axios";
import fs from "fs";
import path from "path";

// ── Feature switch ──────────────────────────────────────────────────────────
// Gmail execution is temporarily disabled. While false, any gmail payload is
// ignored and reported back as skipped — no Gmail API call is ever made.
// Flip to true to re-enable.
const GMAIL_EXECUTION_ENABLED = false;

// ── Paths to MCP server credentials/tokens ──────────────────────────────────
const GMAIL_MCP_DIR = "C:\\Users\\gabri\\Documents\\Claude Code\\mcp-server\\gmail-emails";
const GMAIL_CREDENTIALS = path.join(GMAIL_MCP_DIR, "credentials.json");
const GMAIL_TOKEN = path.join(GMAIL_MCP_DIR, "token.json");

const OUTLOOK_MCP_DIR = "C:\\Users\\gabri\\Documents\\Claude Code\\mcp-server\\outlook-mcp";
const OUTLOOK_TOKEN_CACHE = path.join(OUTLOOK_MCP_DIR, "token_cache.json");
const AZURE_CLIENT_ID = "9ca4fb66-0a24-48d5-9e04-c92c41e633ef";

// Hardcoded OLD folder ID in Outlook (same as the Cowork skill uses)
const OUTLOOK_OLD_FOLDER_ID =
  "AQMkADAwATY0MDABLThhMmUtNjMyNC0wMAItMDAKAC4AAAMTLzebykNBSKW_OFt1Mr34AQC7ZHyNGkSZR67cK0BhujWDAAACAVgAAAA=";

const OUTLOOK_SCOPES = [
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "offline_access",
  "User.Read",
];

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// System label IDs that the Gmail API recognises directly
const SYSTEM_LABELS = new Set([
  "INBOX", "SENT", "DRAFTS", "SPAM", "TRASH",
  "STARRED", "IMPORTANT", "UNREAD",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

// ── Gmail helpers ───────────────────────────────────────────────────────────

function getGmailClient() {
  const raw = JSON.parse(fs.readFileSync(GMAIL_CREDENTIALS, "utf8"));
  const { client_id, client_secret } = raw.installed || raw.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    "http://localhost:3457/oauth2callback"
  );

  const tokens = JSON.parse(fs.readFileSync(GMAIL_TOKEN, "utf8"));
  oauth2Client.setCredentials(tokens);

  // Auto-save refreshed tokens (same pattern as the MCP server)
  oauth2Client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(GMAIL_TOKEN, JSON.stringify(merged, null, 2));
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

async function resolveLabelId(gmail, nameOrId) {
  const upper = nameOrId.toUpperCase();
  if (SYSTEM_LABELS.has(upper)) return upper;

  const res = await gmail.users.labels.list({ userId: "me" });
  const labels = res.data.labels || [];
  const match = labels.find(
    (l) => l.name?.toLowerCase() === nameOrId.toLowerCase() || l.id === nameOrId
  );
  return match?.id || nameOrId;
}

async function processGmail(actions) {
  const results = { archived: 0, starred: 0, skipped: 0, failed: 0, errors: [] };

  if (!actions || actions.length === 0) return results;

  // Feature switch — while disabled, report everything as skipped and never
  // touch the Gmail API.
  if (!GMAIL_EXECUTION_ENABLED) {
    results.skipped = actions.length;
    results.errors.push("Gmail execution is currently disabled (GMAIL_EXECUTION_ENABLED = false).");
    return results;
  }

  // Check that credential files exist before trying
  if (!fs.existsSync(GMAIL_CREDENTIALS) || !fs.existsSync(GMAIL_TOKEN)) {
    results.errors.push("Gmail credentials or token not found. Run the Gmail MCP server once to authenticate.");
    results.failed = actions.filter((a) => a.triage !== "do-nothing").length;
    results.skipped = actions.filter((a) => a.triage === "do-nothing").length;
    return results;
  }

  const gmail = getGmailClient();

  // Resolve the "OLD" label ID once (used for archiving)
  let oldLabelId;
  try {
    oldLabelId = await resolveLabelId(gmail, "OLD");
  } catch (err) {
    results.errors.push(`Failed to resolve OLD label: ${err.message}`);
    results.failed = actions.filter((a) => a.triage === "archive").length;
  }

  for (const action of actions) {
    if (action.triage === "do-nothing") {
      results.skipped++;
      continue;
    }

    try {
      if (action.triage === "archive" && oldLabelId) {
        await gmail.users.messages.modify({
          userId: "me",
          id: action.id,
          requestBody: {
            addLabelIds: [oldLabelId],
            removeLabelIds: ["INBOX"],
          },
        });
        results.archived++;
      } else if (action.triage === "important") {
        await gmail.users.messages.modify({
          userId: "me",
          id: action.id,
          requestBody: {
            addLabelIds: ["STARRED"],
          },
        });
        results.starred++;
      }
    } catch (err) {
      results.failed++;
      results.errors.push(`Gmail ${action.triage} failed for "${action.subject}": ${err.message}`);
    }
  }

  return results;
}

// ── Outlook helpers ─────────────────────────────────────────────────────────

async function getOutlookToken() {
  const cachePlugin = {
    beforeCacheAccess: async (cacheContext) => {
      if (fs.existsSync(OUTLOOK_TOKEN_CACHE)) {
        cacheContext.tokenCache.deserialize(
          fs.readFileSync(OUTLOOK_TOKEN_CACHE, "utf-8")
        );
      }
    },
    afterCacheAccess: async (cacheContext) => {
      if (cacheContext.cacheHasChanged) {
        fs.writeFileSync(
          OUTLOOK_TOKEN_CACHE,
          cacheContext.tokenCache.serialize()
        );
      }
    },
  };

  const pca = new msal.PublicClientApplication({
    auth: {
      clientId: AZURE_CLIENT_ID,
      authority: "https://login.microsoftonline.com/common",
    },
    cache: { cachePlugin },
    system: {
      loggerOptions: {
        loggerCallback: () => {},
        piiLoggingEnabled: false,
        logLevel: msal.LogLevel.Error,
      },
    },
  });

  const tokenCache = pca.getTokenCache();
  const accounts = await tokenCache.getAllAccounts();

  if (accounts.length === 0) {
    throw new Error(
      "No cached Outlook account. Open the Outlook MCP server once to authenticate."
    );
  }

  const result = await pca.acquireTokenSilent({
    scopes: OUTLOOK_SCOPES,
    account: accounts[0],
  });

  if (!result?.accessToken) {
    throw new Error("Silent token refresh failed. Re-authenticate via Outlook MCP server.");
  }

  return result.accessToken;
}

async function processOutlook(actions) {
  const results = { archived: 0, flagged: 0, skipped: 0, failed: 0, errors: [] };

  if (!actions || actions.length === 0) return results;

  // Check that token cache exists
  if (!fs.existsSync(OUTLOOK_TOKEN_CACHE)) {
    results.errors.push("Outlook token cache not found. Run the Outlook MCP server once to authenticate.");
    results.failed = actions.filter((a) => a.triage !== "do-nothing").length;
    results.skipped = actions.filter((a) => a.triage === "do-nothing").length;
    return results;
  }

  let accessToken;
  try {
    accessToken = await getOutlookToken();
  } catch (err) {
    results.errors.push(`Outlook auth failed: ${err.message}`);
    results.failed = actions.filter((a) => a.triage !== "do-nothing").length;
    results.skipped = actions.filter((a) => a.triage === "do-nothing").length;
    return results;
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  for (const action of actions) {
    if (action.triage === "do-nothing") {
      results.skipped++;
      continue;
    }

    try {
      if (action.triage === "archive") {
        await axios.post(
          `${GRAPH_BASE}/me/messages/${action.id}/move`,
          { destinationId: OUTLOOK_OLD_FOLDER_ID },
          { headers }
        );
        results.archived++;
      } else if (action.triage === "important") {
        await axios.patch(
          `${GRAPH_BASE}/me/messages/${action.id}`,
          { flag: { flagStatus: "flagged" } },
          { headers }
        );
        results.flagged++;
      }
    } catch (err) {
      results.failed++;
      const msg = err.response?.data?.error?.message || err.message;
      results.errors.push(`Outlook ${action.triage} failed for "${action.subject}": ${msg}`);
    }
  }

  return results;
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json();

    const gmailActions = body.gmail?.actions || [];
    const outlookActions = body.outlook?.actions || [];

    // Process both providers (Gmail is a no-op while GMAIL_EXECUTION_ENABLED is false)
    const gmailResults = await processGmail(gmailActions);
    const outlookResults = await processOutlook(outlookActions);

    return NextResponse.json({
      ok: true,
      gmail: gmailResults,
      outlook: outlookResults,
    });
  } catch (err) {
    console.error("execute-actions error:", err);
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
