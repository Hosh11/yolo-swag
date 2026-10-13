import { NextResponse, type NextRequest } from "next/server";
import { authState, hasValidSession, MISCONFIGURED_MESSAGE } from "@/lib/auth";
import { classifyPath } from "@/lib/auth-paths";

/**
 * Sends anyone without a session to the login page (or a 401 for API calls).
 * `runtime` is deliberately not set: proxy always runs on Node in Next 16 and
 * declaring one throws.
 */
export async function proxy(request: NextRequest) {
  const kind = classifyPath(request.nextUrl.pathname);
  if (kind === "public") return NextResponse.next();

  const state = authState();
  if (state === "open") return NextResponse.next();

  if (state === "misconfigured") {
    return kind === "api"
      ? Response.json({ error: MISCONFIGURED_MESSAGE }, { status: 503 })
      : new Response(MISCONFIGURED_MESSAGE, { status: 503 });
  }

  if (await hasValidSession(request.headers.get("cookie"))) return NextResponse.next();

  return kind === "api"
    ? Response.json({ error: "Not signed in." }, { status: 401 })
    : NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Static assets must stay out, or the login page renders unstyled.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
