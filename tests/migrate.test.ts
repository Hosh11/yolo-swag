import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { drop, migrate } from "@/lib/db/migrate";
import { up as baselineUp } from "@/lib/db/migrations/0001_baseline";
import { useTempDb } from "./helpers";

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function applied(): Promise<string[]> {
  const db = await getDb();
  const { rows } = await sql<{ name: string }>`SELECT name FROM kysely_migration ORDER BY name`.execute(db);
  return rows.map((r) => r.name);
}

describe("versioned migrations", () => {
  it("migrates a fresh database and records the baseline", async () => {
    ({ cleanup } = await useTempDb());
    const db = await getDb(); // auto-migrates on first connection

    await db.insertInto("settings").values({ key: "k", value: "v", updated_at: "now" }).execute();
    expect(await applied()).toEqual(["0001_baseline"]);
  });

  it("keeps the rows of a database built by the old run-everything code", async () => {
    // The old code ran the baseline's statements with no migration table.
    // Build exactly that, seed it, and only then let the Migrator see it.
    const temp = await useTempDb();
    cleanup = temp.cleanup;
    const { Kysely, SqliteDialect } = await import("kysely");
    const { createRequire } = await import("node:module");
    const Sqlite = createRequire(import.meta.url)("better-sqlite3");
    const legacy = new Kysely<never>({ dialect: new SqliteDialect({ database: new Sqlite(temp.file) }) });
    await baselineUp(legacy);
    await sql`INSERT INTO projects (id, name, status, created_at, updated_at)
              VALUES ('p1', 'The Salt Line', 'active', 'now', 'now')`.execute(legacy);
    await sql`SELECT name FROM sqlite_master WHERE name = 'kysely_migration'`
      .execute(legacy)
      .then(({ rows }) => expect(rows).toHaveLength(0));
    await legacy.destroy();

    const db = await getDb();
    const project = await db.selectFrom("projects").selectAll().executeTakeFirst();
    expect(project?.name).toBe("The Salt Line");
    expect(await applied()).toEqual(["0001_baseline"]);
  });

  it("is idempotent: migrating again changes nothing", async () => {
    ({ cleanup } = await useTempDb());
    const db = await getDb();
    await migrate(db);
    await migrate(db);
    expect(await applied()).toEqual(["0001_baseline"]);
  });

  it("drop() removes Kysely's bookkeeping too, so a reset rebuilds cleanly", async () => {
    ({ cleanup } = await useTempDb());
    const db = await getDb();
    await db.insertInto("settings").values({ key: "k", value: "v", updated_at: "now" }).execute();

    await drop(db);
    const { rows } = await sql<{ name: string }>`SELECT name FROM sqlite_master
      WHERE name IN ('kysely_migration', 'kysely_migration_lock', 'settings')`.execute(db);
    expect(rows).toHaveLength(0);

    await migrate(db);
    expect(await applied()).toEqual(["0001_baseline"]);
    expect(await db.selectFrom("settings").selectAll().execute()).toHaveLength(0);
  });
});
