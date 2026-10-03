// The triage context: who matters, what to track, what to ignore, which Gmail
// labels exist. Replaces PA/Email Triage/task-context.md. Edited only by the
// pages (rules.html + the sender panel on triage-review.html) through
// /api/context; step 1 reads it through the connector's `context_get`.
// Objects are strict: the pages own every key, so an unknown one is a bug.
import { z } from "zod";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isoDate = z.string().refine((s) => ISO.test(s) && !Number.isNaN(Date.parse(s)), "not an ISO-8601 timestamp");
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "letters, digits, _ or - only");
const line = z.string().max(300);
const text = z.string().max(4000);
/** `name@domain` or `@domain` — lower-case, no spaces. */
const matcher = z.string().regex(/^([a-z0-9._%+-]+)?@[a-z0-9.-]+\.[a-z]{2,}$/, "an address or @domain, lower-case");

export const PropertySchema = z.strictObject({
  id: z.string().regex(/^P\d{1,3}$/, "P1, P2 …"),
  name: line.min(1),
  address: line,
  managedBy: line,
  label: z.string().nullable(),
  titlePrefix: z.string().max(30),
  notes: text,
});

export const SenderSchema = z.strictObject({
  id,
  name: line.min(1),
  match: z.array(matcher).min(1),
  relationship: line,
  property: z.string().nullable(),
  /** null = no sender label: the label guide decides from the content. */
  label: z.string().nullable(),
  notes: text,
});

export const LabelSchema = z.strictObject({
  id: z.string().min(1).max(60),
  name: line.min(1),
  useFor: line,
  manualOnly: z.boolean(),
});

export const TopicSchema = z.strictObject({ id, name: line.min(1), match: z.array(line.min(1)).min(1), notes: text });
export const IgnoreSchema = z.strictObject({ id, pattern: line.min(1), reason: line });
export const RuleSchema = z.strictObject({ id, text: text.min(1), enabled: z.boolean() });
export const SettingSchema = z.strictObject({ id, name: line.min(1), value: line });

export const ContextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAt: isoDate.nullable(),
  updatedBy: z.string().nullable(),
  properties: z.array(PropertySchema),
  senders: z.array(SenderSchema),
  labels: z.array(LabelSchema),
  /** How a label is chosen when the sender has none (markdown). */
  labelGuide: text,
  topics: z.array(TopicSchema),
  ignore: z.array(IgnoreSchema),
  rules: z.array(RuleSchema),
  settings: z.array(SettingSchema),
});
export type TriageContext = z.infer<typeof ContextSchema>;

function issuePath(path: readonly PropertyKey[]): string {
  return path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, "");
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(values.filter((v) => (seen.has(v) ? true : (seen.add(v), false))))];
}

/** Every problem with a context document, as readable strings. Empty = valid. */
export function checkContext(doc: unknown): string[] {
  const parsed = ContextSchema.safeParse(doc);
  if (!parsed.success) return parsed.error.issues.map((i) => `${issuePath(i.path) || "context"}: ${i.message}`);
  const ctx = parsed.data;
  const problems: string[] = [];

  const lists = { properties: ctx.properties, senders: ctx.senders, labels: ctx.labels, topics: ctx.topics, ignore: ctx.ignore, rules: ctx.rules, settings: ctx.settings };
  for (const [name, items] of Object.entries(lists)) {
    for (const dup of duplicates(items.map((x) => x.id))) problems.push(`${name}: id "${dup}" is used twice`);
  }
  for (const dup of duplicates(ctx.labels.map((l) => l.name))) problems.push(`labels: "${dup}" is listed twice`);

  // A sender or property may only name a label triage is allowed to apply.
  const applicable = new Set(ctx.labels.filter((l) => !l.manualOnly).map((l) => l.name));
  const propertyIds = new Set(ctx.properties.map((p) => p.id));
  ctx.properties.forEach((p, i) => {
    if (p.label !== null && !applicable.has(p.label)) problems.push(`properties[${i}] (${p.id}): label "${p.label}" is not an applicable label`);
  });
  ctx.senders.forEach((s, i) => {
    if (s.label !== null && !applicable.has(s.label)) problems.push(`senders[${i}] (${s.name}): label "${s.label}" is not an applicable label`);
    if (s.property !== null && !propertyIds.has(s.property)) problems.push(`senders[${i}] (${s.name}): property "${s.property}" does not exist`);
  });

  // One address, one sender — otherwise matching is ambiguous.
  for (const dup of duplicates(ctx.senders.flatMap((s) => s.match))) problems.push(`senders: "${dup}" is matched by two senders`);
  return problems;
}

/** A page write: validated, then stamped with who and when (the server's values win). */
export function prepareContextWrite(body: unknown, user: string, now: Date): { doc: TriageContext } | { problems: string[] } {
  const problems = checkContext(body);
  if (problems.length) return { problems };
  const doc = ContextSchema.parse(body);
  return { doc: { ...doc, updatedAt: now.toISOString(), updatedBy: user } };
}

export const HISTORY_PREFIX = "context-history/";
export const HISTORY_KEEP = 50;

/** History keys past the newest HISTORY_KEEP — what to delete. Keys sort by their ISO time. */
export function historyToPrune(keys: string[]): string[] {
  return [...keys].sort().slice(0, Math.max(0, keys.length - HISTORY_KEEP));
}

/** The sender an address belongs to: exact address first, then its @domain. */
export function findSender(ctx: TriageContext, address: string): TriageContext["senders"][number] | null {
  const addr = address.trim().toLowerCase();
  const at = addr.indexOf("@");
  if (at < 0) return null;
  const domain = addr.slice(at);
  return ctx.senders.find((s) => s.match.includes(addr)) ?? ctx.senders.find((s) => s.match.includes(domain)) ?? null;
}

// ── Markdown rendering: what step 1 reads ──────────────────────────────

function cell(value: string | null | undefined): string {
  const v = (value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  return v === "" ? "—" : v;
}
function code(values: string[]): string {
  return values.map((v) => `\`${v}\``).join(", ");
}
function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

/** The context as one markdown document, in the shape the old task-context.md had. */
export function renderContextMarkdown(ctx: TriageContext): string {
  const propertyName = new Map(ctx.properties.map((p) => [p.id, `${p.id} ${p.name}`]));
  const manual = ctx.labels.filter((l) => l.manualOnly);
  const enabledRules = ctx.rules.filter((r) => r.enabled);

  return [
    "# Triage context",
    "",
    `Updated ${ctx.updatedAt ?? "never"}${ctx.updatedBy ? ` by ${ctx.updatedBy}` : ""}. Edited on the triage app's Rules page — never by hand.`,
    "Tasks live in Google Tasks (shared Gmail) and Microsoft To Do (Outlook) — the mailbox decides; nothing here picks a list.",
    "",
    "## 1. Properties",
    "",
    table(["#", "Property", "Address", "Managed by", "Gmail label", "Task title prefix", "Notes"],
      ctx.properties.map((p) => [p.id, cell(p.name), cell(p.address), cell(p.managedBy), p.label ? `\`${p.label}\`` : "—", p.titlePrefix ? `\`${p.titlePrefix}\`` : "—", cell(p.notes)])),
    "",
    "## 2. People & senders",
    "",
    "Emails from anyone listed here are always evaluated for a task, even if they would normally be noise. Match on the email address first, then the @domain, then the display name.",
    "",
    table(["Name", "Email / domain", "Relationship", "Property", "Gmail label", "Notes"],
      ctx.senders.map((s) => [cell(s.name), code(s.match), cell(s.relationship), s.property ? cell(propertyName.get(s.property) ?? s.property) : "—", s.label ? `\`${s.label}\`` : "by content (§3.2)", cell(s.notes)])),
    "",
    "## 3. Gmail labels",
    "",
    "Shared mailbox only (`gabrielandarina@gmail.com`). Outlook has no labels.",
    "",
    "### 3.1 Label registry",
    "",
    "The only labels triage may apply. IDs are authoritative — never resolve by name, never create a label.",
    "",
    table(["Label", "ID", "Use for"],
      ctx.labels.filter((l) => !l.manualOnly).map((l) => [`\`${l.name}\``, `\`${l.id}\``, cell(l.useFor)])),
    "",
    manual.length ? `**Manual only — triage never applies:** ${manual.map((l) => `\`${l.name}\` (\`${l.id}\`)`).join(", ")}.` : "",
    "",
    "### 3.2 How the label is chosen",
    "",
    ctx.labelGuide.trim() || "—",
    "",
    "## 4. Tracked topics",
    "",
    "Subject or body keywords that force a task regardless of sender.",
    "",
    table(["Topic", "Match on", "Notes"], ctx.topics.map((t) => [cell(t.name), cell(t.match.join(", ")), cell(t.notes)])),
    "",
    "## 5. Ignore list",
    "",
    "Never create a task from these. Checked before everything else (labels may still apply).",
    "",
    table(["Sender / pattern", "Reason"], ctx.ignore.map((x) => [cell(x.pattern), cell(x.reason)])),
    "",
    "## 6. Rules",
    "",
    "Free-form. Followed literally; they override everything above.",
    "",
    enabledRules.length ? enabledRules.map((r) => `- ${r.text.trim().replace(/\r?\n/g, "\n  ")}`).join("\n") : "—",
    "",
    "## 7. Run settings",
    "",
    table(["Setting", "Value"], ctx.settings.map((s) => [cell(s.name), cell(s.value)])),
    "",
  ].join("\n");
}
