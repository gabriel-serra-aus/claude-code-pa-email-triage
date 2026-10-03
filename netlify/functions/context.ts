import type { Config } from "@netlify/functions";
import { json, normaliseEtag, requireUser, respond, sameOrigin } from "../lib/auth.ts";
import { historyPrefix, historyToPrune, prepareContextWrite } from "../lib/context.ts";
import { parseSide, type Group } from "../lib/contract.ts";
import { deleteDoc, listKeys, readDoc, writeDoc, type DocKey } from "../lib/store.ts";

// Every call names its side: /api/context?side=gabriel | gabriel-arina.
// GET                → the side's context + X-Context-ETag | 404
// GET &history       → { versions: [{ key, replacedAt }] }, newest first
// GET &version=<key> → one replaced version of that side (restore = PUT it back over the current etag)
async function get(url: URL, side: Group): Promise<Response> {
  const prefix = historyPrefix(side);
  if (url.searchParams.has("history")) {
    const keys = await listKeys(prefix);
    const versions = keys.reverse().map((key) => ({ key, replacedAt: key.slice(prefix.length) }));
    return json(200, { versions });
  }
  const version = url.searchParams.get("version");
  if (version !== null) {
    if (!version.startsWith(prefix)) return json(400, { error: "Not a history key of this side" });
    const old = await readDoc(version as DocKey);
    return old ? json(200, old.doc) : json(404, { error: "No such version" });
  }
  const stored = await readDoc(`context-${side}`);
  if (!stored) return json(404, { error: "No context yet" });
  return respond(200, JSON.stringify(stored.doc, null, 2), { "Content-Type": "application/json", ETag: stored.etag, "X-Context-ETag": stored.etag });
}

// PUT replaces the whole context; it never creates one (each side's first copy is loaded once with the CLI).
async function put(req: Request, user: string, side: Group): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: "Bad Origin" });
  const ifMatch = req.headers.get("x-context-etag") ?? req.headers.get("if-match");
  if (!ifMatch) return json(428, { error: "X-Context-ETag (or If-Match) required" });
  const stored = await readDoc(`context-${side}`);
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

  const written = await writeDoc(`context-${side}`, prepared.doc, { onlyIfMatch: stored.etag });
  if (!written.modified) return json(412, { error: "Context changed" });
  if (!written.etag) throw new Error("Blobs returned no etag for the written context");

  // Only after the write landed: keep what it replaced, then trim this side's history.
  const prefix = historyPrefix(side);
  await writeDoc(`${prefix}${now.toISOString()}`, stored.doc);
  for (const key of historyToPrune(await listKeys(prefix))) await deleteDoc(key as DocKey);

  return respond(200, JSON.stringify(prepared.doc), { "Content-Type": "application/json", ETag: written.etag, "X-Context-ETag": written.etag });
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET" && req.method !== "PUT") return respond(405);
  const user = requireUser(req);
  if (!user) return json(401, { error: "Sign in required" });
  const url = new URL(req.url);
  const side = parseSide(url.searchParams.get("side"));
  if (!side) return json(400, { error: 'side must be "gabriel" or "gabriel-arina"' });
  return req.method === "GET" ? get(url, side) : put(req, user, side);
};

export const config: Config = { path: "/api/context" };
