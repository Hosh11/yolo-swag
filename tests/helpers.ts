import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { __resetDbForTests } from "@/lib/db/client";

/**
 * Points the app at a fresh SQLite file for one suite. getDb() memoises per
 * process, so the old handle is dropped first; the file lives in the OS temp
 * dir so a crashed run leaves nothing in the repo.
 */
export async function useTempDb(): Promise<{ file: string; cleanup: () => Promise<void> }> {
  await __resetDbForTests();
  const dir = mkdtempSync(path.join(tmpdir(), "wren-test-"));
  const file = path.join(dir, "test.sqlite");
  process.env.DATABASE_URL = `sqlite:${file}`;
  return {
    file,
    cleanup: async () => {
      await __resetDbForTests();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
