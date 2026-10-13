import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@/lib/agent/types";
import { useTempDb } from "./helpers";

const stream = vi.fn();
vi.mock("@/lib/agent/client", () => ({
  anthropic: () => ({ messages: { stream } }),
  MODEL: "test-model",
  WREN_EFFORT: "low",
  WRITING_EFFORT: "low",
}));

import { runWren } from "@/lib/agent/run";

let cleanup: () => Promise<void>;
beforeAll(async () => {
  ({ cleanup } = await useTempDb());
});
afterAll(async () => {
  await cleanup();
});

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

describe("runWren() abort handling", () => {
  it("hands the signal to the SDK stream", async () => {
    const controller = new AbortController();
    stream.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hi." } };
      },
      finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "Hi." }] }),
    }));

    await collect(runWren("hello", { signal: controller.signal }));
    expect(stream.mock.calls.at(-1)?.[1]).toEqual({ signal: controller.signal });
  });

  it("ends quietly, with no error event, when the stream dies from an abort", async () => {
    const controller = new AbortController();
    stream.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() {
        controller.abort();
        throw new Error("Request was aborted.");
      },
      finalMessage: async () => {
        throw new Error("Request was aborted.");
      },
    }));

    const events = await collect(runWren("hello", { signal: controller.signal }));
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("still reports a genuine upstream failure", async () => {
    stream.mockImplementationOnce(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error("overloaded");
      },
      finalMessage: async () => {
        throw new Error("overloaded");
      },
    }));

    const events = await collect(runWren("hello", { signal: new AbortController().signal }));
    expect(events).toEqual([{ type: "error", message: "overloaded" }]);
  });
});
