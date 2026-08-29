import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL, WREN_EFFORT } from "./client";
import { WREN_SYSTEM } from "./wren";
import { buildSnapshot } from "./state";
import { userName } from "./run";
import { queueCheckinTool } from "./tools";
import { getDb } from "@/lib/db/client";
import { pendingCheckins, recentHistory } from "@/lib/db/repo";

/**
 * Don't nudge someone who is mid-conversation with you — they're already here.
 */
const QUIET_AFTER_ACTIVITY_HOURS = 3;

/** Roughly daily at most, regardless of how often the cron fires. */
const MIN_HOURS_BETWEEN_CHECKINS = 20;

const HOUR_MS = 3_600_000;

const CRON_ADDENDUM = `You are not in a conversation right now. A scheduled job has woken you to ask one question: is there anything worth putting in front of the user next time they open the app?

Usually the answer is no. Silence is the default and it is not a failure — an assistant who produces a nudge every single day is one that gets muted within a fortnight. Only speak when there is a specific, concrete reason: a deadline that has become real, a project that has genuinely stalled, a streak worth naming, an inbox item that has been sitting long enough to rot.

Do NOT surface something you have already said recently — the last few things you said are included below. Repeating yourself is the fastest way to become wallpaper.

If there is something worth saying, call \`queue_checkin\` exactly once with the message written in your own voice, as you'd actually say it — short, warm, no guilt, and with a way in rather than just an observation. One thing, not a list.

If there is nothing, call no tools and reply with the single word PASS.`;

export interface CheckinResult {
  queued: boolean;
  reason: string;
  message?: string;
}

/**
 * The proactive pass. Guardrails run before the model does, so a too-frequent
 * cron costs nothing rather than producing a too-frequent nudge.
 */
export async function runCheckinPass(
  options: { force?: boolean } = {},
): Promise<CheckinResult> {
  const db = await getDb();

  if (!options.force) {
    const undelivered = await pendingCheckins();
    if (undelivered.length > 0) {
      return { queued: false, reason: "a nudge is already waiting to be delivered" };
    }

    const lastCheckin = await db
      .selectFrom("checkins")
      .select("created_at")
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (
      lastCheckin &&
      Date.now() - Date.parse(lastCheckin.created_at) < MIN_HOURS_BETWEEN_CHECKINS * HOUR_MS
    ) {
      return { queued: false, reason: "nudged too recently" };
    }

    const lastTurn = await db
      .selectFrom("conversation_history")
      .select("created_at")
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    if (
      lastTurn &&
      Date.now() - Date.parse(lastTurn.created_at) < QUIET_AFTER_ACTIVITY_HOURS * HOUR_MS
    ) {
      return { queued: false, reason: "user was active recently" };
    }
  }

  const name = await userName();
  const snapshot = await buildSnapshot(name);

  const recent = await recentHistory(8);
  const said = recent
    .filter((row) => row.role === "assistant" && row.text.trim())
    .map((row) => `- ${row.text.trim().slice(0, 240)}`)
    .join("\n");

  const client = anthropic();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: [
      { type: "text", text: WREN_SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: CRON_ADDENDUM },
    ],
    thinking: { type: "adaptive" },
    output_config: { effort: WREN_EFFORT },
    tools: [queueCheckinTool.def],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: snapshot.text },
          {
            type: "text",
            text: said
              ? `<recently_said>\n${said}\n</recently_said>\n\nAnything worth surfacing right now?`
              : "Anything worth surfacing right now?",
          },
        ],
      },
    ],
  });

  const call = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === "queue_checkin",
  );

  if (!call) {
    return { queued: false, reason: "nothing worth saying" };
  }

  const input = call.input as { message: string; reason?: string };
  await queueCheckinTool.run(input);
  return { queued: true, reason: input.reason ?? "unstated", message: input.message };
}
