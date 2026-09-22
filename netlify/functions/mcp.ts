// The "triage-session" connector both skills use. Stateless Streamable HTTP:
// a new server + transport per request, no session ids, JSON responses.
// Known weakness, accepted for v1: claude.ai custom connectors take OAuth or
// nothing, so the secret sits in the URL path — bearer-token strength, no more.
import { timingSafeEqual } from "node:crypto";
import type { Config, Context } from "@netlify/functions";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { env, respond } from "../lib/auth.ts";
import { BeginSchema, GroupSchema, type Session } from "../lib/contract.ts";
import {
  OpError, appendEmails, appendTasks, applyOutcomes, beginDraft, countsOf, extractWork, finishGroup, publishDraft,
  statusOf, type Draft, type OpErrorCode,
} from "../lib/session-ops.ts";
import { deleteDoc, readDoc, writeDoc, type DocKey } from "../lib/store.ts";

const ATTEMPTS = 3;

async function readLive(): Promise<Session | null> {
  const stored = await readDoc("session");
  return stored ? (stored.doc as Session) : null;
}
async function readDraft(): Promise<Draft | null> {
  const stored = await readDoc("draft");
  return stored ? (stored.doc as Draft) : null;
}

/** Read–patch–onlyIfMatch loop. `patch` mutates the doc in place and returns the tool's answer. */
async function mutate<D, T>(key: DocKey, missing: OpErrorCode, patch: (doc: D) => T): Promise<T> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const stored = await readDoc(key);
    if (!stored) {
      throw new OpError(missing, missing === "NO_DRAFT" ? "no draft — call session_begin first" : "there is no live session");
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

function buildServer(): McpServer {
  const server = new McpServer({ name: "triage-session", version: "1.0.0" });

  server.registerTool("session_status", {
    description: "Whether a live triage session exists, its generatedAt, both group statuses and item counts per group, plus the state of step 1's draft. Never errors on a missing session: exists is false.",
    inputSchema: {},
  }, () => answer(async () => statusOf(await readLive(), await readDraft())));

  server.registerTool("session_begin", {
    description: "Step 1: start a new DRAFT session, replacing any earlier draft. Refused (WRONG_STATUS) while the live session has a group that is pending-review or reviewed, unless discard is true — pass that only after Gabriel explicitly said to discard it.",
    inputSchema: BeginSchema.shape,
  }, (input) => answer(async () => {
    await writeDoc("draft", beginDraft(await readLive(), input));
    return { ok: true };
  }));

  server.registerTool("session_add_emails", {
    description: "Step 1: append 1–25 emails to the draft. Each email is the session's email object WITHOUT decision / outcome. All or nothing: on VALIDATION fix the named field and resend the batch.",
    inputSchema: { emails: Batch },
  }, ({ emails }) => answer(() => mutate("draft", "NO_DRAFT", (draft: Draft) => {
    const added = appendEmails(draft, emails);
    return { added, totalEmails: draft.session.emails.length };
  })));

  server.registerTool("session_add_tasks", {
    description: "Step 1: append 1–25 existing tasks to the draft. Each task is the session's existingTasks object WITHOUT decision / outcome. All or nothing.",
    inputSchema: { existingTasks: Batch },
  }, ({ existingTasks }) => answer(() => mutate("draft", "NO_DRAFT", (draft: Draft) => {
    const added = appendTasks(draft, existingTasks);
    return { added, totalTasks: draft.session.existingTasks.length };
  })));

  server.registerTool("session_publish", {
    description: "Step 1: check the whole draft and make it the live session (both groups pending-review, newTasks empty), then delete the draft. On VALIDATION it lists every problem by thread / email / task.",
    inputSchema: {},
  }, () => answer(async () => {
    const draft = await readDraft();
    if (!draft) throw new OpError("NO_DRAFT", "no draft — call session_begin first");
    const session = publishDraft(await readLive(), draft);
    await writeDoc("session", session);
    await deleteDoc("draft");
    return { ok: true, counts: countsOf(session) };
  }));

  server.registerTool("session_get_work", {
    description: "Step 3: one page of what to apply for a group — kind emails (every message, heads and children), tasks (only existing tasks with something to do) or newTasks. Follow nextCursor until it is null. Only for a reviewed group (everything) or a processed-with-errors group (only items whose outcome starts with 'failed').",
    inputSchema: {
      group: GroupSchema,
      kind: z.enum(["emails", "tasks", "newTasks"]),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
  }, ({ group, kind, cursor, limit }) => answer(async () => {
    const live = await readLive();
    if (!live) throw new OpError("NO_SESSION", "there is no live session");
    return extractWork(live, group, kind, cursor, limit);
  }));

  server.registerTool("session_record_outcomes", {
    description: "Step 3: stamp outcome strings on emails (by id), existing tasks (by key) and new tasks (by index from session_get_work). Call it after each batch of work so an interrupted run keeps its progress. Items not found in the group come back in unknown.",
    inputSchema: {
      group: GroupSchema,
      emails: z.array(z.object({ id: z.string(), outcome: Outcome })).optional(),
      tasks: z.array(z.object({ key: z.string(), outcome: Outcome })).optional(),
      newTasks: z.array(z.object({ index: z.number().int().min(0), outcome: Outcome })).optional(),
    },
  }, ({ group, ...patch }) => answer(() => mutate("session", "NO_SESSION", (live: Session) => applyOutcomes(live, group, patch))));

  server.registerTool("session_finish_group", {
    description: "Step 3: mark a reviewed (or processed-with-errors) group processed or processed-with-errors. The server stamps processedAt.",
    inputSchema: { group: GroupSchema, status: z.enum(["processed", "processed-with-errors"]) },
  }, ({ group, status }) => answer(() => mutate("session", "NO_SESSION", (live: Session) => finishGroup(live, group, status, new Date()))));

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
