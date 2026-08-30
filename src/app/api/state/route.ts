import { userName } from "@/lib/agent/run";
import {
  appendHistory,
  clearHistory,
  markCheckinsDelivered,
  pendingCheckins,
  recentHistory,
  writingStreak,
} from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `?deliver=1` also flushes any nudges the scheduler queued, turning them into
 * real assistant turns in the conversation.
 *
 * Delivering on a GET is a side effect, which is normally worth avoiding — but
 * the alternative is a second round trip on every app open, and "delivered"
 * genuinely means "the client fetched it". The client asks for it explicitly
 * so a background refresh can't silently consume a nudge the user never saw.
 */
export async function GET(request: Request) {
  try {
    return await readState(request);
  } catch (error) {
    // Surface the reason. The database guards in lib/db/client.ts produce
    // messages written to be read by whoever is deploying this; letting them
    // become an anonymous 500 wastes them on a server log nobody opens.
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load state." },
      { status: 500 },
    );
  }
}

async function readState(request: Request) {
  if (new URL(request.url).searchParams.get("deliver") === "1") {
    const waiting = await pendingCheckins();
    for (const checkin of waiting) {
      await appendHistory({
        role: "assistant",
        content: [{ type: "text", text: checkin.message }],
        text: checkin.message,
      });
    }
    await markCheckinsDelivered(waiting.map((c) => c.id));
  }

  const [rows, streak, name] = await Promise.all([
    recentHistory(60),
    writingStreak(),
    userName(),
  ]);

  // Tool-result turns carry no text; they're plumbing, not conversation.
  const spoken = rows.filter((row) => row.text.trim().length > 0);

  // One reply that paused to call a tool is stored as several assistant rows.
  // Stitch them back together so a reload looks like what the user watched
  // stream in, rather than fragmenting into a bubble per tool call.
  //
  // The parts of a single reply land seconds apart, so the gap is what
  // distinguishes them from a genuinely separate message — a check-in the
  // scheduler queued hours later is its own turn, not a continuation.
  const CONTINUATION_MS = 60_000;

  const messages: { id: string; role: string; text: string; created_at: string }[] = [];
  for (const row of spoken) {
    const previous = messages.at(-1);
    const continues =
      previous &&
      previous.role === "assistant" &&
      row.role === "assistant" &&
      Date.parse(row.created_at) - Date.parse(previous.created_at) < CONTINUATION_MS;

    if (continues) {
      previous.text += row.text;
      previous.created_at = row.created_at;
      continue;
    }
    messages.push({ id: row.id, role: row.role, text: row.text, created_at: row.created_at });
  }

  return Response.json({ name, streak, messages });
}

/** Wipe the conversation. Projects, tasks, and captures are untouched. */
export async function DELETE() {
  try {
    await clearHistory();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to clear history." },
      { status: 500 },
    );
  }
}
