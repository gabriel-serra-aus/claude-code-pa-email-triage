// Sign-in cookie (HMAC-signed, no server-side session), env access and the
// small HTTP helpers every function shares. Hand-written on node:crypto.
import { createHmac, timingSafeEqual } from "node:crypto";

/** A missing variable throws at first use with its name — no defaults, no silent fallback. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

/** Lower-cased. Re-read on every request, so removing an address revokes it. */
export function allowedEmails(): string[] {
  return env("ALLOWED_EMAILS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAllowed(email: string): boolean {
  return allowedEmails().includes(email.toLowerCase());
}

export const SESSION_COOKIE = "__Host-tr_session";
export const OAUTH_COOKIE = "tr_oauth";
const SESSION_MAX_AGE = 2592000; // 30 d
const OAUTH_MAX_AGE = 600;

function hmac(payload: string): Buffer {
  return createHmac("sha256", env("SESSION_SECRET")).update(payload).digest();
}

/** `base64url(JSON {email, exp})` + "." + `base64url(HMAC-SHA256(payload))`. */
export function signSession(email: string, now: Date): string {
  const exp = Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE;
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString("base64url");
  return `${payload}.${hmac(payload).toString("base64url")}`;
}

/** The signed-in email, or null for anything forged, expired or no longer allowed. */
export function verifySession(value: string, now: Date): string | null {
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !signature || rest.length) return null;
  const given = Buffer.from(signature, "base64url");
  const expected = hmac(payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  // The signature matched, so this payload is one signSession wrote.
  const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (typeof claims !== "object" || claims === null) return null;
  const { email, exp } = claims as { email?: unknown; exp?: unknown };
  if (typeof email !== "string" || typeof exp !== "number") return null;
  if (exp * 1000 <= now.getTime()) return null;
  return isAllowed(email) ? email : null;
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The signed-in email, or null → the caller answers 401. */
export function requireUser(req: Request): string | null {
  const value = readCookie(req, SESSION_COOKIE);
  return value ? verifySession(value, new Date()) : null;
}

/** CSRF: a state-changing request must come from the site's own pages. */
export function sameOrigin(req: Request): boolean {
  return req.headers.get("origin") === new URL(req.url).origin;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
export function oauthCookie(value: string): string {
  return `${OAUTH_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${OAUTH_MAX_AGE}`;
}
export function clearOauthCookie(): string {
  return `${OAUTH_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=0`;
}

/** `?type=` survives the sign-in round trip only as one of these — never a free-form return target. */
export function pageType(value: string | null): "gabriel" | "gna" | null {
  return value === "gabriel" || value === "gna" ? value : null;
}

export const PAGE = "/triage-review.html";

/** Every API response is `no-store`. */
export function respond(status: number, body: string | null = null, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return respond(status, JSON.stringify(body), { "Content-Type": "application/json", ...headers });
}
