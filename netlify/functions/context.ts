import type { Config } from "@netlify/functions";
import { json, normaliseEtag, requireUser, respond, sameOrigin } from "../lib/auth.ts";
import { HISTORY_PREFIX, historyToPrune, prepareContextWrite } from "../lib/context.ts";
import { deleteDoc, listKeys, readDoc, writeDoc } from "../lib/store.ts";

// GET                → the context + X-Context-ETag | 404
// GET ?history       → { versions: [{ key, replacedAt }] }, newest first
// GET ?version=<key> → one replaced version (restore = PUT it back over the current etag)
async function get(url: URL): Promise<Response> {
  if (url.searchParams.has("history")) {
    const keys = await listKeys(HISTORY_PREFIX);
    const versions = keys.reverse().map((key) => ({ key, replacedAt: key.slice(HISTORY_PREFIX.length) }));
    return json(200, { versions });
  }
  const version = url.searchParams.get("version");
  if (version !== null) {
    if (!version.startsWith(HISTORY_PREFIX)) return json(400, { error: "Not a history key" });
    const old = await readDoc(version as `context-history/${string}`);
    return old ? json(200, old.doc) : json(404, { error: "No such version" });
  }
  const stored = await readDoc("context");
  if (!stored) return json(404, { error: "No context yet" });
  return respond(200, JSON.stringify(stored.doc, null, 2), { "Content-Type": "application/json", ETag: stored.etag, "X-Context-ETag": stored.etag });
}

// PUT replaces the whole context; it never creates one (the seed is loaded once with the CLI).
async function put(req: Request, user: string): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "Bad Origin" });
  const ifMatch = req.headers.get("x-context-etag") ?? req.headers.get("if-match");
  if (!ifMatch) return json(428, { error: "X-Context-ETag (or If-Match) required" });
  const stored = await readDoc("context");
  if (!stored) return json(404, { error: "No context yet" });
  if (normaliseEtag(ifMatch) !== normaliseEtag(stored.etag)) return json(412, { error: "Context changed" });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(422, { error: "Not a valid context", details: ["body: not valid JSON"] });
  }
  const now = new Date();
  const prepared = prepareContextWrite(body, user, now);
  if ("problems" in prepared) return json(422, { error: "Not a valid context", details: prepared.problems });

  const written = await writeDoc("context", prepared.doc, { onlyIfMatch: stored.etag });
  if (!written.modified) return json(412, { error: "Context changed" });
  if (!written.etag) throw new Error("Blobs returned no etag for the written context");

  // Only after the write landed: keep what it replaced, then trim the history.
  await writeDoc(`${HISTORY_PREFIX}${now.toISOString()}`, stored.doc);
  for (const key of historyToPrune(await listKeys(HISTORY_PREFIX))) await deleteDoc(key as `context-history/${string}`);

  return respond(200, JSON.stringify(prepared.doc), { "Content-Type": "application/json", ETag: written.etag, "X-Context-ETag": written.etag });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "PUT") return respond(405);
  const user = requireUser(req);
  if (!user) return json(401, { error: "Sign in required" });
  return req.method === "GET" ? get(new URL(req.url)) : put(req, user);
};

export const config: Config = { path: "/api/context" };
