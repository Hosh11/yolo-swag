import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * The user explicitly picked Sonnet 4.6 for this project. On 4.6, thinking is
 * configured with `{type: "adaptive"}` — `budget_tokens` is deprecated there —
 * and depth is steered with `output_config.effort` instead.
 */
export const MODEL = process.env.WREN_MODEL ?? "claude-sonnet-4-6";

export type Effort = "low" | "medium" | "high" | "max";

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "max"];

function effort(raw: string | undefined, fallback: Effort): Effort {
  return EFFORTS.includes(raw as Effort) ? (raw as Effort) : fallback;
}

/** Wren is conversational; she doesn't need to deliberate to say "logged". */
export const WREN_EFFORT = effort(process.env.WREN_EFFORT, "medium");

/** The writing sub-skill drafts and critiques prose, so it gets more room. */
export const WRITING_EFFORT = effort(process.env.WREN_WRITING_EFFORT, "high");
