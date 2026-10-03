import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HISTORY_KEEP, checkContext, findSender, historyToPrune, prepareContextWrite, renderContextMarkdown, type TriageContext,
} from "../netlify/lib/context.ts";

/** SYNTHETIC — the real context holds personal data and never goes in this (public) repo. */
function sample(): TriageContext {
  return {
    schemaVersion: 1,
    updatedAt: null,
    updatedBy: null,
    properties: [{ id: "P1", name: "Elm St", address: "1 Elm St, Testville", managedBy: "Agent Co", label: "Properties/Elm st", titlePrefix: "Elm: ", notes: "" }],
    senders: [
      { id: "pm-1", name: "Pat Manager", match: ["pat@agent.example"], relationship: "Property manager", property: "P1", label: "Properties/Elm st", notes: "Repairs" },
      { id: "bank-2", name: "Bank", match: ["@bank.example"], relationship: "Bank", property: null, label: null, notes: "" },
    ],
    labels: [
      { id: "Label_1", name: "Properties/Elm st", useFor: "P1", manualOnly: false },
      { id: "Label_2", name: "PAID", useFor: "by hand", manualOnly: true },
    ],
    labelGuide: "1. **Sender** — the label column.\n2. Nothing matches → no label.",
    topics: [{ id: "rent-1", name: "Rent", match: ["rent", "arrears"], notes: "" }],
    ignore: [{ id: "ignore-1", pattern: "Marketing blasts", reason: "Noise" }],
    rules: [
      { id: "rule-1", text: "One task per thread.", enabled: true },
      { id: "rule-2", text: "Switched off | rule", enabled: false },
    ],
    settings: [{ id: "setting-1", name: "Emails fetched per mailbox", value: "50" }],
  };
}

describe("checkContext", () => {
  it("accepts a valid context", () => {
    assert.deepEqual(checkContext(sample()), []);
  });

  it("names the field of a schema problem", () => {
    const ctx = sample() as unknown as { senders: { match: string[] }[] };
    ctx.senders[0]!.match = ["Not An Address"];
    assert.match(checkContext(ctx).join("\n"), /senders\[0\]\.match\[0\]: an address or @domain/);
  });

  it("refuses unknown keys — the pages own every key", () => {
    assert.match(checkContext({ ...sample(), extra: 1 }).join("\n"), /extra/);
  });

  it("refuses duplicate ids and duplicate matchers", () => {
    const ctx = sample();
    ctx.senders[1]!.id = "pm-1";
    ctx.senders[1]!.match = ["pat@agent.example"];
    const problems = checkContext(ctx).join("\n");
    assert.match(problems, /senders: id "pm-1" is used twice/);
    assert.match(problems, /"pat@agent.example" is matched by two senders/);
  });

  it("refuses a manual-only or unknown label on a sender, and an unknown property", () => {
    const ctx = sample();
    ctx.senders[0]!.label = "PAID";
    ctx.senders[1]!.label = "Nope";
    ctx.senders[1]!.property = "P9";
    const problems = checkContext(ctx).join("\n");
    assert.match(problems, /"PAID" is not an applicable label/);
    assert.match(problems, /"Nope" is not an applicable label/);
    assert.match(problems, /property "P9" does not exist/);
  });
});

describe("prepareContextWrite", () => {
  it("stamps who and when, whatever the body said", () => {
    const now = new Date("2026-10-03T01:02:03.000Z");
    const result = prepareContextWrite({ ...sample(), updatedBy: "someone-else" }, "me@example.com", now);
    assert.ok("doc" in result);
    assert.equal(result.doc.updatedAt, "2026-10-03T01:02:03.000Z");
    assert.equal(result.doc.updatedBy, "me@example.com");
  });

  it("returns the problems of an invalid body", () => {
    const result = prepareContextWrite({ schemaVersion: 2 }, "me@example.com", new Date());
    assert.ok("problems" in result && result.problems.length > 0);
  });
});

describe("findSender", () => {
  it("matches the exact address first, then the @domain, case-insensitively", () => {
    const ctx = sample();
    assert.equal(findSender(ctx, "Pat@Agent.example")?.id, "pm-1");
    assert.equal(findSender(ctx, "anyone@bank.example")?.id, "bank-2");
    assert.equal(findSender(ctx, "pat@elsewhere.example"), null);
    assert.equal(findSender(ctx, "no-at-sign"), null);
  });
});

describe("historyToPrune", () => {
  it("keeps the newest HISTORY_KEEP keys and returns the rest, oldest first", () => {
    const keys = Array.from({ length: HISTORY_KEEP + 2 }, (_, i) => `context-history/2026-10-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`);
    assert.deepEqual(historyToPrune([...keys].reverse()), keys.slice(0, 2));
    assert.deepEqual(historyToPrune(keys.slice(0, 3)), []);
  });
});

describe("renderContextMarkdown", () => {
  it("renders every section, skips disabled rules and escapes table pipes", () => {
    const md = renderContextMarkdown(sample());
    for (const heading of ["## 1. Properties", "## 2. People & senders", "### 3.1 Label registry", "### 3.2 How the label is chosen", "## 4. Tracked topics", "## 5. Ignore list", "## 6. Rules", "## 7. Run settings"]) {
      assert.ok(md.includes(heading), heading);
    }
    assert.match(md, /\| Pat Manager \| `pat@agent.example` \| Property manager \| P1 Elm St \| `Properties\/Elm st` \| Repairs \|/);
    assert.match(md, /\| Bank \| `@bank.example` \| Bank \| — \| by content \(§3.2\) \| — \|/);
    assert.match(md, /Manual only — triage never applies:\*\* `PAID` \(`Label_2`\)/);
    assert.ok(!md.includes("| `PAID` |"), "manual-only labels stay out of the registry table");
    assert.match(md, /- One task per thread\./);
    assert.ok(!md.includes("Switched off"));
  });
});
