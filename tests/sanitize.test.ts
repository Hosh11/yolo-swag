import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { sanitize } from "@/lib/agent/run";

type Msg = Anthropic.MessageParam;

const user = (text: string): Msg => ({ role: "user", content: text });
const assistant = (text: string): Msg => ({ role: "assistant", content: [{ type: "text", text }] });
const toolUse: Msg = {
  role: "assistant",
  content: [{ type: "tool_use", id: "t1", name: "list_tasks", input: {} }],
};
const toolResult: Msg = {
  role: "user",
  content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" }],
};

describe("sanitize()", () => {
  it("leaves a clean history untouched", () => {
    const history = [user("hi"), assistant("hello"), user("tasks?")];
    expect(sanitize(history)).toEqual(history);
  });

  it("drops a leading tool_result turn, whose tool_use was cut off by the window", () => {
    const out = sanitize([toolResult, assistant("done"), user("next")]);
    expect(out).toEqual([user("next")]);
  });

  it("drops a leading assistant turn", () => {
    expect(sanitize([assistant("orphan"), user("hi")])).toEqual([user("hi")]);
  });

  it("drops a trailing assistant tool_use that was never answered", () => {
    const out = sanitize([user("hi"), assistant("one sec"), user("go"), toolUse]);
    expect(out).toEqual([user("hi"), assistant("one sec"), user("go")]);
  });

  it("keeps a tool_use that has its result", () => {
    const history = [user("go"), toolUse, toolResult, assistant("done")];
    expect(sanitize(history)).toEqual(history);
  });

  it("returns an empty list for an empty input", () => {
    expect(sanitize([])).toEqual([]);
  });
});
