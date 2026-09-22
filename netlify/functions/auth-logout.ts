import type { Config } from "@netlify/functions";
import { clearSessionCookie, respond, sameOrigin } from "../lib/auth.ts";

// Signing out an already-expired sign-in still succeeds: the cookie is cleared either way.
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return respond(405);
  if (!sameOrigin(req)) return respond(403);
  return respond(204, null, { "Set-Cookie": clearSessionCookie() });
};

export const config: Config = { path: "/api/auth/logout" };
