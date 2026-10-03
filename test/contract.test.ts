import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSession, parseSide, parseStep1Email, parseStep1Task, type Group } from "../netlify/lib/contract.ts";
import { loadSession, step1Emails, step1Tasks } from "./helpers.ts";

/** checkSession on one side of the fixture after one edit; returns the problem lines. */
function problemsAfter(edit: (s: ReturnType<typeof loadSession> & Record<string, unknown>) => void, side: Group = "gabriel-arina"): string[] {
  const session = loadSession(side) as ReturnType<typeof loadSession> & Record<string, unknown>;
  edit(session);
  return checkSession(session);
}

function assertOne(problems: string[], pattern: RegExp): void {
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0] ?? "", pattern);
}

describe("parseSide", () => {
  it("passes exactly the two sides", () => {
    assert.deepEqual(["gabriel", "gabriel-arina", "gna", "Gabriel", "", null].map(parseSide), ["gabriel", "gabriel-arina", null, null, null, null]);
  });
});

describe("checkSession — whole session", () => {
  it("accepts both sides of the fixture", () => {
    assert.deepEqual(checkSession(loadSession("gabriel")), []);
    assert.deepEqual(checkSession(loadSession("gabriel-arina")), []);
  });

  it("keeps keys it does not know about", () => {
    assert.deepEqual(problemsAfter((s) => { s.somethingNew = { a: 1 }; s.emails[0]!.futureKey = "x"; }), []);
  });

  it("refuses a missing or unknown side", () => {
    assert.ok(problemsAfter((s) => { delete (s as Record<string, unknown>).side; }).some((p) => p.includes("side")));
    assert.ok(problemsAfter((s) => { (s as Record<string, unknown>).side = "both"; }).some((p) => p.includes("side")));
  });

  it("refuses a third group", () => {
    assertOne(problemsAfter((s) => { (s.groups as Record<string, unknown>).other = { status: "pending-review", reviewedAt: null, processedAt: null }; }), /groups/);
  });

  it("refuses the other side's group, alone or next to its own", () => {
    const entry = { status: "pending-review", reviewedAt: null, processedAt: null };
    assertOne(problemsAfter((s) => { (s.groups as Record<string, unknown>).gabriel = entry; }), /groups: exactly one key, the session's side "gabriel-arina" — got gabriel, gabriel-arina/);
    assertOne(problemsAfter((s) => { s.groups = { gabriel: entry } as typeof s.groups; }), /got gabriel$/);
    assertOne(problemsAfter((s) => { s.groups = {}; }), /got none/);
  });

  it("refuses an item of the other side", () => {
    const outlook = loadSession("gabriel");
    assertOne(problemsAfter((s) => { s.emails.push(outlook.emails[1]!); }), /emails\[3\] \(id o-msg-002\)\.source: "outlook" is not on the gabriel-arina side/);
    assertOne(problemsAfter((s) => { s.existingTasks.push(outlook.existingTasks[1]!); }), /existingTasks\[2\] \(key todo:LISTA:task-c\)\.provider: "todo" is not on the gabriel-arina side/);
    assertOne(problemsAfter((s) => { s.newTasks.push(outlook.newTasks[0]!); }), /newTasks\[1\]\.provider: "todo" is not on the gabriel-arina side/);
  });

  it("refuses a session-level status", () => {
    assertOne(problemsAfter((s) => { s.status = "pending-review"; }), /no session-level status/);
  });

  it("refuses a thread with two heads", () => {
    assertOne(problemsAfter((s) => { const child = s.emails[1]!; child.threadRole = "head"; child.category = "FYI"; }), /thread g-thr-001: 2 heads/);
  });

  it("refuses a thread with no head", () => {
    const problems = problemsAfter((s) => { s.emails = s.emails.filter((e) => e.id !== "o-msg-004"); }, "gabriel");
    assertOne(problems, /thread o-thr-003: 0 heads/);
  });

  for (const [field, value] of [["category", "FYI"], ["existingTaskKey", "todo:LISTA:task-c"], ["newInThread", true],
    ["suggestedTask", { title: "t", notes: "", dueDate: "", link: "" }]] as const) {
    it(`refuses ${field} on a child`, () => {
      assertOne(problemsAfter((s) => { (s.emails[3] as Record<string, unknown>)[field] = value; }, "gabriel"), new RegExp(`o-msg-003\\)\\.${field}: head-only`));
    });
  }

  it("allows null / false head-only fields on a child", () => {
    assert.deepEqual(problemsAfter((s) => { Object.assign(s.emails[3]!, { existingTaskKey: null, suggestedTask: null, newInThread: false }); }, "gabriel"), []);
  });

  it("refuses an untracked head without a category", () => {
    assertOne(problemsAfter((s) => { delete s.emails[2]!.category; }), /g-msg-003\)\.category: required/);
  });

  it("refuses an existingTaskKey that matches no task", () => {
    assertOne(problemsAfter((s) => { s.emails[0]!.existingTaskKey = "gtasks:LIST1:nope"; }), /existingTaskKey: no existingTasks\[\] entry/);
  });

  it("refuses a sourceId that is not source:id", () => {
    assertOne(problemsAfter((s) => { s.emails[0]!.sourceId = "outlook:other"; }, "gabriel"), /sourceId: must be "outlook:o-msg-001"/);
  });

  it("refuses a task key that is not provider:listId:taskId", () => {
    const problems = problemsAfter((s) => { s.existingTasks[1]!.key = "gtasks:LISTA:task-c"; }, "gabriel");
    assertOne(problems, /key: must be "todo:LISTA:<taskId>"/);
  });

  it("refuses values outside the vocabularies", () => {
    const edits: [string, (s: ReturnType<typeof loadSession>) => void][] = [
      ["source", (s) => { (s.emails[2] as Record<string, unknown>).source = "yahoo"; }],
      ["category", (s) => { (s.emails[2] as Record<string, unknown>).category = "Urgent"; }],
      ["threadRole", (s) => { (s.emails[2] as Record<string, unknown>).threadRole = "tail"; }],
      ["provider", (s) => { (s.existingTasks[1] as Record<string, unknown>).provider = "other"; }],
      ["status", (s) => { (s.existingTasks[1] as Record<string, unknown>).status = "open"; }],
      ["emailAction", (s) => { (s.emails[2]!.decision as Record<string, unknown>).emailAction = "leave-alone"; }],
      ["groups.gabriel-arina.status", (s) => { (s.groups["gabriel-arina"] as Record<string, unknown>).status = "done"; }],
      ["newTasks[0].provider", (s) => { (s.newTasks[0] as Record<string, unknown>).provider = "other"; }],
    ];
    for (const [field, edit] of edits) {
      const problems = problemsAfter(edit);
      assert.ok(problems.length >= 1 && problems.some((p) => p.includes(field.split(".").pop() ?? field)), `${field}: ${problems.join(" | ")}`);
    }
  });

  it("refuses a due date that is not YYYY-MM-DD or empty", () => {
    assertOne(problemsAfter((s) => { s.existingTasks[0]!.dueDate = "5 Sep"; }), /existingTasks\[0\]\.dueDate/);
  });

  it("refuses a date that is not strict ISO-8601 — the page would print it unparsed", () => {
    for (const date of ["31 Aug 2026", "2026-08-31", "Jan 1 2026 (<img src=x onerror=alert(1)>)", ""]) {
      assertOne(problemsAfter((s) => { s.emails[2]!.date = date; }), /emails\[2\]\.date: not an ISO-8601 timestamp/);
    }
    assert.deepEqual(problemsAfter((s) => { s.emails[2]!.date = "2026-08-31T13:40:00+10:00"; s.generatedAt = "2026-08-31T08:00:00Z"; }), []);
  });

  it("refuses a task url that is not http(s) — it becomes an href", () => {
    assertOne(problemsAfter((s) => { s.existingTasks[0]!.url = "javascript:alert(1)"; }, "gabriel"), /existingTasks\[0\]\.url: must be an http\(s\) URL/);
  });

  it("refuses a title inside a task's edits", () => {
    assertOne(problemsAfter((s) => { (s.existingTasks[0]!.decision!.edits as Record<string, unknown>).title = "Renamed"; }), /no `title` in edits/);
  });

  it("refuses duplicate email ids and task keys", () => {
    const problems = problemsAfter((s) => { s.emails.push({ ...s.emails[2]!, threadId: "g-thr-009" }); s.existingTasks.push({ ...s.existingTasks[1]! }); });
    assert.equal(problems.length, 2, problems.join("\n"));
    assert.match(problems.join("\n"), /g-msg-003\)\.id: duplicate id/);
    assert.match(problems.join("\n"), /task-d\)\.key: duplicate key/);
  });
});

describe("step 1 items", () => {
  it("accepts every fixture email and task once decision is stripped", () => {
    for (const side of ["gabriel", "gabriel-arina"] as const) {
      step1Emails(side).forEach((e, i) => assert.equal(parseStep1Email(e, i).ok, true, `${side} emails[${i}]`));
      step1Tasks(side).forEach((t, i) => assert.equal(parseStep1Task(t, i).ok, true, `${side} existingTasks[${i}]`));
    }
  });

  it("refuses decision and outcome, naming the email and the key", () => {
    const result = parseStep1Email({ ...loadSession("gabriel-arina").emails[0], outcome: "archived" }, 4);
    assert.equal(result.ok, false);
    assert.deepEqual(result.ok ? [] : result.problems, [
      "emails[4] (id g-msg-002).decision: step 1 never writes this key",
      "emails[4] (id g-msg-002).outcome: step 1 never writes this key",
    ]);
  });

  it("refuses decision on a task", () => {
    const result = parseStep1Task(loadSession("gabriel-arina").existingTasks[0], 0);
    assert.deepEqual(result.ok ? [] : result.problems, ["existingTasks[0] (key gtasks:LIST1:task-a).decision: step 1 never writes this key"]);
  });

  it("names the email and the field of a malformed email", () => {
    const { inInbox: _inInbox, ...email } = step1Emails("gabriel-arina")[2]!;
    const result = parseStep1Email(email, 7);
    assert.equal(result.ok, false);
    assert.match((result.ok ? [] : result.problems).join("\n"), /^emails\[7\] \(id g-msg-003\)\.inInbox: /);
  });

  it("refuses something that is not an object", () => {
    assert.equal(parseStep1Email("nope", 0).ok, false);
    assert.equal(parseStep1Task(null, 0).ok, false);
  });
});
