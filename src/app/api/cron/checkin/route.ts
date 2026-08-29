import { runCheckinPass } from "@/lib/agent/checkin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The scheduled proactive pass. Vercel Cron calls this with
 * `Authorization: Bearer $CRON_SECRET`; see vercel.json for the schedule.
 *
 * Firing it more often than needed is safe — the guardrails in runCheckinPass
 * short-circuit before any model call, so an over-eager schedule costs nothing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    if (request.headers.get("authorization") !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Failing closed matters here: without it, an unset secret in production
    // leaves an endpoint that burns tokens for anyone who finds the URL.
    return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  }

  // `?force=1` skips the rate guards, for testing the pass on demand.
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    return Response.json(await runCheckinPass({ force }));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Check-in pass failed." },
      { status: 500 },
    );
  }
}
