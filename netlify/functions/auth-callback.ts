import { timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import {
  OAUTH_COOKIE, PAGE, clearOauthCookie, env, isAllowed, pageType, readCookie, respond, sessionCookie, signSession,
} from "../lib/auth.ts";

function redirect(location: string, cookies: string[]): Response {
  const res = respond(302, null, { Location: location });
  for (const c of cookies) res.headers.append("Set-Cookie", c);
  return res;
}

/** Payload of the id_token. It came straight from Google's token endpoint over
 *  TLS in this server-to-server call, so it is trusted without a JWKS check. */
function idTokenClaims(idToken: string): Record<string, unknown> {
  const payload = idToken.split(".")[1];
  if (!payload) throw new Error("Google returned a malformed id_token");
  const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (typeof claims !== "object" || claims === null) throw new Error("Google returned a malformed id_token");
  return claims as Record<string, unknown>;
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return respond(405);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const [cookieState, cookieType] = (readCookie(req, OAUTH_COOKIE) ?? "").split(".");

  const given = Buffer.from(state ?? "");
  const expected = Buffer.from(cookieState ?? "");
  if (!code || !expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return respond(400, "Bad sign-in state — start again from the page.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token endpoint answered ${tokenRes.status}`);
  const token: unknown = await tokenRes.json();
  const idToken = typeof token === "object" && token !== null ? (token as Record<string, unknown>).id_token : undefined;
  if (typeof idToken !== "string") throw new Error("Google token response has no id_token");

  const claims = idTokenClaims(idToken);
  const email = claims.email;
  const ok = claims.aud === env("GOOGLE_CLIENT_ID") && claims.email_verified === true
    && typeof email === "string" && isAllowed(email);
  if (!ok || typeof email !== "string") {
    return redirect(`${PAGE}?auth=denied`, [clearOauthCookie()]);
  }

  const type = pageType(cookieType ?? null);
  return redirect(type ? `${PAGE}?type=${type}` : PAGE, [sessionCookie(signSession(email.toLowerCase(), new Date())), clearOauthCookie()]);
};

export const config: Config = { path: "/api/auth/callback" };
