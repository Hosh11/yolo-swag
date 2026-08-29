import { today } from "@/lib/db/client";
import {
  listCaptures,
  listProjects,
  listTasks,
  pendingCheckins,
  writingStreak,
} from "@/lib/db/repo";

const DAY_MS = 86_400_000;

function daysBetween(isoA: string, isoB: string): number {
  return Math.round((Date.parse(isoA) - Date.parse(isoB)) / DAY_MS);
}

export interface Snapshot {
  text: string;
  pendingCheckinIds: string[];
}

/**
 * The "what's in motion" briefing handed to Wren on every turn.
 *
 * This rides on the current user message rather than in the system prompt, so
 * the persona + tool definitions stay a stable, cacheable prefix. It's plain
 * prose rather than JSON because the model reasons about "stalled for 9 days"
 * better than about `{"last_activity_at": "..."}`.
 */
export async function buildSnapshot(userName: string): Promise<Snapshot> {
  const [projects, tasks, captures, streak, checkins] = await Promise.all([
    listProjects("active"),
    listTasks({ status: "open", limit: 12 }),
    listCaptures({ unprocessedOnly: true, limit: 8 }),
    writingStreak(),
    pendingCheckins(),
  ]);

  const now = new Date().toISOString();
  const t = today();
  const lines: string[] = [];

  lines.push("<current_state>");
  lines.push(`User: ${userName}`);
  lines.push(`Today: ${t} (${new Date().toLocaleDateString("en-GB", { weekday: "long" })})`);
  lines.push("");

  lines.push("Active projects:");
  if (projects.length === 0) {
    lines.push("  (none yet)");
  } else {
    for (const p of projects) {
      const bits: string[] = [`  - ${p.name} [id:${p.id}]`];
      if (p.deadline) {
        const left = daysBetween(`${p.deadline}T00:00:00.000Z`, `${t}T00:00:00.000Z`);
        bits.push(
          left < 0
            ? `deadline ${p.deadline} (${Math.abs(left)}d OVERDUE)`
            : `deadline ${p.deadline} (${left}d left)`,
        );
      }
      if (p.word_goal) bits.push(`goal ${p.word_goal} words`);
      if (p.last_activity_at) {
        const idle = daysBetween(now, p.last_activity_at);
        bits.push(idle >= 1 ? `last touched ${idle}d ago` : "touched today");
      }
      lines.push(bits.join(" · "));
      if (p.description) lines.push(`      ${p.description}`);
    }
  }
  lines.push("");

  lines.push(`Open tasks (${tasks.length}):`);
  if (tasks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const task of tasks) {
      const flags = [
        `p${task.priority}`,
        task.due_date ? `due ${task.due_date}` : null,
        task.status === "doing" ? "in progress" : null,
      ].filter(Boolean);
      lines.push(`  - ${task.title} [id:${task.id}] (${flags.join(", ")})`);
    }
  }
  lines.push("");

  lines.push(`Unprocessed capture inbox (${captures.length}):`);
  if (captures.length === 0) {
    lines.push("  (empty)");
  } else {
    for (const c of captures) {
      lines.push(`  - [${c.kind}] ${c.content} [id:${c.id}]`);
    }
  }
  lines.push("");

  lines.push(
    `Writing: ${streak.wordsToday} words today · ${streak.wordsLast7} in the last 7 days · ` +
      `streak ${streak.current} day(s) (longest ${streak.longest}) · ` +
      `last logged ${streak.lastLoggedOn ?? "never"} · ${streak.totalWords} words all-time`,
  );

  if (checkins.length > 0) {
    lines.push("");
    lines.push("Queued nudges you wanted to raise (undelivered):");
    for (const c of checkins) lines.push(`  - ${c.message}${c.reason ? ` (because: ${c.reason})` : ""}`);
    lines.push(
      "Weave any that still matter into your reply naturally. Drop the ones that have gone stale.",
    );
  }

  lines.push("</current_state>");

  return { text: lines.join("\n"), pendingCheckinIds: checkins.map((c) => c.id) };
}
