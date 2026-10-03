import type { Config } from "@netlify/functions";
import { json, requireUser, respond } from "../lib/auth.ts";
import { parseSide } from "../lib/contract.ts";
import { readDoc } from "../lib/store.ts";

// GET /api/summary?side=… → the side's run summary { side, generatedAt, publishedAt, markdown } | 404.
// Read-only: only session_publish writes it.
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return respond(405);
  if (!requireUser(req)) return json(401, { error: "Sign in required" });
  const side = parseSide(new URL(req.url).searchParams.get("side"));
  if (!side) return json(400, { error: 'side must be "gabriel" or "gabriel-arina"' });
  const stored = await readDoc(`summary-${side}`);
  return stored ? json(200, stored.doc) : json(404, { error: "No summary yet" });
};

export const config: Config = { path: "/api/summary" };
