import { userName } from "@/lib/agent/run";
import { clearHistory, recentHistory, writingStreak } from "@/lib/db/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
  const messages: { id: string; role: string; text: string; created_at: string }[] = [];
  for (const row of spoken) {
    const previous = messages.at(-1);
    if (previous && previous.role === "assistant" && row.role === "assistant") {
      previous.text += row.text;
      continue;
    }
    messages.push({ id: row.id, role: row.role, text: row.text, created_at: row.created_at });
  }

  return Response.json({ name, streak, messages });
}

/** Wipe the conversation. Projects, tasks, and captures are untouched. */
export async function DELETE() {
  await clearHistory();
  return Response.json({ ok: true });
}
