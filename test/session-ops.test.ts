import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Session } from "../netlify/lib/contract.ts";
import {
  OpError, appendEmails, appendTasks, applyOutcomes, beginDraft, canOverwrite, checkDraft, checkPageWrite, countsOf,
  extractWork, finishGroup, groupOf, publishDraft, statusOf, type EmailWork, type NewTaskWork, type TaskWork,
} from "../netlify/lib/session-ops.ts";
import { begin, fixtureDraft, loadSession, step1Emails, step1Tasks, withStatus } from "./helpers.ts";

function assertOpError(fn: () => unknown, code: string, pattern?: RegExp): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof OpError, String(err));
    assert.equal(err.code, code);
    if (pattern) assert.match(err.message, pattern);
    return true;
  });
}

describe("groupOf", () => {
  it("emails by source, tasks by provider", () => {
    assert.equal(groupOf({ source: "gmail" }), "gabriel-arina");
    assert.equal(groupOf({ source: "outlook" }), "gabriel");
    assert.equal(groupOf({ provider: "gtasks" }), "gabriel-arina");
    assert.equal(groupOf({ provider: "todo" }), "gabriel");
  });
});

describe("overwrite gate", () => {
  it("allows when there is no live session", () => {
    assert.equal(canOverwrite(null), true);
  });

  it("refuses while the session is pending-review or reviewed", () => {
    assert.equal(canOverwrite(loadSession()), false);
    assert.equal(canOverwrite(withStatus(loadSession("gabriel-arina"), "reviewed")), false);
  });

  it("allows once the session is processed, processed-with-errors or skipped", () => {
    for (const status of ["processed", "processed-with-errors", "skipped"] as const) {
      assert.equal(canOverwrite(withStatus(loadSession(), status)), true, status);
    }
  });

  it("session_begin is refused over an open session, and allowed with discard", () => {
    assertOpError(() => beginDraft(loadSession(), begin()), "WRONG_STATUS", /live gabriel session still has open work \(pending-review\)/);
    const draft = beginDraft(loadSession(), { ...begin(), discard: true });
    assert.equal(draft.discard, true);
    assert.deepEqual(draft.session.emails, []);
    assert.equal(draft.session.side, "gabriel");
    assert.deepEqual(draft.session.groups, { gabriel: { status: "pending-review", reviewedAt: null, processedAt: null } });
  });

  it("session_publish re-checks the gate unless the draft was begun with discard", () => {
    assertOpError(() => publishDraft(loadSession(), fixtureDraft()), "WRONG_STATUS");
    const discard = fixtureDraft();
    discard.discard = true;
    assert.equal(publishDraft(loadSession(), discard).emails.length, 4);
  });
});

describe("draft batches", () => {
  it("appends and counts", () => {
    const draft = beginDraft(null, begin());
    assert.equal(appendEmails(draft, step1Emails().slice(0, 3)), 3);
    assert.equal(appendEmails(draft, step1Emails().slice(3)), 1);
    assert.equal(appendTasks(draft, step1Tasks()), 2);
    assert.equal(draft.session.emails.length, 4);
    assert.equal(draft.session.existingTasks.length, 2);
  });

  it("refuses an empty batch and one over 25", () => {
    const draft = beginDraft(null, begin());
    assertOpError(() => appendEmails(draft, []), "VALIDATION", /1–25/);
    const many = Array.from({ length: 26 }, (_, i) => ({ ...step1Emails()[1], id: `bulk-${i}`, sourceId: `outlook:bulk-${i}`, threadId: `bulk-thr-${i}` }));
    assertOpError(() => appendEmails(draft, many), "VALIDATION", /got 26/);
    assertOpError(() => appendTasks(draft, []), "VALIDATION");
  });

  it("refuses the other side's emails and tasks, adding nothing", () => {
    const draft = beginDraft(null, begin());
    assertOpError(() => appendEmails(draft, [step1Emails()[1]!, step1Emails("gabriel-arina")[2]!]), "VALIDATION",
      /emails\[1\] \(id g-msg-003\)\.source: "gmail" is not on the gabriel side/);
    assertOpError(() => appendTasks(draft, step1Tasks("gabriel-arina")), "VALIDATION",
      /existingTasks\[0\] \(key gtasks:LIST1:task-a\)\.provider: "gtasks" is not on the gabriel side/);
    assert.equal(draft.session.emails.length, 0);
    assert.equal(draft.session.existingTasks.length, 0);
  });

  it("refuses a duplicate id inside the batch, adding nothing", () => {
    const draft = beginDraft(null, begin());
    const email = step1Emails()[1]!;
    assertOpError(() => appendEmails(draft, [email, email]), "VALIDATION", /emails\[1\] \(id o-msg-002\)\.id: duplicate id/);
    assert.equal(draft.session.emails.length, 0);
  });

  it("refuses an id already in the draft", () => {
    const draft = fixtureDraft();
    assertOpError(() => appendEmails(draft, [step1Emails()[0]!]), "VALIDATION", /o-msg-001\)\.id: duplicate id/);
    assert.equal(draft.session.emails.length, 4);
  });

  it("refuses duplicate task keys, in the batch and in the draft", () => {
    const task = step1Tasks()[0]!;
    assertOpError(() => appendTasks(beginDraft(null, begin()), [task, task]), "VALIDATION", /task-b\)\.key: duplicate key/);
    assertOpError(() => appendTasks(fixtureDraft(), [task]), "VALIDATION", /task-b\)\.key: duplicate key/);
  });

  it("refuses decision / outcome and lists every problem of the batch", () => {
    const draft = beginDraft(null, begin());
    const withDecision = loadSession().emails[0]!;
    const malformed = { ...step1Emails()[1], threadRole: "tail" };
    assertOpError(() => appendEmails(draft, [withDecision, malformed]), "VALIDATION",
      /emails\[0\] \(id o-msg-001\)\.decision: step 1 never writes this key\nemails\[1\] \(id o-msg-002\)\.threadRole: /);
    assert.equal(draft.session.emails.length, 0);
  });
});

describe("publish invariants", () => {
  it("publishes the fixture draft pending, with no newTasks — each side on its own", () => {
    const session = publishDraft(null, fixtureDraft());
    assert.deepEqual(session.groups, { gabriel: { status: "pending-review", reviewedAt: null, processedAt: null } });
    assert.deepEqual(session.newTasks, []);
    assert.deepEqual(countsOf(session), { heads: 3, emails: 4, existingTasks: 2, newTasks: 0 });
    const gna = publishDraft(null, fixtureDraft("gabriel-arina"));
    assert.equal(gna.side, "gabriel-arina");
    assert.deepEqual(countsOf(gna), { heads: 2, emails: 3, existingTasks: 2, newTasks: 0 });
  });

  it("1 — groups is exactly the session's side", () => {
    const draft = fixtureDraft();
    (draft.session.groups as Record<string, unknown>)["gabriel-arina"] = { status: "pending-review", reviewedAt: null, processedAt: null };
    assertOpError(() => publishDraft(null, draft), "VALIDATION", /groups: exactly one key, the session's side "gabriel"/);
  });

  it("2 — exactly one head per thread (the head's batch never arrived)", () => {
    const draft = beginDraft(null, begin());
    appendEmails(draft, step1Emails().filter((e) => e.id !== "o-msg-004"));
    appendTasks(draft, step1Tasks());
    assert.deepEqual(checkDraft(draft), ["thread o-thr-003: 0 heads — every thread needs exactly one"]);
  });

  it("2 — two heads in one thread", () => {
    const draft = beginDraft(null, begin());
    appendEmails(draft, step1Emails().map((e) => (e.id === "o-msg-003" ? { ...e, threadRole: "head", category: "FYI" } : e)));
    appendTasks(draft, step1Tasks());
    assert.deepEqual(checkDraft(draft), ["thread o-thr-003: 2 heads — every thread needs exactly one"]);
  });

  it("3 — head-only fields on a child are refused at the batch", () => {
    const child = { ...step1Emails("gabriel-arina")[1], category: "FYI" };
    assertOpError(() => appendEmails(beginDraft(null, begin("gabriel-arina")), [child]), "VALIDATION", /g-msg-001\)\.category: head-only field on a child/);
  });

  it("4 — every existingTaskKey needs its task (the task batch never arrived)", () => {
    const draft = beginDraft(null, begin());
    appendEmails(draft, step1Emails());
    appendTasks(draft, step1Tasks().filter((t) => t.key !== "todo:LISTA:task-b"));
    assert.deepEqual(checkDraft(draft), ['emails[2] (id o-msg-004).existingTaskKey: no existingTasks[] entry has key "todo:LISTA:task-b"']);
  });

  it("5 — vocabularies are refused at the batch", () => {
    assertOpError(() => appendEmails(beginDraft(null, begin()), [{ ...step1Emails()[1], category: "Urgent" }]), "VALIDATION", /\.category: /);
    assertOpError(() => appendEmails(beginDraft(null, begin()), [{ ...step1Emails()[1], source: "yahoo", sourceId: "yahoo:o-msg-002" }]), "VALIDATION", /\.source: /);
    assertOpError(() => appendTasks(beginDraft(null, begin()), [{ ...step1Tasks()[0], status: "open" }]), "VALIDATION", /\.status: /);
    assertOpError(() => appendTasks(beginDraft(null, begin()), [{ ...step1Tasks()[0], provider: "other" }]), "VALIDATION", /\.provider: /);
  });

  it("6 — sourceId is source:id", () => {
    assertOpError(() => appendEmails(beginDraft(null, begin()), [{ ...step1Emails()[1], sourceId: "o-msg-002" }]), "VALIDATION", /sourceId: must be "outlook:o-msg-002"/);
  });

  it("a draft that is not pending / has newTasks is refused", () => {
    const draft = fixtureDraft();
    draft.session.groups.gabriel = { status: "reviewed", reviewedAt: null, processedAt: null };
    draft.session.newTasks.push({ title: "x", notes: "", provider: "todo", dueDate: "" });
    assert.equal(checkDraft(draft).length, 2);
  });
});

describe("session_status", () => {
  it("never refuses a missing session", () => {
    assert.deepEqual(statusOf("gabriel", null, null), {
      side: "gabriel", exists: false, generatedAt: null, group: null, counts: null, draft: { exists: false, emails: 0, existingTasks: 0 },
    });
  });

  it("reports the side's status, counts and draft", () => {
    const status = statusOf("gabriel-arina", loadSession("gabriel-arina"), fixtureDraft("gabriel-arina"));
    assert.equal(status.exists, true);
    assert.equal(status.side, "gabriel-arina");
    assert.equal(status.generatedAt, "2026-08-31T08:00:00.000Z");
    assert.deepEqual(status.group, { status: "pending-review", reviewedAt: null, processedAt: null });
    assert.deepEqual(status.counts, { heads: 2, emails: 3, existingTasks: 2, newTasks: 1 });
    assert.deepEqual(status.draft, { exists: true, emails: 3, existingTasks: 2 });
  });
});

function reviewed(side: "gabriel" | "gabriel-arina" = "gabriel"): Session {
  return withStatus(loadSession(side), "reviewed");
}

describe("extractWork — reviewed session", () => {
  it("is refused for pending-review, skipped and processed", () => {
    for (const status of ["pending-review", "skipped", "processed"] as const) {
      assertOpError(() => extractWork(withStatus(loadSession(), status), "emails"), "WRONG_STATUS", new RegExp(`gabriel session is "${status}"`));
    }
  });

  it("emails: every message, heads and children, in the save's shape", () => {
    const page = extractWork(reviewed("gabriel-arina"), "emails");
    assert.equal(page.side, "gabriel-arina");
    assert.equal(page.status, "reviewed");
    assert.equal(page.total, 3);
    assert.equal(page.nextCursor, null);
    assert.deepEqual(page.items, [
      {
        id: "g-msg-002", source: "gmail", threadId: "g-thr-001", threadRole: "head", inInbox: true,
        subject: "Re: Example plumber quote", isFlagged: true, action: "update-task", flagged: true,
        labels: ["properties/mount st"], existingTaskKey: "gtasks:LIST1:task-a", wantedLabels: ["properties/mount st", "Travel"],
      },
      {
        id: "g-msg-001", source: "gmail", threadId: "g-thr-001", threadRole: "child", inInbox: false,
        subject: "Example plumber quote", isFlagged: false, action: "archive", flagged: false,
        labels: ["properties/mount st"], wantedLabels: ["properties/mount st"],
      },
      {
        id: "g-msg-003", source: "gmail", threadId: "g-thr-002", threadRole: "head", inInbox: true,
        subject: "Your itinerary has been updated", isFlagged: false, action: "flag", flagged: false,
        labels: ["Travel"], wantedLabels: ["Travel"],
      },
    ]);
  });

  it("emails: task only on create-task — decision.task ?? suggestedTask", () => {
    const session = reviewed();
    const items = extractWork(session, "emails").items as EmailWork[];
    assert.deepEqual(items.map((i) => [i.id, "task" in i]), [["o-msg-001", true], ["o-msg-002", false], ["o-msg-004", false], ["o-msg-003", false]]);
    assert.deepEqual(items[0]!.task, session.emails[0]!.suggestedTask);
    assert.equal("labels" in items[0]!, false);        // outlook: no label keys at all
    assert.equal("wantedLabels" in items[0]!, false);

    const edited = { title: "Edited", notes: "-- notes\nmine\n\n-- auto --", dueDate: "", link: "https://outlook.example.com/mail/o-msg-001" };
    session.emails[0]!.decision!.task = edited;
    assert.deepEqual((extractWork(session, "emails").items as EmailWork[])[0]!.task, edited);
  });

  it("tasks: only those with something to do", () => {
    const gna = extractWork(reviewed("gabriel-arina"), "tasks").items as TaskWork[];
    assert.deepEqual(gna, [{
      key: "gtasks:LIST1:task-a", provider: "gtasks", listId: "LIST1", title: "Mount: plumber quote", status: "needsAction",
      notes: loadSession("gabriel-arina").existingTasks[0]!.notes, dueDate: "2026-09-05", link: "https://mail.example.com/g-msg-001",
      threadId: "g-thr-001", complete: false, cancel: false,
      edits: { link: "https://mail.example.com/g-msg-002", dueDate: "2026-09-04" },
    }]);
    const gabriel = extractWork(reviewed(), "tasks").items as TaskWork[];
    assert.deepEqual(gabriel.map((t) => [t.key, t.complete]), [["todo:LISTA:task-b", true]]);
  });

  it("newTasks: index is the position in newTasks[]", () => {
    assert.deepEqual(extractWork(reviewed("gabriel-arina"), "newTasks").items,
      [{ index: 0, title: "Buy example gift", notes: "-- notes\n\n-- auto --", provider: "gtasks", dueDate: "2026-09-20" }]);
    assert.deepEqual((extractWork(reviewed(), "newTasks").items as NewTaskWork[]).map((t) => t.index), [0]);
  });

  it("refuses an email without a decision", () => {
    const session = reviewed();
    delete session.emails[0]!.decision;
    assertOpError(() => extractWork(session, "emails"), "VALIDATION", /o-msg-001 has no decision/);
  });
});

describe("extractWork — pagination", () => {
  it("walks the pages with nextCursor", () => {
    const session = reviewed();
    const first = extractWork(session, "emails", undefined, 3);
    assert.deepEqual([first.total, first.items.length, first.nextCursor], [4, 3, "3"]);
    const second = extractWork(session, "emails", first.nextCursor ?? undefined, 3);
    assert.deepEqual([(second.items as EmailWork[]).map((i) => i.id), second.nextCursor], [["o-msg-003"], null]);
  });

  it("an exact fit has no next page; a cursor past the end is empty", () => {
    assert.equal(extractWork(reviewed(), "emails", undefined, 4).nextCursor, null);
    const past = extractWork(reviewed(), "emails", "40", 4);
    assert.deepEqual([past.items, past.nextCursor], [[], null]);
  });

  it("refuses a bad cursor or limit", () => {
    for (const cursor of ["abc", "-1", "1.5"]) assertOpError(() => extractWork(reviewed(), "emails", cursor), "VALIDATION", /cursor/);
    for (const limit of [0, 51, 2.5]) assertOpError(() => extractWork(reviewed(), "emails", undefined, limit), "VALIDATION", /limit/);
  });
});

describe("extractWork — processed-with-errors retry", () => {
  function failedRun(): Session {
    const session = reviewed();
    applyOutcomes(session, {
      emails: [{ id: "o-msg-001", outcome: "FAILED: To Do timed out" }, { id: "o-msg-002", outcome: "archived" }, { id: "o-msg-004", outcome: "failed: not found" }],
      tasks: [{ key: "todo:LISTA:task-b", outcome: "Failed: 503" }, { key: "todo:LISTA:task-c", outcome: "untouched" }],
      newTasks: [{ index: 0, outcome: "created" }],
    });
    finishGroup(session, "processed-with-errors", new Date("2026-08-31T10:00:00.000Z"));
    return session;
  }

  it("returns only items whose outcome starts with failed, any case", () => {
    const session = failedRun();
    const emails = extractWork(session, "emails");
    assert.equal(emails.status, "processed-with-errors");
    assert.deepEqual((emails.items as EmailWork[]).map((i) => [i.id, i.outcome]), [["o-msg-001", "FAILED: To Do timed out"], ["o-msg-004", "failed: not found"]]);
    assert.deepEqual((extractWork(session, "tasks").items as TaskWork[]).map((t) => t.key), ["todo:LISTA:task-b"]);
    assert.deepEqual(extractWork(session, "newTasks").items, []);
  });

  it("an item with no outcome, or 'task failed' mid-string, is not a retry item", () => {
    const session = failedRun();
    session.emails[0]!.outcome = "sync failed";
    delete session.emails[2]!.outcome;
    assert.equal(extractWork(session, "emails").total, 0);
  });
});

describe("applyOutcomes", () => {
  it("stamps emails, tasks and newTasks of the session", () => {
    const session = reviewed("gabriel-arina");
    const result = applyOutcomes(session, {
      emails: [{ id: "g-msg-002", outcome: "task updated" }, { id: "g-msg-001", outcome: "archived" }],
      tasks: [{ key: "gtasks:LIST1:task-a", outcome: "updated" }],
      newTasks: [{ index: 0, outcome: "created" }],
    });
    assert.deepEqual(result, { updated: 4, unknown: [] });
    assert.equal(session.emails[0]!.outcome, "task updated");
    assert.equal(session.existingTasks[0]!.outcome, "updated");
    assert.equal(session.newTasks[0]!.outcome, "created");
  });

  it("reports unknown ids — the other side's items are simply not there", () => {
    const session = reviewed("gabriel-arina");
    const result = applyOutcomes(session, {
      emails: [{ id: "nope", outcome: "archived" }, { id: "o-msg-001", outcome: "archived" }, { id: "g-msg-003", outcome: "kept" }],
      tasks: [{ key: "todo:LISTA:task-b", outcome: "completed" }],
      newTasks: [{ index: 9, outcome: "created" }],
    });
    assert.deepEqual(result, { updated: 1, unknown: ["email:nope", "email:o-msg-001", "task:todo:LISTA:task-b", "newTask:9"] });
  });

  it("can be called again, and on a processed-with-errors session", () => {
    const session = withStatus(loadSession(), "processed-with-errors");
    applyOutcomes(session, { emails: [{ id: "o-msg-001", outcome: "FAILED: x" }] });
    applyOutcomes(session, { emails: [{ id: "o-msg-001", outcome: "task created" }] });
    assert.equal(session.emails[0]!.outcome, "task created");
  });

  it("is refused for pending-review, skipped and processed", () => {
    for (const status of ["pending-review", "skipped", "processed"] as const) {
      assertOpError(() => applyOutcomes(withStatus(loadSession(), status), {}), "WRONG_STATUS");
    }
  });
});

describe("finishGroup", () => {
  const now = new Date("2026-08-31T10:30:00.000Z");

  it("reviewed → processed, stamping processedAt and keeping reviewedAt", () => {
    const session = reviewed();
    assert.deepEqual(finishGroup(session, "processed", now), { side: "gabriel", status: "processed", processedAt: "2026-08-31T10:30:00.000Z" });
    assert.deepEqual(session.groups, { gabriel: { status: "processed", reviewedAt: "2026-08-31T09:00:00.000Z", processedAt: "2026-08-31T10:30:00.000Z" } });
  });

  it("reviewed → processed-with-errors → processed (retry)", () => {
    const session = reviewed();
    finishGroup(session, "processed-with-errors", now);
    assert.equal(finishGroup(session, "processed-with-errors", now).status, "processed-with-errors");
    assert.equal(finishGroup(session, "processed", now).status, "processed");
  });

  it("is refused for pending-review, skipped and processed", () => {
    for (const status of ["pending-review", "skipped", "processed"] as const) {
      const session = withStatus(loadSession(), status);
      assertOpError(() => finishGroup(session, "processed", now), "WRONG_STATUS", new RegExp(status));
      assert.equal(session.groups.gabriel?.status, status);
    }
  });
});

describe("checkPageWrite — what the page may change", () => {
  it("allows decisions, categories, newTasks and its own status moves", () => {
    const stored = loadSession();
    const incoming = withStatus(loadSession(), "reviewed");
    incoming.emails[1]!.category = "FYI";
    incoming.emails[1]!.decision!.emailAction = "flag";
    incoming.existingTasks[1]!.decision!.edits = { dueDate: "2026-10-01" };
    incoming.newTasks.pop();
    incoming.newTasks.push({ title: "Another", notes: "", provider: "todo", dueDate: "" });
    assert.deepEqual(checkPageWrite(stored, incoming), []);
    assert.deepEqual(checkPageWrite(loadSession("gabriel-arina"), withStatus(loadSession("gabriel-arina"), "skipped")), []);
  });

  it("allows skipped → pending-review (Reopen) and no change at all", () => {
    assert.deepEqual(checkPageWrite(withStatus(loadSession(), "skipped"), loadSession()), []);
    assert.deepEqual(checkPageWrite(loadSession(), loadSession()), []);
  });

  it("refuses a different side", () => {
    assert.deepEqual(checkPageWrite(loadSession(), loadSession("gabriel-arina")), ['side: the page cannot change it ("gabriel" → "gabriel-arina")']);
  });

  const refusedMoves = [
    ["pending-review", "processed"], ["pending-review", "processed-with-errors"], ["reviewed", "pending-review"],
    ["reviewed", "skipped"], ["reviewed", "processed"], ["skipped", "reviewed"], ["skipped", "processed"],
    ["processed", "pending-review"], ["processed", "reviewed"], ["processed-with-errors", "processed"], ["processed-with-errors", "reviewed"],
  ] as const;
  for (const [from, to] of refusedMoves) {
    it(`refuses ${from} → ${to}`, () => {
      const stored = withStatus(loadSession("gabriel-arina"), from);
      const incoming = withStatus(loadSession("gabriel-arina"), to);
      incoming.groups["gabriel-arina"]!.processedAt = stored.groups["gabriel-arina"]!.processedAt;
      assert.deepEqual(checkPageWrite(stored, incoming), [`groups.gabriel-arina.status: the page cannot move "${from}" to "${to}"`]);
    });
  }

  it("refuses a changed processedAt — set, cleared or edited", () => {
    const processed = () => withStatus(loadSession(), "processed");
    const set = loadSession();
    set.groups.gabriel!.processedAt = "2026-08-31T10:00:00.000Z";
    assert.deepEqual(checkPageWrite(loadSession(), set), ["groups.gabriel.processedAt: only pa-email-triage-save writes it"]);
    const cleared = processed();
    cleared.groups.gabriel!.processedAt = null;
    assert.deepEqual(checkPageWrite(processed(), cleared), ["groups.gabriel.processedAt: only pa-email-triage-save writes it"]);
    const edited = processed();
    edited.groups.gabriel!.processedAt = "2026-09-01T00:00:00.000Z";
    assert.equal(checkPageWrite(processed(), edited).length, 1);
  });

  it("refuses an email outcome that was added, edited or removed", () => {
    const stored = loadSession("gabriel-arina");
    stored.emails[0]!.outcome = "task updated";
    const added = loadSession("gabriel-arina");
    added.emails[0]!.outcome = "task updated";
    added.emails[2]!.outcome = "archived";
    assert.deepEqual(checkPageWrite(stored, added), ["emails (id g-msg-003).outcome: only pa-email-triage-save writes it"]);
    const edited = loadSession("gabriel-arina");
    edited.emails[0]!.outcome = "FAILED: nope";
    assert.deepEqual(checkPageWrite(stored, edited), ["emails (id g-msg-002).outcome: only pa-email-triage-save writes it"]);
    assert.deepEqual(checkPageWrite(stored, loadSession("gabriel-arina")), ["emails (id g-msg-002).outcome: only pa-email-triage-save writes it"]);
  });

  it("refuses a changed existing-task outcome", () => {
    const incoming = loadSession();
    incoming.existingTasks[0]!.outcome = "completed";
    assert.deepEqual(checkPageWrite(loadSession(), incoming), ["existingTasks (key todo:LISTA:task-b).outcome: only pa-email-triage-save writes it"]);
  });

  it("refuses a changed newTask outcome, and dropping an applied newTask", () => {
    const stamped = loadSession();
    stamped.newTasks[0]!.outcome = "created";
    assert.deepEqual(checkPageWrite(loadSession(), stamped), ["newTasks.outcome: only pa-email-triage-save writes it"]);
    assert.deepEqual(checkPageWrite(stamped, loadSession()), ["newTasks.outcome: only pa-email-triage-save writes it"]);
    const dropped = loadSession();
    dropped.newTasks.shift();
    assert.deepEqual(checkPageWrite(stamped, dropped), ["newTasks.outcome: only pa-email-triage-save writes it"]);
    // …while one without an outcome stays the page's to change.
    const added = structuredClone(stamped);
    added.newTasks.push({ title: "More", notes: "", provider: "todo", dueDate: "" });
    assert.deepEqual(checkPageWrite(stamped, added), []);
  });

  it("refuses added or removed emails and tasks", () => {
    const incoming = loadSession();
    incoming.emails.push({ ...incoming.emails[1]!, id: "o-msg-new", sourceId: "outlook:o-msg-new", threadId: "o-thr-new" });
    incoming.existingTasks.splice(1, 1);
    assert.deepEqual(checkPageWrite(loadSession(), incoming), [
      "emails (id o-msg-new): not in the stored session — only pa-email-triage adds emails",
      "existingTasks (key todo:LISTA:task-c): missing — the page never removes existingTasks",
    ]);
  });
});
