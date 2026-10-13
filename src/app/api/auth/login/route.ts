import { NextResponse } from "next/server";
import {
  authState,
  checkPassphrase,
  createSessionToken,
  MISCONFIGURED_MESSAGE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A wrong guess costs half a second, which is plenty against a bot and invisible to a human. */
const FAILURE_DELAY_MS = 500;

export async function POST(request: Request) {
  const state = authState();
  if (state === "misconfigured") {
    return Response.json({ error: MISCONFIGURED_MESSAGE }, { status: 503 });
  }
  // Open mode (dev, nothing configured): there is nothing to sign in to.
  if (state === "open") return Response.json({ ok: true });

  let passphrase: unknown;
  try {
    ({ passphrase } = await request.json());
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof passphrase !== "string" || !(await checkPassphrase(passphrase))) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return Response.json({ error: "Not that one." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return response;
}
