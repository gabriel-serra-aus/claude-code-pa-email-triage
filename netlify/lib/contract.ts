// zod mirror of triage-session.schema.jsonc. That file is the authority: if the
// two disagree, the schema file wins and this gets fixed.
// Every object is loose (zod 4's `.passthrough()`), so a key this file does not
// know about survives a round trip — "never drop a key you don't understand".
import { z } from "zod";

export const GROUPS = ["gabriel", "gabriel-arina"] as const;
export const GroupSchema = z.enum(GROUPS);
export type Group = z.infer<typeof GroupSchema>;

export const GroupStatusSchema = z.enum([
  "pending-review",
  "reviewed",
  "skipped",
  "processed",
  "processed-with-errors",
]);
export type GroupStatus = z.infer<typeof GroupStatusSchema>;

export const EmailActionSchema = z.enum([
  "archive",
  "flag",
  "create-task",
  "update-task",
  "complete-task",
  "cancel-task",
]);

// Strict on purpose: the page prints a date it cannot parse as-is, and browsers
// disagree on what parses — so only the one ISO shape gets in.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isoDate = z.string().refine((s) => ISO.test(s) && !Number.isNaN(Date.parse(s)), "not an ISO-8601 timestamp");
// The page puts a task's `url` in an href — never a javascript: one.
const webUrl = z.string().regex(/^https?:\/\//i, "must be an http(s) URL");
const dueDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'must be "YYYY-MM-DD" or ""');
const SourceSchema = z.enum(["gmail", "outlook"]);
const ProviderSchema = z.enum(["gtasks", "todo"]);

const GroupEntrySchema = z.looseObject({
  status: GroupStatusSchema,
  reviewedAt: isoDate.nullable(),
  processedAt: isoDate.nullable(),
});

// Exactly two keys, never a third one.
const GroupsSchema = z.strictObject({
  gabriel: GroupEntrySchema,
  "gabriel-arina": GroupEntrySchema,
});

/** suggestedTask / decision.task — the task a "create-task" head will create. */
const TaskDraftSchema = z.looseObject({
  title: z.string(),
  notes: z.string(),
  dueDate,
  link: z.string().optional(),
});

const EmailDecisionSchema = z.looseObject({
  emailAction: EmailActionSchema,
  isTask: z.boolean(),
  flagged: z.boolean(),
  labels: z.array(z.string()).optional(),
  task: TaskDraftSchema.nullable(),
});

export const EmailSchema = z.looseObject({
  id: z.string().min(1),
  source: SourceSchema,
  sourceId: z.string(),
  from: z.string(),
  subject: z.string(),
  date: isoDate,
  summary: z.string(),
  isFlagged: z.boolean(),
  labels: z.array(z.string()).optional(),
  systemLabels: z.array(z.string()).optional(),
  threadId: z.string().min(1),
  threadRole: z.enum(["head", "child"]),
  inInbox: z.boolean(),
  newInThread: z.boolean().optional(),
  category: z.enum(["Important", "FYI", "Not Important"]).optional(),
  existingTaskKey: z.string().nullable().optional(),
  suggestedTask: TaskDraftSchema.nullable().optional(),
  decision: EmailDecisionSchema.optional(),
  outcome: z.string().optional(),
});
export type Email = z.infer<typeof EmailSchema>;

const TaskEditsSchema = z
  .looseObject({
    notes: z.string().optional(),
    dueDate: dueDate.optional(),
    link: z.string().optional(),
  })
  .refine((e) => !("title" in e), "a task title is written once, at creation — no `title` in edits");

const TaskDecisionSchema = z.looseObject({
  complete: z.boolean(),
  cancel: z.boolean(),
  edits: TaskEditsSchema.nullable(),
});

export const TaskSchema = z.looseObject({
  key: z.string().min(1),
  provider: ProviderSchema,
  listId: z.string().min(1),
  listName: z.string().nullable().optional(),
  url: webUrl.nullable().optional(),
  title: z.string(),
  notes: z.string(),
  status: z.enum(["needsAction", "completed"]),
  dueDate,
  link: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  decision: TaskDecisionSchema.optional(),
  outcome: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const NewTaskSchema = z.looseObject({
  title: z.string(),
  notes: z.string(),
  provider: ProviderSchema,
  dueDate,
  outcome: z.string().optional(),
});
export type NewTask = z.infer<typeof NewTaskSchema>;

export const SessionSchema = z
  .looseObject({
    generatedAt: isoDate,
    mailboxes: z.array(z.string()),
    gmailLabels: z.array(z.string()),
    groups: GroupsSchema,
    emails: z.array(EmailSchema),
    existingTasks: z.array(TaskSchema),
    newTasks: z.array(NewTaskSchema),
  })
  .refine((s) => !("status" in s), "there is no session-level status — only groups.<g>.status");
export type Session = z.infer<typeof SessionSchema>;

/** `session_begin` input. */
export const BeginSchema = z.object({
  generatedAt: isoDate,
  mailboxes: z.array(z.string()),
  gmailLabels: z.array(z.string()),
  discard: z.boolean().optional(),
});
export type BeginInput = z.infer<typeof BeginSchema>;

/** Keys step 1 never writes: `decision` belongs to the page, `outcome` to step 3. */
const NOT_STEP1 = ["decision", "outcome"] as const;

/** "emails[2].threadRole: Invalid option…" lines from a zod error. */
function issueLines(error: z.ZodError, prefix: string): string[] {
  return error.issues.map((i) => {
    const path = i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("");
    return `${prefix}${path}: ${i.message}`;
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** How an item is named in an error: by its identity when it has one. */
function itemName(list: string, index: number, item: unknown, idKey: string): string {
  const id = isRecord(item) && typeof item[idKey] === "string" ? ` (${idKey} ${item[idKey]})` : "";
  return `${list}[${index}]${id}`;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function parseStep1Item<T>(
  schema: z.ZodType<T>,
  list: string,
  index: number,
  item: unknown,
  idKey: string,
  extra: (value: T) => string[],
): Parsed<T> {
  const name = itemName(list, index, item, idKey);
  const problems: string[] = [];
  if (isRecord(item)) {
    for (const key of NOT_STEP1) {
      if (key in item) problems.push(`${name}.${key}: step 1 never writes this key`);
    }
  }
  const result = schema.safeParse(item);
  if (!result.success) return { ok: false, problems: [...problems, ...issueLines(result.error, name)] };
  problems.push(...extra(result.data).map((p) => `${name}${p}`));
  return problems.length ? { ok: false, problems } : { ok: true, value: result.data };
}

/** One email as step 1 sends it: the schema, no decision / outcome, and the per-email invariants. */
export function parseStep1Email(item: unknown, index: number): Parsed<Email> {
  return parseStep1Item(EmailSchema, "emails", index, item, "id", emailProblems);
}

/** One existing task as step 1 sends it. */
export function parseStep1Task(item: unknown, index: number): Parsed<Task> {
  return parseStep1Item(TaskSchema, "existingTasks", index, item, "key", taskProblems);
}

/** Head-only fields. On a child they may be absent, null or false — nothing else. */
const HEAD_ONLY = ["category", "suggestedTask", "existingTaskKey", "newInThread"] as const;

/** Invariants that need only the email itself (3 and 6). Each line starts with the field path. */
function emailProblems(e: Email): string[] {
  const problems: string[] = [];
  if (e.sourceId !== `${e.source}:${e.id}`) problems.push(`.sourceId: must be "${e.source}:${e.id}"`);
  if (e.threadRole === "child") {
    for (const key of HEAD_ONLY) {
      const v = e[key];
      if (v !== undefined && v !== null && v !== false) problems.push(`.${key}: head-only field on a child`);
    }
  } else if (!e.existingTaskKey && e.category === undefined) {
    problems.push(".category: required on a head that is not matched to a task");
  }
  return problems;
}

function taskProblems(t: Task): string[] {
  return t.key.startsWith(`${t.provider}:${t.listId}:`) && t.key.length > `${t.provider}:${t.listId}:`.length
    ? []
    : [`.key: must be "${t.provider}:${t.listId}:<taskId>"`];
}

/**
 * Whole-session check: the zod schema plus every invariant of the contract.
 * Used by `session_publish` on the draft and by `PUT /api/session` on the body.
 * Returns `path: problem` lines; empty = valid.
 */
export function checkSession(doc: unknown): string[] {
  const result = SessionSchema.safeParse(doc);
  if (!result.success) return issueLines(result.error, "session");
  const session = result.data;
  const problems: string[] = [];

  const heads = new Map<string, number>();
  const ids = new Set<string>();
  session.emails.forEach((e, i) => {
    const name = itemName("emails", i, e, "id");
    problems.push(...emailProblems(e).map((p) => `${name}${p}`));
    if (ids.has(e.id)) problems.push(`${name}.id: duplicate id`);
    ids.add(e.id);
    heads.set(e.threadId, (heads.get(e.threadId) ?? 0) + (e.threadRole === "head" ? 1 : 0));
  });
  for (const [threadId, count] of heads) {
    if (count !== 1) problems.push(`thread ${threadId}: ${count} heads — every thread needs exactly one`);
  }

  const keys = new Set<string>();
  session.existingTasks.forEach((t, i) => {
    const name = itemName("existingTasks", i, t, "key");
    problems.push(...taskProblems(t).map((p) => `${name}${p}`));
    if (keys.has(t.key)) problems.push(`${name}.key: duplicate key`);
    keys.add(t.key);
  });
  session.emails.forEach((e, i) => {
    if (e.existingTaskKey && !keys.has(e.existingTaskKey)) {
      problems.push(`${itemName("emails", i, e, "id")}.existingTaskKey: no existingTasks[] entry has key "${e.existingTaskKey}"`);
    }
  });
  return problems;
}
