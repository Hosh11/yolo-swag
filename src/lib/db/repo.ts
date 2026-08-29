import { sql } from "kysely";
import { getDb, newId, nowIso, today } from "./client";
import type {
  CaptureKind,
  ChatRole,
  ProjectStatus,
  TaskStatus,
} from "./schema";

/* ------------------------------------------------------------------ */
/* projects                                                            */
/* ------------------------------------------------------------------ */

export async function listProjects(status?: ProjectStatus) {
  const db = await getDb();
  let q = db.selectFrom("projects").selectAll().orderBy("updated_at", "desc");
  if (status) q = q.where("status", "=", status);
  return q.execute();
}

export async function createProject(input: {
  name: string;
  description?: string | null;
  deadline?: string | null;
  word_goal?: number | null;
}) {
  const db = await getDb();
  const ts = nowIso();
  const row = {
    id: newId(),
    name: input.name,
    description: input.description ?? null,
    status: "active" as ProjectStatus,
    deadline: input.deadline ?? null,
    word_goal: input.word_goal ?? null,
    created_at: ts,
    updated_at: ts,
    last_activity_at: ts,
  };
  await db.insertInto("projects").values(row).execute();
  return row;
}

export async function updateProject(
  id: string,
  patch: Partial<{
    name: string;
    description: string | null;
    status: ProjectStatus;
    deadline: string | null;
    word_goal: number | null;
  }>,
) {
  const db = await getDb();
  await db
    .updateTable("projects")
    .set({ ...patch, updated_at: nowIso() })
    .where("id", "=", id)
    .execute();
  return db.selectFrom("projects").selectAll().where("id", "=", id).executeTakeFirst();
}

/** Bump a project's activity clock. Anything that counts as progress calls this. */
export async function touchProject(id: string | null | undefined) {
  if (!id) return;
  const db = await getDb();
  const ts = nowIso();
  await db
    .updateTable("projects")
    .set({ last_activity_at: ts, updated_at: ts })
    .where("id", "=", id)
    .execute();
}

/** Resolve a project by id, or by a case-insensitive name match. */
export async function findProject(idOrName: string) {
  const db = await getDb();
  const byId = await db
    .selectFrom("projects")
    .selectAll()
    .where("id", "=", idOrName)
    .executeTakeFirst();
  if (byId) return byId;

  const all = await db.selectFrom("projects").selectAll().execute();
  const needle = idOrName.trim().toLowerCase();
  return (
    all.find((p) => p.name.toLowerCase() === needle) ??
    all.find((p) => p.name.toLowerCase().includes(needle))
  );
}

/* ------------------------------------------------------------------ */
/* tasks                                                               */
/* ------------------------------------------------------------------ */

export async function listTasks(opts: {
  status?: TaskStatus;
  project_id?: string;
  limit?: number;
} = {}) {
  const db = await getDb();
  let q = db
    .selectFrom("tasks")
    .selectAll()
    .orderBy("priority", "asc")
    .orderBy("created_at", "asc")
    .limit(opts.limit ?? 50);
  if (opts.status) q = q.where("status", "=", opts.status);
  if (opts.project_id) q = q.where("project_id", "=", opts.project_id);
  return q.execute();
}

export async function createTask(input: {
  title: string;
  notes?: string | null;
  project_id?: string | null;
  priority?: number;
  due_date?: string | null;
}) {
  const db = await getDb();
  const ts = nowIso();
  const row = {
    id: newId(),
    project_id: input.project_id ?? null,
    title: input.title,
    notes: input.notes ?? null,
    status: "open" as TaskStatus,
    priority: input.priority ?? 2,
    due_date: input.due_date ?? null,
    created_at: ts,
    updated_at: ts,
    completed_at: null,
  };
  await db.insertInto("tasks").values(row).execute();
  await touchProject(row.project_id);
  return row;
}

export async function setTaskStatus(id: string, status: TaskStatus) {
  const db = await getDb();
  const ts = nowIso();
  await db
    .updateTable("tasks")
    .set({
      status,
      updated_at: ts,
      completed_at: status === "done" ? ts : null,
    })
    .where("id", "=", id)
    .execute();
  const task = await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  await touchProject(task?.project_id);
  return task;
}

/** Match a task by id, or by fuzzy title among open tasks. */
export async function findTask(idOrTitle: string) {
  const db = await getDb();
  const byId = await db
    .selectFrom("tasks")
    .selectAll()
    .where("id", "=", idOrTitle)
    .executeTakeFirst();
  if (byId) return byId;

  const open = await db
    .selectFrom("tasks")
    .selectAll()
    .where("status", "in", ["open", "doing"])
    .execute();
  const needle = idOrTitle.trim().toLowerCase();
  return (
    open.find((t) => t.title.toLowerCase() === needle) ??
    open.find((t) => t.title.toLowerCase().includes(needle))
  );
}

/* ------------------------------------------------------------------ */
/* capture inbox                                                       */
/* ------------------------------------------------------------------ */

export async function capture(input: {
  content: string;
  kind?: CaptureKind;
  tags?: string[];
  project_id?: string | null;
}) {
  const db = await getDb();
  const row = {
    id: newId(),
    content: input.content,
    kind: input.kind ?? ("idea" as CaptureKind),
    tags: JSON.stringify(input.tags ?? []),
    project_id: input.project_id ?? null,
    processed: 0,
    created_at: nowIso(),
  };
  await db.insertInto("capture_items").values(row).execute();
  return { ...row, tags: input.tags ?? [] };
}

export async function listCaptures(opts: { unprocessedOnly?: boolean; limit?: number } = {}) {
  const db = await getDb();
  let q = db
    .selectFrom("capture_items")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(opts.limit ?? 50);
  if (opts.unprocessedOnly !== false) q = q.where("processed", "=", 0);
  const rows = await q.execute();
  return rows.map((r) => ({ ...r, tags: JSON.parse(r.tags) as string[] }));
}

export async function markCaptureProcessed(id: string) {
  const db = await getDb();
  await db
    .updateTable("capture_items")
    .set({ processed: 1 })
    .where("id", "=", id)
    .execute();
}

/* ------------------------------------------------------------------ */
/* writing log + streaks                                               */
/* ------------------------------------------------------------------ */

export async function logWords(input: {
  words: number;
  project_id?: string | null;
  note?: string | null;
  logged_on?: string;
}) {
  const db = await getDb();
  const row = {
    id: newId(),
    project_id: input.project_id ?? null,
    logged_on: input.logged_on ?? today(),
    words: input.words,
    note: input.note ?? null,
    created_at: nowIso(),
  };
  await db.insertInto("writing_log").values(row).execute();
  await touchProject(row.project_id);
  return row;
}

/**
 * Consecutive days with any logged words, counting back from today. A streak
 * that ended yesterday still counts as live — the day isn't over yet, and
 * telling someone with ADHD their streak broke at 9am is exactly the kind of
 * thing that makes them abandon the tool.
 */
export async function writingStreak(): Promise<{
  current: number;
  longest: number;
  lastLoggedOn: string | null;
  totalWords: number;
  wordsToday: number;
  wordsLast7: number;
}> {
  const db = await getDb();
  const rows = await db
    .selectFrom("writing_log")
    .select(["logged_on", "words"])
    .orderBy("logged_on", "desc")
    .execute();

  const totalWords = rows.reduce((n, r) => n + r.words, 0);
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.logged_on, (byDay.get(r.logged_on) ?? 0) + r.words);

  const days = [...byDay.keys()].sort().reverse();
  const t = today();
  const wordsToday = byDay.get(t) ?? 0;

  const dayMs = 86_400_000;
  const shift = (iso: string, n: number) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10);

  const wordsLast7 = [...Array(7)].reduce<number>(
    (n, _, i) => n + (byDay.get(shift(t, -i)) ?? 0),
    0,
  );

  let current = 0;
  let cursor = byDay.has(t) ? t : shift(t, -1);
  while (byDay.has(cursor)) {
    current += 1;
    cursor = shift(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...days].reverse()) {
    run = prev && shift(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  return {
    current,
    longest,
    lastLoggedOn: days[0] ?? null,
    totalWords,
    wordsToday,
    wordsLast7,
  };
}

/* ------------------------------------------------------------------ */
/* check-ins (queued proactive messages)                               */
/* ------------------------------------------------------------------ */

export async function queueCheckin(input: {
  message: string;
  reason?: string | null;
  kind?: string;
}) {
  const db = await getDb();
  const row = {
    id: newId(),
    message: input.message,
    reason: input.reason ?? null,
    kind: input.kind ?? "nudge",
    created_at: nowIso(),
    delivered_at: null,
  };
  await db.insertInto("checkins").values(row).execute();
  return row;
}

export async function pendingCheckins() {
  const db = await getDb();
  return db
    .selectFrom("checkins")
    .selectAll()
    .where("delivered_at", "is", null)
    .orderBy("created_at", "asc")
    .execute();
}

export async function markCheckinsDelivered(ids: string[]) {
  if (ids.length === 0) return;
  const db = await getDb();
  await db
    .updateTable("checkins")
    .set({ delivered_at: nowIso() })
    .where("id", "in", ids)
    .execute();
}

/* ------------------------------------------------------------------ */
/* conversation history                                                */
/* ------------------------------------------------------------------ */

export async function appendHistory(input: {
  role: ChatRole;
  content: unknown;
  text: string;
}) {
  const db = await getDb();
  const row = {
    id: newId(),
    role: input.role,
    content: JSON.stringify(input.content),
    text: input.text,
    created_at: nowIso(),
  };
  await db.insertInto("conversation_history").values(row).execute();
  return row;
}

/** Most recent `limit` turns, oldest-first (the order the API wants). */
export async function recentHistory(limit = 40) {
  const db = await getDb();
  const rows = await db
    .selectFrom("conversation_history")
    .selectAll()
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
  return rows.reverse();
}

export async function clearHistory() {
  const db = await getDb();
  await sql.raw("DELETE FROM conversation_history").execute(db);
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db
    .selectFrom("settings")
    .select("value")
    .where("key", "=", key)
    .executeTakeFirst();
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  const ts = nowIso();
  await db
    .insertInto("settings")
    .values({ key, value, updated_at: ts })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value, updated_at: ts }))
    .execute();
}
