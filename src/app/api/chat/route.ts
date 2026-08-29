import { runWren } from "@/lib/agent/run";
import type { StreamEvent } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tool loops with a sub-agent handoff can run well past the default budget.
export const maxDuration = 300;

export async function POST(request: Request) {
  let message: unknown;
  try {
    ({ message } = await request.json());
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (typeof message !== "string" || message.trim().length === 0) {
    return Response.json({ error: "`message` must be a non-empty string." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const send = (event: StreamEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runWren(message.trim())) {
          controller.enqueue(send(event));
        }
      } catch (error) {
        controller.enqueue(
          send({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown failure.",
          }),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Stops nginx and friends buffering the stream into one lump.
      "x-accel-buffering": "no",
    },
  });
}
