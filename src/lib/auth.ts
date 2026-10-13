import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Single-user auth: one passphrase, one signed cookie.
 *
 * There is exactly one person who should ever get in, so there is no user
 * table and no session store. A session is just an expiry time signed with a
 * server-side key; anything that verifies is genuine, and rotating
 * WREN_SESSION_SECRET signs everyone out at once.
 */

export const SESSION_COOKIE = "wren_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

/**
 * - `open`: dev with nothing configured, so a fresh checkout just works.
 * - `misconfigured`: something is missing where it matters. Everything
 *   protected refuses, rather than quietly running unprotected.
 * - `enforced`: both set, sessions required.
 */
export type AuthState = "open" | "misconfigured" | "enforced";

let warnedOpen = false;

export function authState(): AuthState {
  const passphrase = env("WREN_PASSPHRASE");
  const secret = env("WREN_SESSION_SECRET");

  if (passphrase && secret) return "enforced";

  // Both unset in development is the only open case. One set without the
  // other is almost certainly a typo, and failing there is kinder than
  // letting someone think they're protected.
  if (!passphrase && !secret && process.env.NODE_ENV !== "production") {
    if (!warnedOpen) {
      warnedOpen = true;
      console.warn(
        "[wren] WREN_PASSPHRASE and WREN_SESSION_SECRET are unset, so every route is open. " +
          "Fine for local development; set both before deploying.",
      );
    }
    return "open";
  }
  return "misconfigured";
}

/** Written for the person deploying, like the database guards. */
export const MISCONFIGURED_MESSAGE =
  "Sign-in isn't configured. Set WREN_PASSPHRASE (what you type) and " +
  "WREN_SESSION_SECRET (32+ random bytes, e.g. `openssl rand -base64 32`), then redeploy.";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

/**
 * Constant-time string comparison.
 *
 * timingSafeEqual throws on unequal lengths, and returning early on length
 * would leak it, so both sides are hashed to a fixed width first.
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all(
    [a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(s)))),
  );
  return timingSafeEqual(ha, hb);
}

export async function checkPassphrase(input: string): Promise<boolean> {
  const passphrase = env("WREN_PASSPHRASE");
  if (!passphrase) return false;
  return safeEqual(input, passphrase);
}

/** `<expiryEpochMs>.<base64url HMAC-SHA256 of the expiry>` */
export async function createSessionToken(now = Date.now()): Promise<string> {
  const secret = env("WREN_SESSION_SECRET");
  if (!secret) throw new Error(MISCONFIGURED_MESSAGE);
  const expiry = String(now + SESSION_MAX_AGE_S * 1000);
  return `${expiry}.${await sign(expiry, secret)}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  now = Date.now(),
): Promise<boolean> {
  const secret = env("WREN_SESSION_SECRET");
  if (!token || !secret) return false;

  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const expiry = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry)) return false;

  // Signature first, so a forged expiry is rejected for the right reason.
  if (!(await safeEqual(signature, await sign(expiry, secret)))) return false;
  return Number(expiry) > now;
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Whether a request carries a valid session cookie. */
export async function hasValidSession(cookieHeader: string | null): Promise<boolean> {
  return verifySessionToken(readCookie(cookieHeader, SESSION_COOKIE));
}

/**
 * Guard for route handlers: `null` means carry on, otherwise return the
 * response. The proxy already screens these paths, but the Next docs warn that
 * proxy coverage can silently drop (a changed matcher, say), so every protected
 * handler checks for itself too.
 */
export async function requireSession(request: Request): Promise<Response | null> {
  const state = authState();
  if (state === "open") return null;
  if (state === "misconfigured") {
    return Response.json({ error: MISCONFIGURED_MESSAGE }, { status: 503 });
  }
  if (await hasValidSession(request.headers.get("cookie"))) return null;
  return Response.json({ error: "Not signed in." }, { status: 401 });
}
