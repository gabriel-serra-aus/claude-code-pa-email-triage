// The "triage-session" connector both skills use. Stateless Streamable HTTP:
// a new server + transport per request, no session ids, JSON responses.
// Every tool takes a required `side` — the two sides are separate documents
// (session, draft, context, summary) and no tool ever touches both.
// Known weakness, accepted for v1: claude.ai custom connectors take OAuth or
// nothing, so the secret sits in the URL path — bearer-token strength, no more.
import { timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { env, respond } from "../lib/auth.ts";
import { renderContextMarkdown, type TriageContext } from "../lib/context.ts";
import { BeginSchema, GroupSchema, type Group, type Session } from "../lib/contract.ts";
import {
  OpError, appendEmails, appendTasks, applyOutcomes, beginDraft, countsOf, extractWork, finishGroup, publishDraft,
  statusOf, type Draft, type OpErrorCode,
} from "../lib/session-ops.ts";
import { SUMMARY_MAX, type Summary } from "../lib/summary.ts";
import { deleteDoc, readDoc, writeDoc, type DocKey } from "../lib/store.ts";

const ATTEMPTS = 3;

async function readLive(side: Group): Promise<Session | null> {
  const stored = await readDoc(`session-${side}`);
  return stored ? (stored.doc as Session) : null;
}
async function readDraft(side: Group): Promise<Draft | null> {
  const stored = await readDoc(`draft-${side}`);
  return stored ? (stored.doc as Draft) : null;
}

/** Read–patch–onlyIfMatch loop. `patch` mutates the doc in place and returns the tool's answer. */
async function mutate<D, T>(key: DocKey, missing: OpErrorCode, patch: (doc: D) => T): Promise<T> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const stored = await readDoc(key);
    if (!stored) {
      throw new OpError(missing, missing === "NO_DRAFT" ? "no draft — call session_begin first" : `there is no live session (${key})`);
    }
    const result = patch(stored.doc as D);
    const { modified } = await writeDoc(key, stored.doc, { onlyIfMatch: stored.etag });
    if (modified) return result;
  }
  throw new OpError("CONFLICT", `the ${key} kept changing under this call (${ATTEMPTS} attempts) — call again`);
}

/** Tool answers are JSON text; an OpError becomes `<CODE>: <message>`. Anything else is a bug and throws. */
async function answer(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await run()) }] };
  } catch (err) {
    if (!(err instanceof OpError)) throw err;
    return { isError: true, content: [{ type: "text", text: `${err.code}: ${err.message}` }] };
  }
}

// Batches are validated item by item in session-ops, so a bad one comes back as
// `VALIDATION:` naming the email / task and the field, not as a generic schema error.
const Batch = z.array(z.record(z.string(), z.unknown()));
const Outcome = z.string().min(1);
const side = GroupSchema.describe('"gabriel" (Outlook + Microsoft To Do) or "gabriel-arina" (shared Gmail + Google Tasks). Required — never guessed.');

function buildServer(): McpServer {
  const server = new McpServer({ name: "triage-session", version: "2.0.0" });

  server.registerTool("session_status", {
    description: "One side's live triage session: whether it exists, its generatedAt, its review status (group) and item counts, plus the state of step 1's draft for that side. Never errors on a missing session: exists is false.",
    inputSchema: { side },
  }, ({ side }) => answer(async () => statusOf(side, await readLive(side), await readDraft(side))));

  server.registerTool("session_begin", {
    description: "Step 1: start a new DRAFT session for one side, replacing that side's earlier draft. Refused (WRONG_STATUS) while that side's live session is pending-review or reviewed, unless discard is true — pass that only after Gabriel explicitly said to discard it. The other side is never looked at.",
    inputSchema: BeginSchema.shape,
  }, (input) => answer(async () => {
    await writeDoc(`draft-${input.side}`, beginDraft(await readLive(input.side), input));
    return { ok: true, side: input.side };
  }));

  server.registerTool("session_add_emails", {
    description: "Step 1: append 1–25 emails to the side's draft. Each email is the session's email object WITHOUT decision / outcome, and must be that side's (gmail → gabriel-arina, outlook → gabriel). All or nothing: on VALIDATION fix the named field and resend the batch.",
    inputSchema: { side, emails: Batch },
  }, ({ side, emails }) => answer(() => mutate(`draft-${side}`, "NO_DRAFT", (draft: Draft) => {
    const added = appendEmails(draft, emails);
    return { added, totalEmails: draft.session.emails.length };
  })));

  server.registerTool("session_add_tasks", {
    description: "Step 1: append 1–25 existing tasks to the side's draft. Each task is the session's existingTasks object WITHOUT decision / outcome, and must be that side's (gtasks → gabriel-arina, todo → gabriel). All or nothing.",
    inputSchema: { side, existingTasks: Batch },
  }, ({ side, existingTasks }) => answer(() => mutate(`draft-${side}`, "NO_DRAFT", (draft: Draft) => {
    const added = appendTasks(draft, existingTasks);
    return { added, totalTasks: draft.session.existingTasks.length };
  })));

  server.registerTool("session_publish", {
    description: "Step 1: check the side's whole draft and make it that side's live session (pending-review, newTasks empty), store the run summary (markdown) as that side's summary, then delete the draft. On VALIDATION it lists every problem by thread / email / task.",
    inputSchema: { side, summary: z.string().min(1).max(SUMMARY_MAX) },
  }, ({ side, summary }) => answer(async () => {
    const draft = await readDraft(side);
    if (!draft) throw new OpError("NO_DRAFT", "no draft — call session_begin first");
    const session = publishDraft(await readLive(side), draft);
    await writeDoc(`session-${side}`, session);
    const stored: Summary = { side, generatedAt: session.generatedAt, publishedAt: new Date().toISOString(), markdown: summary };
    await writeDoc(`summary-${side}`, stored);
    await deleteDoc(`draft-${side}`);
    return { ok: true, side, counts: countsOf(session) };
  }));

  server.registerTool("session_get_work", {
    description: "Step 3: one page of what to apply for a side — kind emails (every message, heads and children), tasks (only existing tasks with something to do) or newTasks. Follow nextCursor until it is null. Only for a reviewed session (everything) or a processed-with-errors one (only items whose outcome starts with 'failed').",
    inputSchema: {
      side,
      kind: z.enum(["emails", "tasks", "newTasks"]),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  }, ({ side, kind, cursor, limit }) => answer(async () => {
    const live = await readLive(side);
    if (!live) throw new OpError("NO_SESSION", `there is no live ${side} session`);
    return extractWork(live, kind, cursor, limit);
  }));

  server.registerTool("session_record_outcomes", {
    description: "Step 3: stamp outcome strings on the side's emails (by id), existing tasks (by key) and new tasks (by index from session_get_work). Call it after each batch of work so an interrupted run keeps its progress. Items not found come back in unknown.",
    inputSchema: {
      side,
      emails: z.array(z.object({ id: z.string(), outcome: Outcome })).optional(),
      tasks: z.array(z.object({ key: z.string(), outcome: Outcome })).optional(),
      newTasks: z.array(z.object({ index: z.number().int().min(0), outcome: Outcome })).optional(),
    },
  }, ({ side, ...patch }) => answer(() => mutate(`session-${side}`, "NO_SESSION", (live: Session) => applyOutcomes(live, patch))));

  server.registerTool("session_finish_group", {
    description: "Step 3: mark the side's reviewed (or processed-with-errors) session processed or processed-with-errors. The server stamps processedAt.",
    inputSchema: { side, status: z.enum(["processed", "processed-with-errors"]) },
  }, ({ side, status }) => answer(() => mutate(`session-${side}`, "NO_SESSION", (live: Session) => finishGroup(live, status, new Date()))));

  server.registerTool("context_get", {
    description: "Step 1: one side's triage context (properties, tracked senders, Gmail label registry and guide, topics, ignore list, free-form rules, run settings). Read-only: Gabriel edits it on the app's Rules page. format markdown (default) is the document to follow; json is the raw data. NO_CONTEXT if that side's context was never created.",
    inputSchema: { side, format: z.enum(["markdown", "json"]).optional() },
  }, ({ side, format }) => answer(async () => {
    const stored = await readDoc(`context-${side}`);
    if (!stored) throw new OpError("NO_CONTEXT", `there is no ${side} triage context — stop and tell Gabriel`);
    const ctx = stored.doc as TriageContext;
    return format === "json" ? ctx : { side, updatedAt: ctx.updatedAt, markdown: renderContextMarkdown(ctx, side) };
  }));

  server.registerTool("summary_get", {
    description: "One side's run summary (markdown) as stored by the last session_publish, with its generatedAt / publishedAt. NO_SUMMARY if that side has none yet.",
    inputSchema: { side },
  }, ({ side }) => answer(async () => {
    const stored = await readDoc(`summary-${side}`);
    if (!stored) throw new OpError("NO_SUMMARY", `there is no ${side} summary yet`);
    return stored.doc as Summary;
  }));

  return server;
}

function secretMatches(given: string | undefined): boolean {
  const expected = Buffer.from(env("MCP_SECRET"));
  const actual = Buffer.from(given ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (!secretMatches(context.params.secret)) return respond(404);
  if (req.method !== "POST") return respond(405, null, { Allow: "POST" });

  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(req);
  res.headers.set("Cache-Control", "no-store");
  return res;
};

export const config: Config = { path: "/mcp/:secret" };
