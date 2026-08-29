import type Anthropic from "@anthropic-ai/sdk";

/** A tool definition bound to the code that runs it. */
export interface AgentTool<I = any> {
  def: Anthropic.Tool;
  run(input: I): Promise<unknown>;
  /** Short present-tense phrase for the UI while the call is in flight. */
  label(input: I): string;
}

export function tool<I>(t: AgentTool<I>): AgentTool<I> {
  return t;
}

/** Wire format for the SSE stream from /api/chat. */
export type StreamEvent =
  | { type: "thinking"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; label: string }
  | { type: "tool_end"; id: string; ok: boolean }
  | { type: "done"; text: string }
  | { type: "error"; message: string };
