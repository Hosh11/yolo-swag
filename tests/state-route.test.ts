import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/state/route";
import { getDb, newId } from "@/lib/db/client";
import { useTempDb } from "./helpers";

let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ cleanup } = await useTempDb());
});
afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  const db = await getDb();
  await db.deleteFrom("conversation_history").execute();
});

async function seed(role: "user" | "assistant", text: string, at: string) {
  const db = await getDb();
  await db
    .insertInto("conversation_history")
    .values({ id: newId(), role, content: JSON.stringify([{ type: "text", text }]), text, created_at: at })
    .execute();
}

async function messages() {
  const res = await GET(new Request("http://localhost/api/state"));
  expect(res.status).toBe(200);
  return ((await res.json()) as { messages: { role: string; text: string }[] }).messages;
}

describe("GET /api/state stitching", () => {
  it("merges assistant rows that land under 60s apart", async () => {
    await seed("user", "hi", "2026-03-10T10:00:00.000Z");
    await seed("assistant", "One sec. ", "2026-03-10T10:00:05.000Z");
    await seed("assistant", "Done.", "2026-03-10T10:00:30.000Z");
    const out = await messages();
    expect(out).toHaveLength(2);
    expect(out[1].text).toBe("One sec. Done.");
  });

  it("keeps assistant rows more than 60s apart as separate turns", async () => {
    await seed("assistant", "Morning.", "2026-03-10T10:00:00.000Z");
    await seed("assistant", "A nudge.", "2026-03-10T10:02:00.000Z");
    const out = await messages();
    expect(out.map((m) => m.text)).toEqual(["Morning.", "A nudge."]);
  });

  it("never merges a user row into an assistant row", async () => {
    await seed("assistant", "Hello.", "2026-03-10T10:00:00.000Z");
    await seed("user", "Hi.", "2026-03-10T10:00:10.000Z");
    expect((await messages()).map((m) => m.role)).toEqual(["assistant", "user"]);
  });

  it("drops rows with no text, such as tool results", async () => {
    await seed("user", "go", "2026-03-10T10:00:00.000Z");
    await seed("user", "  ", "2026-03-10T10:00:02.000Z");
    expect(await messages()).toHaveLength(1);
  });
});
