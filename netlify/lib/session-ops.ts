// Pure session logic — no I/O. The functions and the MCP handler are thin
// wrappers around these + store.ts. One session = one side; the other side's
// session is a different document and never looked at here.
import {
  checkSession,
  entryOf,
  groupOf,
  parseStep1Email,
  parseStep1Task,
  type BeginInput,
  type Email,
  type Group,
  type GroupStatus,
  type NewTask,
  type Session,
  type Task,
} from "./contract.ts";

export { groupOf };

export type OpErrorCode = "NO_SESSION" | "NO_DRAFT" | "NO_CONTEXT" | "NO_SUMMARY" | "VALIDATION" | "WRONG_STATUS" | "CONFLICT";

/** A refusal the MCP handler turns into `{ isError: true, "<CODE>: <message>" }`. */
export class OpError extends Error {
  readonly code: OpErrorCode;
  constructor(code: OpErrorCode, message: string) {
    super(message);
    this.name = "OpError";
    this.code = code;
  }
}

/** Step 1's work in progress. `discard` = begun with Gabriel's OK to overwrite an open session. */
export type Draft = { discard: boolean; session: Session };

export const MAX_BATCH = 25;
export const DEFAULT_PAGE = 25;
export const MAX_PAGE = 50;

/** The overwrite gate: a session still open (pending or awaiting save) is not replaced. */
const OPEN: readonly GroupStatus[] = ["pending-review", "reviewed"];
export function canOverwrite(live: Session | null): boolean {
  return !live || !OPEN.includes(entryOf(live).status);
}

function assertCanOverwrite(live: Session | null): void {
  if (!live || canOverwrite(live)) return;
  throw new OpError(
    "WRONG_STATUS",
    `the live ${live.side} session still has open work (${entryOf(live).status}). ` +
      "Run pa-email-triage-save first, or pass discard: true only if Gabriel said to discard it.",
  );
}

/** `session_begin`: an empty draft for one side, pending. Refused over that side's open live session unless `discard`. */
export function beginDraft(live: Session | null, input: BeginInput): Draft {
  if (input.discard !== true) assertCanOverwrite(live);
  return {
    discard: input.discard === true,
    session: {
      side: input.side,
      generatedAt: input.generatedAt,
      mailboxes: input.mailboxes,
      gmailLabels: input.gmailLabels,
      groups: { [input.side]: { status: "pending-review", reviewedAt: null, processedAt: null } },
      emails: [],
      existingTasks: [],
      newTasks: [],
    },
  };
}

function assertBatchSize(list: string, batch: readonly unknown[]): void {
  if (batch.length < 1 || batch.length > MAX_BATCH) {
    throw new OpError("VALIDATION", `${list}: send 1–${MAX_BATCH} per call, got ${batch.length}`);
  }
}

/** `session_add_emails`: all or nothing. Returns how many were added. */
export function appendEmails(draft: Draft, batch: readonly unknown[]): number {
  assertBatchSize("emails", batch);
  const seen = new Set(draft.session.emails.map((e) => e.id));
  const problems: string[] = [];
  const parsed: Email[] = [];
  batch.forEach((item, i) => {
    const result = parseStep1Email(item, i);
    if (!result.ok) { problems.push(...result.problems); return; }
    if (groupOf(result.value) !== draft.session.side) {
      problems.push(`emails[${i}] (id ${result.value.id}).source: "${result.value.source}" is not on the ${draft.session.side} side`);
    }
    if (seen.has(result.value.id)) problems.push(`emails[${i}] (id ${result.value.id}).id: duplicate id`);
    seen.add(result.value.id);
    parsed.push(result.value);
  });
  if (problems.length) throw new OpError("VALIDATION", problems.join("\n"));
  draft.session.emails.push(...parsed);
  return parsed.length;
}

/** `session_add_tasks`: all or nothing. Returns how many were added. */
export function appendTasks(draft: Draft, batch: readonly unknown[]): number {
  assertBatchSize("existingTasks", batch);
  const seen = new Set(draft.session.existingTasks.map((t) => t.key));
  const problems: string[] = [];
  const parsed: Task[] = [];
  batch.forEach((item, i) => {
    const result = parseStep1Task(item, i);
    if (!result.ok) { problems.push(...result.problems); return; }
    if (groupOf(result.value) !== draft.session.side) {
      problems.push(`existingTasks[${i}] (key ${result.value.key}).provider: "${result.value.provider}" is not on the ${draft.session.side} side`);
    }
    if (seen.has(result.value.key)) problems.push(`existingTasks[${i}] (key ${result.value.key}).key: duplicate key`);
    seen.add(result.value.key);
    parsed.push(result.value);
  });
  if (problems.length) throw new OpError("VALIDATION", problems.join("\n"));
  draft.session.existingTasks.push(...parsed);
  return parsed.length;
}

/** The draft invariants `session_publish` runs. Empty = publishable. */
export function checkDraft(draft: Draft): string[] {
  const problems = checkSession(draft.session);
  const entry = draft.session.groups[draft.session.side];
  if (entry && entry.status !== "pending-review") problems.push(`groups.${draft.session.side}.status: a new session starts "pending-review"`);
  if (draft.session.newTasks.length) problems.push("newTasks: a new session starts with none");
  return problems;
}

/** `session_publish`: the session to write as live. */
export function publishDraft(live: Session | null, draft: Draft): Session {
  const problems = checkDraft(draft);
  if (problems.length) throw new OpError("VALIDATION", problems.join("\n"));
  if (!draft.discard) assertCanOverwrite(live);
  return draft.session;
}

export type GroupCounts = { heads: number; emails: number; existingTasks: number; newTasks: number };

export function countsOf(session: Session): GroupCounts {
  return {
    heads: session.emails.filter((e) => e.threadRole === "head").length,
    emails: session.emails.length,
    existingTasks: session.existingTasks.length,
    newTasks: session.newTasks.length,
  };
}

/** `session_status` for one side. Never refuses: a missing session is `exists: false`. */
export function statusOf(side: Group, live: Session | null, draft: Draft | null) {
  return {
    side,
    exists: live !== null,
    generatedAt: live ? live.generatedAt : null,
    group: live ? entryOf(live) : null,
    counts: live ? countsOf(live) : null,
    draft: {
      exists: draft !== null,
      emails: draft ? draft.session.emails.length : 0,
      existingTasks: draft ? draft.session.existingTasks.length : 0,
    },
  };
}

/** Step 3 works on a reviewed session, or retries one that finished with errors. */
function assertWorkable(session: Session): GroupStatus {
  const status = entryOf(session).status;
  if (status !== "reviewed" && status !== "processed-with-errors") {
    throw new OpError("WRONG_STATUS", `the ${session.side} session is "${status}" — only "reviewed" or "processed-with-errors" can be applied`);
  }
  return status;
}

const FAILED = /^failed/i;

export type WorkKind = "emails" | "tasks" | "newTasks";
export type EmailWork = {
  id: string; source: string; threadId: string; threadRole: string; inInbox: boolean; subject: string;
  isFlagged: boolean; labels?: string[]; existingTaskKey?: string; action: string; flagged: boolean;
  wantedLabels?: string[]; task?: unknown; outcome?: string;
};
export type TaskWork = {
  key: string; provider: string; listId: string; title: string; status: string; notes: string; dueDate: string;
  link: string | null; threadId: string | null; complete: boolean; cancel: boolean; edits: unknown; outcome?: string;
};
export type NewTaskWork = { index: number; title: string; notes: string; provider: string; dueDate: string; outcome?: string };
export type WorkPage = {
  side: Group; status: GroupStatus; kind: WorkKind; total: number;
  items: EmailWork[] | TaskWork[] | NewTaskWork[]; nextCursor: string | null;
};

function emailWork(e: Email): EmailWork {
  const d = e.decision;
  if (!d) throw new OpError("VALIDATION", `email ${e.id} has no decision — the group was not saved by the review page`);
  const work: EmailWork = {
    id: e.id, source: e.source, threadId: e.threadId, threadRole: e.threadRole, inInbox: e.inInbox,
    subject: e.subject, isFlagged: e.isFlagged, action: d.emailAction, flagged: d.flagged,
  };
  if (e.labels) work.labels = e.labels;
  if (e.existingTaskKey) work.existingTaskKey = e.existingTaskKey;
  if (d.labels) work.wantedLabels = d.labels;
  if (d.emailAction === "create-task") work.task = d.task ?? e.suggestedTask ?? null;
  if (e.outcome !== undefined) work.outcome = e.outcome;
  return work;
}

function taskWork(t: Task): TaskWork | null {
  const d = t.decision;
  if (!d || !(d.complete || d.cancel || d.edits !== null)) return null;
  const work: TaskWork = {
    key: t.key, provider: t.provider, listId: t.listId, title: t.title, status: t.status, notes: t.notes,
    dueDate: t.dueDate, link: t.link ?? null, threadId: t.threadId ?? null,
    complete: d.complete, cancel: d.cancel, edits: d.edits,
  };
  if (t.outcome !== undefined) work.outcome = t.outcome;
  return work;
}

function newTaskWork(t: NewTask, index: number): NewTaskWork {
  const work: NewTaskWork = { index, title: t.title, notes: t.notes, provider: t.provider, dueDate: t.dueDate };
  if (t.outcome !== undefined) work.outcome = t.outcome;
  return work;
}

/** `session_get_work`: one page of only what the save needs. `cursor` is an opaque offset. */
export function extractWork(session: Session, kind: WorkKind, cursor?: string, limit?: number): WorkPage {
  const status = assertWorkable(session);
  const size = limit ?? DEFAULT_PAGE;
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE) {
    throw new OpError("VALIDATION", `limit: must be an integer 1–${MAX_PAGE}`);
  }
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isInteger(offset) || offset < 0) throw new OpError("VALIDATION", "cursor: not a cursor returned by this tool");

  let all: EmailWork[] | TaskWork[] | NewTaskWork[];
  if (kind === "emails") {
    all = session.emails.map(emailWork);
  } else if (kind === "tasks") {
    all = session.existingTasks.map(taskWork).filter((w) => w !== null);
  } else {
    // `index` is the position in newTasks[] — it is what record_outcomes takes back.
    all = session.newTasks.map(newTaskWork);
  }
  // A retry only sees what failed last time.
  const retry = status === "processed-with-errors";
  const wanted = all.filter((w) => !retry || (w.outcome !== undefined && FAILED.test(w.outcome)));
  const end = offset + size;
  return {
    side: session.side, status, kind, total: wanted.length,
    items: wanted.slice(offset, end) as WorkPage["items"],
    nextCursor: end < wanted.length ? String(end) : null,
  };
}

export type OutcomePatch = {
  emails?: { id: string; outcome: string }[];
  tasks?: { key: string; outcome: string }[];
  newTasks?: { index: number; outcome: string }[];
};

/** `session_record_outcomes`: stamps in place. Anything not found in the session is reported, never fatal. */
export function applyOutcomes(session: Session, patch: OutcomePatch): { updated: number; unknown: string[] } {
  assertWorkable(session);
  let updated = 0;
  const unknown: string[] = [];

  const emails = new Map(session.emails.map((e) => [e.id, e]));
  for (const p of patch.emails ?? []) {
    const e = emails.get(p.id);
    if (e) { e.outcome = p.outcome; updated++; } else unknown.push(`email:${p.id}`);
  }
  const tasks = new Map(session.existingTasks.map((t) => [t.key, t]));
  for (const p of patch.tasks ?? []) {
    const t = tasks.get(p.key);
    if (t) { t.outcome = p.outcome; updated++; } else unknown.push(`task:${p.key}`);
  }
  for (const p of patch.newTasks ?? []) {
    const t = session.newTasks[p.index];
    if (t) { t.outcome = p.outcome; updated++; } else unknown.push(`newTask:${p.index}`);
  }
  return { updated, unknown };
}

/** `session_finish_group`: stamps in place. */
export function finishGroup(
  session: Session,
  status: "processed" | "processed-with-errors",
  now: Date,
): { side: Group; status: GroupStatus; processedAt: string } {
  assertWorkable(session);
  const processedAt = now.toISOString();
  session.groups[session.side] = { ...entryOf(session), status, processedAt };
  return { side: session.side, status, processedAt };
}

/** The only status moves the page may make. */
const PAGE_MOVES: Partial<Record<GroupStatus, readonly GroupStatus[]>> = {
  "pending-review": ["reviewed", "skipped"],
  skipped: ["pending-review"],
};

function outcomesById<T extends { outcome?: string }>(items: readonly T[], id: (item: T) => string): Map<string, string | undefined> {
  return new Map(items.map((item) => [id(item), item.outcome]));
}

/**
 * `PUT /api/session` ownership check: what the page sends may differ from the
 * stored session only in what the page owns. Returns the violations; empty = ok.
 * Both arguments have already passed `checkSession`.
 */
export function checkPageWrite(stored: Session, incoming: Session): string[] {
  if (incoming.side !== stored.side) return [`side: the page cannot change it ("${stored.side}" → "${incoming.side}")`];
  const problems: string[] = [];

  const g = stored.side;
  const from = entryOf(stored);
  const to = entryOf(incoming);
  if (to.processedAt !== from.processedAt) problems.push(`groups.${g}.processedAt: only pa-email-triage-save writes it`);
  if (to.status !== from.status && !(PAGE_MOVES[from.status] ?? []).includes(to.status)) {
    problems.push(`groups.${g}.status: the page cannot move "${from.status}" to "${to.status}"`);
  }

  // Emails and existing tasks are step 1's: same set, and step 3's outcomes untouched.
  const lists = [
    { name: "emails", idKey: "id", was: outcomesById(stored.emails, (e) => e.id), now: outcomesById(incoming.emails, (e) => e.id) },
    { name: "existingTasks", idKey: "key", was: outcomesById(stored.existingTasks, (t) => t.key), now: outcomesById(incoming.existingTasks, (t) => t.key) },
  ];
  for (const { name, idKey, was, now } of lists) {
    for (const [id, outcome] of now) {
      if (!was.has(id)) problems.push(`${name} (${idKey} ${id}): not in the stored session — only pa-email-triage adds ${name}`);
      else if (was.get(id) !== outcome) problems.push(`${name} (${idKey} ${id}).outcome: only pa-email-triage-save writes it`);
    }
    for (const id of was.keys()) {
      if (!now.has(id)) problems.push(`${name} (${idKey} ${id}): missing — the page never removes ${name}`);
    }
  }

  // newTasks are the page's, but one that carries an outcome was already applied:
  // those must come back exactly as stored.
  const applied = (s: Session) => s.newTasks.filter((t) => t.outcome !== undefined).map((t) => JSON.stringify(t));
  const was = applied(stored);
  const now = applied(incoming);
  if (was.length !== now.length || was.some((t, i) => t !== now[i])) {
    problems.push("newTasks.outcome: only pa-email-triage-save writes it");
  }
  return problems;
}
