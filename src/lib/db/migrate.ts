import { sql, type Kysely } from "kysely";
import type { Database } from "./schema";

/**
 * DDL that is valid, and means the same thing, in both SQLite and Postgres.
 * See the note at the top of schema.ts for why the column types look like this.
 *
 * Statements are idempotent, so this doubles as the migration runner for now.
 * When the schema starts changing under real data, swap this for Kysely's
 * versioned Migrator — the table shapes won't have to move.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS projects (
     id                text PRIMARY KEY,
     name              text NOT NULL,
     description       text,
     status            text NOT NULL DEFAULT 'active',
     deadline          text,
     word_goal         integer,
     created_at        text NOT NULL,
     updated_at        text NOT NULL,
     last_activity_at  text
   )`,

  `CREATE TABLE IF NOT EXISTS tasks (
     id           text PRIMARY KEY,
     project_id   text REFERENCES projects(id) ON DELETE SET NULL,
     title        text NOT NULL,
     notes        text,
     status       text NOT NULL DEFAULT 'open',
     priority     integer NOT NULL DEFAULT 2,
     due_date     text,
     created_at   text NOT NULL,
     updated_at   text NOT NULL,
     completed_at text
   )`,

  `CREATE TABLE IF NOT EXISTS capture_items (
     id         text PRIMARY KEY,
     content    text NOT NULL,
     kind       text NOT NULL DEFAULT 'idea',
     tags       text NOT NULL DEFAULT '[]',
     project_id text REFERENCES projects(id) ON DELETE SET NULL,
     processed  integer NOT NULL DEFAULT 0,
     created_at text NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS writing_log (
     id         text PRIMARY KEY,
     project_id text REFERENCES projects(id) ON DELETE SET NULL,
     logged_on  text NOT NULL,
     words      integer NOT NULL,
     note       text,
     created_at text NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS checkins (
     id           text PRIMARY KEY,
     message      text NOT NULL,
     reason       text,
     kind         text NOT NULL DEFAULT 'nudge',
     created_at   text NOT NULL,
     delivered_at text
   )`,

  `CREATE TABLE IF NOT EXISTS conversation_history (
     id         text PRIMARY KEY,
     role       text NOT NULL,
     content    text NOT NULL,
     text       text NOT NULL,
     created_at text NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS settings (
     key        text PRIMARY KEY,
     value      text NOT NULL,
     updated_at text NOT NULL
   )`,

  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_capture_unprocessed ON capture_items(processed, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_writing_log_day ON writing_log(logged_on)`,
  `CREATE INDEX IF NOT EXISTS idx_checkins_undelivered ON checkins(delivered_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_history_created ON conversation_history(created_at)`,
];

/**
 * Postgres error codes for "someone else just created this".
 *
 * `CREATE TABLE IF NOT EXISTS` is idempotent but not atomic: two serverless
 * cold starts racing on the first request after a deploy can both pass the
 * existence check and then collide in the catalog. The statements are
 * identical, so losing the race is a success, not a failure.
 */
const ALREADY_EXISTS = new Set([
  "23505", // unique_violation, typically on pg_type
  "42P07", // duplicate_table
  "42710", // duplicate_object
]);

function isRace(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && ALREADY_EXISTS.has(code);
}

export async function migrate(db: Kysely<Database>): Promise<void> {
  for (const statement of STATEMENTS) {
    try {
      await sql.raw(statement).execute(db);
    } catch (error) {
      if (!isRace(error)) throw error;
    }
  }
}

const TABLES = [
  "conversation_history",
  "checkins",
  "writing_log",
  "capture_items",
  "tasks",
  "projects",
  "settings",
] as const;

export async function drop(db: Kysely<Database>): Promise<void> {
  for (const table of TABLES) {
    await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
  }
}
