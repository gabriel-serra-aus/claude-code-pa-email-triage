import { randomBytes } from "node:crypto";
import type { Config } from "@netlify/functions";
import { allowedEmails, env, oauthCookie, pageType, respond } from "../lib/auth.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return respond(405);
  const url = new URL(req.url);
  const state = randomBytes(32).toString("hex");
  const type = pageType(url.searchParams.get("type"));

  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.search = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    response_type: "code",
    scope: "openid email",
    // From the request, so the same code serves the Netlify site and localhost:8888.
    redirect_uri: `${url.origin}/api/auth/callback`,
    state,
    login_hint: allowedEmails()[0] ?? "",
    prompt: "select_account",
  }).toString();

  return respond(302, null, {
    Location: authorize.toString(),
    "Set-Cookie": oauthCookie(type ? `${state}.${type}` : state),
  });
};

export const config: Config = { path: "/api/auth/login" };
