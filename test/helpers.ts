import { readFileSync } from "node:fs";
import type { Group, GroupStatus, Session } from "../netlify/lib/contract.ts";
import { appendEmails, appendTasks, beginDraft, type Draft } from "../netlify/lib/session-ops.ts";

/** A fresh copy of the SYNTHETIC fixture: a session as the page would save it (decisions filled in, nothing applied). */
export function loadSession(): Session {
  return JSON.parse(readFileSync(new URL("./fixtures/session.json", import.meta.url), "utf8")) as Session;
}

type Loose = Record<string, unknown>;

function withoutDecision(item: Loose): Loose {
  const { decision: _decision, outcome: _outcome, ...rest } = item;
  return rest;
}

/** The fixture's emails / tasks as step 1 sends them: no decision, no outcome. */
export function step1Emails(): Loose[] {
  return loadSession().emails.map(withoutDecision);
}
export function step1Tasks(): Loose[] {
  return loadSession().existingTasks.map(withoutDecision);
}

export const BEGIN = { generatedAt: "2026-08-31T08:00:00.000Z", mailboxes: ["outlook", "gmail"], gmailLabels: ["Travel"] };

/** A draft built the way step 1 builds one, through the real ops. */
export function fixtureDraft(): Draft {
  const draft = beginDraft(null, BEGIN);
  appendEmails(draft, step1Emails());
  appendTasks(draft, step1Tasks());
  return draft;
}

export function withStatus(session: Session, group: Group, status: GroupStatus): Session {
  session.groups[group] = {
    status,
    reviewedAt: status === "pending-review" ? null : "2026-08-31T09:00:00.000Z",
    processedAt: status.startsWith("processed") ? "2026-08-31T10:00:00.000Z" : null,
  };
  return session;
}
