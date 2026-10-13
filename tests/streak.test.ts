import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { logWords, writingStreak } from "@/lib/db/repo";
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
  await db.deleteFrom("writing_log").execute();
});
afterEach(() => {
  vi.useRealTimers();
});

const log = (logged_on: string, words: number) => logWords({ words, logged_on });

describe("writingStreak()", () => {
  it("is empty with no logs", async () => {
    const s = await writingStreak();
    expect(s).toMatchObject({ current: 0, longest: 0, lastLoggedOn: null, totalWords: 0 });
  });

  it("counts a streak ending today", async () => {
    await log("2026-03-10", 100);
    await log("2026-03-09", 200);
    const s = await writingStreak();
    expect(s.current).toBe(2);
    expect(s.wordsToday).toBe(100);
  });

  it("keeps the streak alive when the last log was yesterday", async () => {
    await log("2026-03-09", 100);
    await log("2026-03-08", 100);
    const s = await writingStreak();
    expect(s.current).toBe(2);
    expect(s.wordsToday).toBe(0);
  });

  it("breaks the streak after a gap of a full day", async () => {
    await log("2026-03-08", 100);
    await log("2026-03-07", 100);
    const s = await writingStreak();
    expect(s.current).toBe(0);
    expect(s.longest).toBe(2);
    expect(s.lastLoggedOn).toBe("2026-03-08");
  });

  it("works out the longest run separately from the current one", async () => {
    for (const d of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]) await log(d, 10);
    await log("2026-03-09", 10);
    await log("2026-03-10", 10);
    const s = await writingStreak();
    expect(s.current).toBe(2);
    expect(s.longest).toBe(4);
  });

  it("sums several logs on the same day into one streak day", async () => {
    await log("2026-03-10", 50);
    await log("2026-03-10", 70);
    const s = await writingStreak();
    expect(s.current).toBe(1);
    expect(s.wordsToday).toBe(120);
  });

  it("totals words and counts only the last 7 days in wordsLast7", async () => {
    await log("2026-03-10", 100); // today
    await log("2026-03-04", 200); // 6 days ago: inside the window
    await log("2026-03-03", 400); // 7 days ago: outside
    const s = await writingStreak();
    expect(s.wordsLast7).toBe(300);
    expect(s.totalWords).toBe(700);
  });
});
