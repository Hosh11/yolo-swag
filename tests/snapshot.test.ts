import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSnapshot } from "@/lib/agent/state";
import { getDb } from "@/lib/db/client";
import { capture, createProject, createTask } from "@/lib/db/repo";
import { useTempDb } from "./helpers";

let cleanup: () => Promise<void>;

beforeAll(async () => {
  process.env.WREN_TIMEZONE = "UTC";
  ({ cleanup } = await useTempDb());
});
afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  const db = await getDb();
  for (const table of ["writing_log", "capture_items", "tasks", "projects", "checkins"] as const) {
    await db.deleteFrom(table).execute();
  }
});
afterEach(() => {
  vi.useRealTimers();
});

describe("buildSnapshot()", () => {
  it("says so plainly when there is nothing in motion", async () => {
    const { text, pendingCheckinIds } = await buildSnapshot("Josh");
    expect(text).toContain("User: Josh");
    expect(text).toContain("(none yet)");
    expect(text).toContain("Open tasks (0):");
    expect(text).toContain("(empty)");
    expect(text).toContain("last logged never");
    expect(pendingCheckinIds).toEqual([]);
  });

  it("wraps everything in a current_state block", async () => {
    const { text } = await buildSnapshot("Josh");
    expect(text.startsWith("<current_state>")).toBe(true);
    expect(text.endsWith("</current_state>")).toBe(true);
  });

  it("words a future deadline as days left", async () => {
    await createProject({ name: "Novel", deadline: "2026-03-15" });
    const { text } = await buildSnapshot("Josh");
    expect(text).toContain("deadline 2026-03-15 (5d left)");
    expect(text).not.toContain("OVERDUE");
  });

  it("words a past deadline as overdue", async () => {
    await createProject({ name: "Essay", deadline: "2026-03-07" });
    const { text } = await buildSnapshot("Josh");
    expect(text).toContain("deadline 2026-03-07 (3d OVERDUE)");
  });

  it("treats a deadline of today as zero days left, not overdue", async () => {
    await createProject({ name: "Story", deadline: "2026-03-10" });
    const { text } = await buildSnapshot("Josh");
    expect(text).toContain("(0d left)");
  });

  it("lists open tasks and unprocessed captures", async () => {
    await createTask({ title: "Draft chapter one" });
    await capture({ content: "a ghost in the lighthouse" });
    const { text } = await buildSnapshot("Josh");
    expect(text).toContain("Open tasks (1):");
    expect(text).toContain("Draft chapter one");
    expect(text).toContain("Unprocessed capture inbox (1):");
    expect(text).toContain("a ghost in the lighthouse");
  });

  it("falls back to 'last touched' wording from activity timestamps", async () => {
    const p = await createProject({ name: "Old thing" });
    const db = await getDb();
    await db
      .updateTable("projects")
      .set({ last_activity_at: "2026-03-01T12:00:00.000Z" })
      .where("id", "=", p.id)
      .execute();
    const { text } = await buildSnapshot("Josh");
    expect(text).toContain("last touched 9d ago");
  });
});

describe("buildSnapshot() weekday", () => {
  // 23:30 UTC on a Tuesday is already Wednesday in Auckland.
  const lateTuesdayUtc = "2026-03-10T23:30:00Z";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the weekday in WREN_TIMEZONE, not the server's zone", async () => {
    vi.setSystemTime(new Date(lateTuesdayUtc));
    vi.stubEnv("WREN_TIMEZONE", "Pacific/Auckland");
    const { text } = await buildSnapshot("Josh");
    expect(text).toContain("Today: 2026-03-11 (Wednesday)");
  });

  it("agrees with the date it prints next to it", async () => {
    vi.setSystemTime(new Date(lateTuesdayUtc));
    vi.stubEnv("WREN_TIMEZONE", "UTC");
    const { text } = await buildSnapshot("Josh");
    expect(text).toContain("Today: 2026-03-10 (Tuesday)");
  });
});
