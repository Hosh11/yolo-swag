import { Kysely, type Dialect } from "kysely";
import type { Database } from "./schema";

let dbPromise: Promise<Kysely<Database>> | null = null;

function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "sqlite:./data/wren.sqlite";
}

export function isSqlite(url = databaseUrl()): boolean {
  return url.startsWith("sqlite:") || url.startsWith("file:");
}

async function buildDialect(): Promise<Dialect> {
  const url = databaseUrl();

  if (isSqlite(url)) {
    // Dev only. Imported dynamically so a Postgres deploy never has to have the
    // native module installed (it lives in devDependencies).
    const [{ SqliteDialect }, BetterSqlite3, { mkdirSync }, path] =
      await Promise.all([
        import("kysely"),
        import("better-sqlite3"),
        import("node:fs"),
        import("node:path"),
      ]);

    const file = url.replace(/^(sqlite|file):(\/\/)?/, "");
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

    const database = new BetterSqlite3.default(file);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return new SqliteDialect({ database });
  }

  const [{ PostgresDialect }, pg] = await Promise.all([
    import("kysely"),
    import("pg"),
  ]);
  return new PostgresDialect({
    pool: new pg.default.Pool({ connectionString: url, max: 10 }),
  });
}

/**
 * Process-wide Kysely handle. Memoised on the promise rather than the resolved
 * value so concurrent first-callers share one connection pool.
 */
export function getDb(): Promise<Kysely<Database>> {
  if (!dbPromise) {
    dbPromise = buildDialect().then(async (dialect) => {
      const db = new Kysely<Database>({ dialect });
      // DDL is idempotent, so running it on first connection makes every entry
      // point self-healing — no "did you remember to migrate" failure mode in
      // dev, and a no-op in production once the tables exist.
      const { migrate } = await import("./migrate");
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
}

export const nowIso = (): string => new Date().toISOString();

/** YYYY-MM-DD in the given IANA zone. Streaks are a human-day concept. */
export function today(timeZone = process.env.WREN_TIMEZONE ?? "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const newId = (): string => crypto.randomUUID();
