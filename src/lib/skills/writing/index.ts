import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL, WRITING_EFFORT } from "@/lib/agent/client";
import { tool, type AgentTool } from "@/lib/agent/types";
import { WRITING_TOOLS } from "@/lib/agent/tools";
import { WRITING_SYSTEM } from "./prompt";

const MAX_ITERATIONS = 8;

/**
 * Runs the writing sub-skill to completion and returns its brief.
 *
 * This is a real second agent — its own system prompt, its own tool surface,
 * its own loop — rather than a function on Wren's side. That's the whole point
 * of the orchestration split: Wren decides *whether* the writing brain should
 * be involved and stays in character; this thing does the craft work and
 * reports back.
 *
 * Non-streaming on purpose: nothing here reaches the user directly, so there's
 * no one to stream to. The UI shows the handoff as a single in-flight step.
 */
export async function runWritingAssistant(input: {
  request: string;
  context?: string;
  state: string;
}): Promise<string> {
  const client = anthropic();
  const byName = new Map(WRITING_TOOLS.map((t) => [t.def.name, t]));

  const opening = [
    input.state,
    "",
    "<request from=\"Wren\">",
    input.request,
    "</request>",
    input.context ? `\n<context>\n${input.context}\n</context>` : "",
  ].join("\n");

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opening }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: WRITING_SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: WRITING_EFFORT },
      tools: WRITING_TOOLS.map((t) => t.def),
      messages,
    });

    if (message.stop_reason !== "tool_use") {
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return text || "(the writing sub-skill returned nothing usable)";
    }

    messages.push({ role: "assistant", content: message.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_use") continue;
      const impl = byName.get(block.name);
      try {
        const output = impl
          ? await impl.run(block.input as never)
          : { error: `Unknown tool ${block.name}` };
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: error instanceof Error ? error.message : String(error),
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  return "(the writing sub-skill hit its iteration limit without finishing — tell the user plainly and offer to narrow the ask)";
}

/**
 * Wren's handle on the sub-skill. `state` is bound in by the caller rather than
 * taken from the model, so the sub-agent always sees the real current state
 * instead of Wren's summary of it.
 */
export function delegateToWritingAssistant(state: string): AgentTool<{
  request: string;
  context?: string;
}> {
  return tool({
    def: {
      name: "delegate_to_writing_assistant",
      description:
        "Hand off to the writing sub-skill: drafting, outlining, structural or line feedback, breaking a writing goal into next actions, and 'where did I leave off' recall. Pass a full, self-contained request — it cannot see your conversation, only what you write here. Use it for the craft work; keep scheduling, capture, and ordinary conversation yourself.",
      input_schema: {
        type: "object",
        properties: {
          request: {
            type: "string",
            description:
              "What you need from it, stated completely. Name the project. Say what kind of help this is.",
          },
          context: {
            type: "string",
            description:
              "Anything from the conversation it needs — the user's own words, prose they pasted, constraints they mentioned.",
          },
        },
        required: ["request"],
      },
    },
    label: () => "Getting the writing side of my brain on this",
    run: async (input) => ({
      report: await runWritingAssistant({ ...input, state }),
    }),
  });
}
