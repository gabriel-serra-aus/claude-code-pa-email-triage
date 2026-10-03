import { readFileSync } from "node:fs";
import { groupOf, type Group, type GroupEntry, type GroupStatus, type Session } from "../netlify/lib/contract.ts";
import { appendEmails, appendTasks, beginDraft, type Draft } from "../netlify/lib/session-ops.ts";

type Loose = Record<string, unknown>;
type Fixture = Pick<Session, "generatedAt" | "mailboxes" | "gmailLabels" | "emails" | "existingTasks" | "newTasks"> & { groups: Record<Group, GroupEntry> };

/**
 * A fresh copy of one side of the SYNTHETIC fixture: a session as the page would save it
 * (decisions filled in, nothing applied). The fixture file holds both sides' items; each
 * side's session is cut from it the way step 1 builds one — only that side's mailbox and tasks.
 *   gabriel:       emails o-msg-001, o-msg-002, o-msg-004 (head), o-msg-003 (child) · tasks task-b, task-c · newTask "Renew passport"
 *   gabriel-arina: emails g-msg-002 (head), g-msg-001 (child), g-msg-003 · tasks task-a, task-d · newTask "Buy example gift"
 */
export function loadSession(side: Group = "gabriel"): Session {
  const all = JSON.parse(readFileSync(new URL("./fixtures/session.json", import.meta.url), "utf8")) as Fixture;
  return {
    ...all,
    side,
    mailboxes: side === "gabriel" ? ["outlook"] : ["gmail"],
    gmailLabels: side === "gabriel" ? [] : all.gmailLabels,
    groups: { [side]: all.groups[side] },
    emails: all.emails.filter((e) => groupOf(e) === side),
    existingTasks: all.existingTasks.filter((t) => groupOf(t) === side),
    newTasks: all.newTasks.filter((t) => groupOf(t) === side),
  };
}

function withoutDecision(item: Loose): Loose {
  const { decision: _decision, outcome: _outcome, ...rest } = item;
  return rest;
}

/** One side's emails / tasks as step 1 sends them: no decision, no outcome. */
export function step1Emails(side: Group = "gabriel"): Loose[] {
  return loadSession(side).emails.map(withoutDecision);
}
export function step1Tasks(side: Group = "gabriel"): Loose[] {
  return loadSession(side).existingTasks.map(withoutDecision);
}

export function begin(side: Group = "gabriel") {
  return { side, generatedAt: "2026-08-31T08:00:00.000Z", mailboxes: side === "gabriel" ? ["outlook"] : ["gmail"], gmailLabels: side === "gabriel" ? [] : ["Travel"] };
}

/** A draft built the way step 1 builds one, through the real ops. */
export function fixtureDraft(side: Group = "gabriel"): Draft {
  const draft = beginDraft(null, begin(side));
  appendEmails(draft, step1Emails(side));
  appendTasks(draft, step1Tasks(side));
  return draft;
}

export function withStatus(session: Session, status: GroupStatus): Session {
  session.groups[session.side] = {
    status,
    reviewedAt: status === "pending-review" ? null : "2026-08-31T09:00:00.000Z",
    processedAt: status.startsWith("processed") ? "2026-08-31T10:00:00.000Z" : null,
  };
  return session;
}
