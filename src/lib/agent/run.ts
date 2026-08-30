import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL, WREN_EFFORT } from "./client";
import { WREN_SYSTEM } from "./wren";
import { wrenTools } from "./registry";
import { buildSnapshot } from "./state";
import type { StreamEvent } from "./types";
import { env } from "@/lib/env";
import {
  appendHistory,
  getSetting,
  markCheckinsDelivered,
  recentHistory,
} from "@/lib/db/repo";

const MAX_ITERATIONS = 10;
const HISTORY_TURNS = 40;

export async function userName(): Promise<string> {
  return (
    (await getSetting("user_name")) ??
    env("WREN_USER_NAME") ??
    "you"
  );
}

/**
 * Trim a raw history slice into something the API will accept.
 *
 * Two hazards: the window can cut through a tool_use/tool_result pair, and a
 * request that died mid-loop can leave an assistant turn whose tool calls were
 * never answered. Both are 400s. Drop from the front until we're at a genuine
 * user turn, and from the back until we're at a settled one.
 */
export function sanitize(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const isToolResultTurn = (m: Anthropic.MessageParam) =>
    Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result");
  const hasToolUse = (m: Anthropic.MessageParam) =>
    Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use");

  let start = 0;
  while (
    start < messages.length &&
    (messages[start].role !== "user" || isToolResultTurn(messages[start]))
  ) {
    start += 1;
  }

  let end = messages.length;
  while (end > start && messages[end - 1].role === "assistant" && hasToolUse(messages[end - 1])) {
    end -= 1;
  }

  return messages.slice(start, end);
}

async function loadHistory(): Promise<Anthropic.MessageParam[]> {
  const rows = await recentHistory(HISTORY_TURNS);
  const parsed = rows.map((row) => ({
    role: row.role,
    content: JSON.parse(row.content),
  })) as Anthropic.MessageParam[];
  return sanitize(parsed);
}

/**
 * Streaming manual tool loop.
 *
 * A manual loop rather than the SDK tool runner because the UI needs per-call
 * events — "Getting the writing side of my brain on this" has to appear while
 * the sub-agent runs, and the runner doesn't surface tool boundaries.
 */
export async function* runWren(userText: string): AsyncGenerator<StreamEvent> {
  const client = anthropic();
  const name = await userName();
  const snapshot = await buildSnapshot(name);
  const tools = wrenTools(snapshot.text);
  const byName = new Map(tools.map((t) => [t.def.name, t]));

  const history = await loadHistory();

  // Cache the conversation prefix as well as tools+persona. The last history
  // turn is stable until the next exchange lands, so the breakpoint holds.
  const last = history.at(-1);
  if (last && Array.isArray(last.content) && last.content.length > 0) {
    const block = last.content.at(-1);
    if (block && typeof block === "object" && "type" in block) {
      (block as { cache_control?: unknown }).cache_control = { type: "ephemeral" };
    }
  }

  // The snapshot rides on this turn only — it is never persisted, so replayed
  // history doesn't accumulate stale copies of the world.
  const messages: Anthropic.MessageParam[] = [
    ...history,
    {
      role: "user",
      content: [
        { type: "text", text: snapshot.text },
        { type: "text", text: userText },
      ],
    },
  ];

  await appendHistory({
    role: "user",
    content: [{ type: "text", text: userText }],
    text: userText,
  });

  let spoken = "";
  let closing: Anthropic.Message | null = null;

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 32000,
        system: [
          {
            type: "text",
            text: WREN_SYSTEM,
            cache_control: { type: "ephemeral" },
          },
        ],
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: WREN_EFFORT },
        tools: tools.map((t) => t.def),
        messages,
      });

      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "text_delta") {
          spoken += event.delta.text;
          yield { type: "text", delta: event.delta.text };
        } else if (event.delta.type === "thinking_delta") {
          yield { type: "thinking", delta: event.delta.thinking };
        }
      }

      const message = await stream.finalMessage();

      if (message.stop_reason !== "tool_use") {
        closing = message;
        break;
      }

      messages.push({ role: "assistant", content: message.content });
      await appendHistory({
        role: "assistant",
        content: message.content,
        text: textOf(message),
      });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        const impl = byName.get(block.name);
        const input = block.input as never;

        yield {
          type: "tool_start",
          id: block.id,
          name: block.name,
          label: impl ? impl.label(input) : `Running ${block.name}`,
        };

        if (!impl) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: `Unknown tool ${block.name}.`,
          });
          yield { type: "tool_end", id: block.id, ok: false };
          continue;
        }

        try {
          const output = await impl.run(input);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(output),
          });
          yield { type: "tool_end", id: block.id, ok: true };
        } catch (error) {
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            is_error: true,
            content: error instanceof Error ? error.message : String(error),
          });
          yield { type: "tool_end", id: block.id, ok: false };
        }
      }

      messages.push({ role: "user", content: results });
      await appendHistory({ role: "user", content: results, text: "" });
    }

    if (closing) {
      await appendHistory({
        role: "assistant",
        content: closing.content,
        text: textOf(closing),
      });
    }

    await markCheckinsDelivered(snapshot.pendingCheckinIds);
    yield { type: "done", text: spoken };
  } catch (error) {
    yield {
      type: "error",
      message: error instanceof Error ? error.message : "Something went wrong upstream.",
    };
  }
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
