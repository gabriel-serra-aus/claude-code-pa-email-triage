import type { Config } from "@netlify/functions";
import { json, requireUser, respond, sameOrigin } from "../lib/auth.ts";
import { checkSession, type Session } from "../lib/contract.ts";
import { checkPageWrite } from "../lib/session-ops.ts";
import { readDoc, writeDoc } from "../lib/store.ts";

/**
 * Netlify's CDN rewrites the `ETag` it serves when it compresses a response
 * (`"abc"` → `"abc-df"`, or weakened), so the raw Blobs etag also travels in
 * `X-Session-ETag`, which the CDN leaves alone. Both sides are normalised anyway.
 */
function normaliseEtag(value: string): string {
  return value.trim().replace(/^W\//, "").replace(/-[a-z]+"$/, '"');
}

async function get(): Promise<Response> {
  const stored = await readDoc("session");
  if (!stored) return json(404, { error: "No session yet" });
  return respond(200, JSON.stringify(stored.doc, null, 2), { "Content-Type": "application/json", ETag: stored.etag, "X-Session-ETag": stored.etag });
}

// PUT never creates a session — only session_publish does. Checks run in the spec's order.
async function put(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "Bad Origin" });

  // Netlify's edge strips `If-Match` from requests before they reach a function
  // (seen 22 Sep 2026: the page's PUT arrived without it), so the page carries the
  // etag in `X-Session-ETag`; `If-Match` still works where nothing strips it.
  const ifMatch = req.headers.get("x-session-etag") ?? req.headers.get("if-match");
  if (!ifMatch) return json(428, { error: "X-Session-ETag (or If-Match) required" });
  const stored = await readDoc("session");
  if (!stored) return json(404, { error: "No session yet" });
  if (normaliseEtag(ifMatch) !== normaliseEtag(stored.etag)) return json(412, { error: "Session changed" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(422, { error: "Not a valid session", details: ["body: not valid JSON"] });
  }
  const contract = checkSession(body);
  if (contract.length) return json(422, { error: "Not a valid session", details: contract });

  // Both passed checkSession (the stored one when it was written).
  const ownership = checkPageWrite(stored.doc as Session, body as Session);
  if (ownership.length) return json(422, { error: "The page cannot change that", details: ownership });

  const written = await writeDoc("session", body, { onlyIfMatch: stored.etag });
  if (!written.modified) return json(412, { error: "Session changed" });
  if (!written.etag) throw new Error("Blobs returned no etag for the written session");
  return json(200, { ok: true }, { ETag: written.etag, "X-Session-ETag": written.etag });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "PUT") return respond(405);
  if (!requireUser(req)) return json(401, { error: "Sign in required" });
  return req.method === "GET" ? get() : put(req);
};

export const config: Config = { path: "/api/session" };
