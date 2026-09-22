import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { beforeEach, describe, it } from "node:test";
import { SESSION_COOKIE, env, pageType, requireUser, sameOrigin, signSession, verifySession } from "../netlify/lib/auth.ts";

const NOW = new Date("2026-09-01T00:00:00.000Z");
const DAY = 86400000;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-only-secret-not-used-anywhere";
  process.env.ALLOWED_EMAILS = "allowed@example.com, Second@Example.com";
});

describe("env", () => {
  it("throws with the variable's name when it is missing", () => {
    delete process.env.SESSION_SECRET;
    assert.throws(() => env("SESSION_SECRET"), /Missing environment variable: SESSION_SECRET/);
    assert.throws(() => signSession("allowed@example.com", NOW), /SESSION_SECRET/);
  });
});

describe("session cookie", () => {
  it("round-trips for an allowed address, case-insensitively", () => {
    assert.equal(verifySession(signSession("allowed@example.com", NOW), NOW), "allowed@example.com");
    assert.equal(verifySession(signSession("second@example.com", NOW), NOW), "second@example.com");
  });

  it("lasts 30 days, not longer", () => {
    const cookie = signSession("allowed@example.com", NOW);
    assert.equal(verifySession(cookie, new Date(NOW.getTime() + 30 * DAY - 1000)), "allowed@example.com");
    assert.equal(verifySession(cookie, new Date(NOW.getTime() + 30 * DAY)), null);
  });

  it("refuses a tampered payload, a tampered signature and junk", () => {
    const [payload, signature] = signSession("allowed@example.com", NOW).split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ email: "allowed@example.com", exp: 9999999999 })).toString("base64url");
    assert.equal(verifySession(`${forged}.${signature}`, NOW), null);
    assert.equal(verifySession(`${payload}.${signature.slice(0, -2)}AA`, NOW), null);
    assert.equal(verifySession(`${payload}.${signature}.extra`, NOW), null);
    for (const junk of ["", ".", "abc", "a.b"]) assert.equal(verifySession(junk, NOW), null);
  });

  it("refuses a cookie signed with another secret", () => {
    const payload = Buffer.from(JSON.stringify({ email: "allowed@example.com", exp: 9999999999 })).toString("base64url");
    const signature = createHmac("sha256", "some-other-secret").update(payload).digest("base64url");
    assert.equal(verifySession(`${payload}.${signature}`, NOW), null);
  });

  it("is revoked by removing the address from ALLOWED_EMAILS", () => {
    const cookie = signSession("second@example.com", NOW);
    process.env.ALLOWED_EMAILS = "allowed@example.com";
    assert.equal(verifySession(cookie, NOW), null);
  });
});

describe("request helpers", () => {
  it("requireUser reads the __Host- cookie among others", () => {
    const cookie = signSession("allowed@example.com", new Date());
    const req = new Request("https://site.example/api/session", { headers: { cookie: `theme=dark; ${SESSION_COOKIE}=${cookie}; x=1` } });
    assert.equal(requireUser(req), "allowed@example.com");
    assert.equal(requireUser(new Request("https://site.example/api/session")), null);
    assert.equal(requireUser(new Request("https://site.example/api/session", { headers: { cookie: `tr_session=${cookie}` } })), null);
  });

  it("sameOrigin needs an Origin equal to the request's own", () => {
    const url = "https://site.example/api/session";
    assert.equal(sameOrigin(new Request(url, { headers: { origin: "https://site.example" } })), true);
    assert.equal(sameOrigin(new Request(url, { headers: { origin: "https://evil.example" } })), false);
    assert.equal(sameOrigin(new Request(url, { headers: { origin: "http://site.example" } })), false);
    assert.equal(sameOrigin(new Request(url)), false);
  });

  it("pageType only passes gabriel and gna", () => {
    assert.deepEqual(["gabriel", "gna", "GNA", "//evil.example", "", null].map(pageType), ["gabriel", "gna", null, null, null, null]);
  });
});
