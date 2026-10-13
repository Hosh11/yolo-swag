import { sql, type Kysely } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import type { Database } from "./schema";
import * as baseline from "./migrations/0001_baseline";

/**
 * Migrations are listed inline rather than read from a folder.
 *
 * Kysely's FileMigrationProvider scans the filesystem at runtime, which finds
 * nothing once Vercel has bundled the app. Importing each migration puts it in
 * the bundle. Add new ones here, in order, with a zero-padded numeric prefix:
 * Kysely applies them alphabetically and refuses to run if history disagrees.
 */
const provider: MigrationProvider = {
  getMigrations: async (): Promise<Record<string, Migration>> => ({
    "0001_baseline": baseline,
  }),
};

/**
 * Applies anything not yet recorded in `kysely_migration`.
 *
 * Kysely takes a lock around the run, so two serverless cold starts racing on
 * the first request after a deploy take turns instead of colliding. The
 * baseline also tolerates "already exists" errors itself, as a belt for the
 * case where a lock table is created by both at once.
 */
export async function migrate(db: Kysely<Database>): Promise<void> {
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest();

  const failed = results?.find((r) => r.status === "Error");
  if (failed) {
    throw new Error(`Migration ${failed.migrationName} failed.`, { cause: error });
  }
  if (error) throw error;
}

const TABLES = [
  "conversation_history",
  "checkins",
  "writing_log",
  "capture_items",
  "tasks",
  "projects",
  "settings",
  // Kysely's own bookkeeping; leaving it behind would make the next migrate
  // believe the baseline already ran against tables that no longer exist.
  "kysely_migration",
  "kysely_migration_lock",
] as const;

export async function drop(db: Kysely<Database>): Promise<void> {
  for (const table of TABLES) {
    await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
  }
}
