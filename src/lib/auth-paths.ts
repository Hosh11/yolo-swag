/**
 * Which requests the proxy lets through without a session.
 *
 * Kept free of imports so it can be unit-tested as a plain function, and so
 * the proxy and the tests read the same rules.
 */

const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth",
  // A Vercel Cron request carries no cookie. These routes keep their own
  // Bearer-token check, so exempting them here doesn't leave them open.
  "/api/cron",
];

export type PathKind = "public" | "api" | "page";

export function classifyPath(pathname: string): PathKind {
  // Matches on whole path segments, so "/loginfoo" is not treated as "/login".
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return "public";
  }
  return pathname === "/api" || pathname.startsWith("/api/") ? "api" : "page";
}
