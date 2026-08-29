import { Kysely, type Dialect, type SqliteDatabase } from "kysely";
import type { Database } from "./schema";

let dbPromise: Promise<Kysely<Database>> | null = null;

const DEV_SQLITE_URL = "sqlite:./data/wren.sqlite";

/** Hide credentials before a connection string reaches a log or an error. */
function redact(url: string): string {
  return url.replace(/\/\/[^@/]*@/, "//***@");
}

/**
 * Connection-string variables, in order of preference.
 *
 * DATABASE_URL is what this project documents, but Vercel's Postgres and Neon
 * integrations provision POSTGRES_URL instead, so accepting both saves a
 * baffling "not set" error next to a database that plainly exists. The pooled
 * URL comes first deliberately: serverless opens many short-lived connections
 * and would exhaust a direct connection limit.
 */
const URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

function databaseUrl(): string {
  // Trimmed, because an env var set to "" in a dashboard is a very different
  // thing from one that was never set — and `??` treats them the same. Left
  // alone, the empty string falls through to the Postgres branch and `pg`
  // quietly dials 127.0.0.1:5432, which is a nonsense default in production.
  for (const name of URL_VARS) {
    const configured = process.env[name]?.trim();
    if (configured) return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `No database connection string found. Wren looked at ${URL_VARS.join(", ")} ` +
        "and they are all unset or empty. Provision Postgres and set DATABASE_URL " +
        "to its connection string, then redeploy.",
    );
  }
  return DEV_SQLITE_URL;
}

export function isSqlite(url = databaseUrl()): boolean {
  return url.startsWith("sqlite:") || url.startsWith("file:");
}

/**
 * Fails loudly on connection strings that would otherwise produce a baffling
 * runtime error — an unparseable URL becomes ECONNREFUSED on localhost, and
 * SQLite on a serverless host silently loses every write.
 */
function assertUsable(url: string): void {
  if (isSqlite(url)) {
    // VERCEL rather than NODE_ENV: a self-hosted deployment with a real disk
    // can use SQLite perfectly well, and that is also NODE_ENV=production.
    if (process.env.VERCEL) {
      throw new Error(
        "DATABASE_URL points at SQLite, but this is running on Vercel, where " +
          "the filesystem is ephemeral — every write would be lost between " +
          "requests. Provision Postgres and set DATABASE_URL to its connection string.",
      );
    }
    return;
  }

  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error(
      `DATABASE_URL is not a connection string Wren recognises (got "${redact(url)}"). ` +
        "Use postgres://… in production, or sqlite:./path for local development.",
    );
  }
}

/** What Kysely's SqliteDialect needs, plus the pragmas we set. */
type SqliteDriver = new (file: string) => SqliteDatabase & {
  pragma(statement: string): unknown;
};

/**
 * Loads better-sqlite3 without letting the bundler see the specifier.
 *
 * A literal `import("better-sqlite3")` is resolved at BUILD time even though it
 * only ever executes on the SQLite branch, so a Postgres deployment installed
 * without devDependencies fails to build with module-not-found. Resolving
 * through createRequire with a non-literal specifier defers it to runtime,
 * by which point the branch needing it has already been taken.
 *
 * It is also an optionalDependency: a native module that fails to compile on a
 * production image should not take the whole install down with it.
 */
async function loadSqliteDriver(): Promise<SqliteDriver> {
  const { createRequire } = await import("node:module");
  const specifier = "better-sqlite3";
  try {
    return createRequire(import.meta.url)(specifier) as SqliteDriver;
  } catch (cause) {
    throw new Error(
      "DATABASE_URL points at SQLite, but better-sqlite3 is not installed. " +
        "It is an optional dependency for local development — run `npm install` " +
        "without --omit=optional, or point DATABASE_URL at postgres://.",
      { cause },
    );
  }
}

async function buildDialect(): Promise<Dialect> {
  const url = databaseUrl();
  assertUsable(url);

  if (isSqlite(url)) {
    const [{ SqliteDialect }, { mkdirSync }, path] = await Promise.all([
      import("kysely"),
      import("node:fs"),
      import("node:path"),
    ]);

    const file = url.replace(/^(sqlite|file):(\/\/)?/, "");
    mkdirSync(path.dirname(path.resolve(file)), { recursive: true });

    const database = new (await loadSqliteDriver())(file);
    database.pragma("journal_mode = WAL");
    database.pragma("foreign_keys = ON");
    return new SqliteDialect({ database });
  }

  const [{ PostgresDialect }, pg] = await Promise.all([
    import("kysely"),
    import("pg"),
  ]);
  return new PostgresDialect({
    pool: new pg.default.Pool({
      connectionString: url,
      // Each serverless instance gets its own pool, so this multiplies across
      // however many are warm. Small keeps it under a free tier's ceiling.
      max: process.env.VERCEL ? 2 : 10,
      connectionTimeoutMillis: 10_000,
    }),
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
