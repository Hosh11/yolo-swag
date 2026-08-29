/**
 * Database schema.
 *
 * Deliberate design constraint: every column type here is valid in BOTH SQLite
 * and Postgres with identical semantics, so one set of DDL and one set of
 * queries serve local dev and production. That means:
 *
 *   - ids       -> `text` UUIDs generated in app code, not serial/autoincrement
 *   - timestamps-> `text` ISO-8601 UTC, which sorts lexicographically the same
 *                  way it sorts chronologically
 *   - booleans  -> `integer` 0/1 (SQLite has no boolean; Postgres takes ints)
 *   - json      -> `text`, parsed at the repo boundary
 *
 * The cost is losing native date/json operators. The benefit is that there is
 * no second schema to keep in sync and no dialect-specific query paths.
 */

export type ProjectStatus = "active" | "paused" | "done" | "abandoned";
export type TaskStatus = "open" | "doing" | "done" | "dropped";
export type CaptureKind = "idea" | "note" | "link" | "question";
export type ChatRole = "user" | "assistant";

export interface ProjectsTable {
  id: string;
  name: string;
  /** One line on what this actually is. Shown to Wren in every state snapshot. */
  description: string | null;
  status: ProjectStatus;
  /** ISO date (YYYY-MM-DD), not a timestamp — deadlines are day-granular. */
  deadline: string | null;
  word_goal: number | null;
  created_at: string;
  updated_at: string;
  /** Last time anything happened on this project. Drives "this has stalled". */
  last_activity_at: string | null;
}

export interface TasksTable {
  id: string;
  project_id: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  /** 1 = next action, 2 = soon, 3 = someday. Kept coarse on purpose. */
  priority: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface CaptureItemsTable {
  id: string;
  content: string;
  kind: CaptureKind;
  /** Free-text tags, JSON array. Capture stays frictionless; sorting is later. */
  tags: string;
  project_id: string | null;
  /** 0 until it's been turned into a task/project or consciously discarded. */
  processed: number;
  created_at: string;
}

export interface WritingLogTable {
  id: string;
  project_id: string | null;
  /** ISO date (YYYY-MM-DD) in the user's local day, for streak arithmetic. */
  logged_on: string;
  words: number;
  note: string | null;
  created_at: string;
}

export interface CheckinsTable {
  id: string;
  /** What Wren wanted to say, unprompted. */
  message: string;
  /** Why she said it — used to avoid repeating the same nudge. */
  reason: string | null;
  kind: string;
  created_at: string;
  /** Null until the user has actually seen it in the UI. */
  delivered_at: string | null;
}

export interface ConversationHistoryTable {
  id: string;
  role: ChatRole;
  /**
   * The full Anthropic content-block array, JSON-encoded — not just the text.
   * Thinking blocks and tool_use/tool_result blocks must survive round-trips or
   * replaying history to the model breaks.
   */
  content: string;
  /** Plain text projection, for cheap rendering and search. */
  text: string;
  created_at: string;
}

export interface SettingsTable {
  key: string;
  value: string;
  updated_at: string;
}

export interface Database {
  projects: ProjectsTable;
  tasks: TasksTable;
  capture_items: CaptureItemsTable;
  writing_log: WritingLogTable;
  checkins: CheckinsTable;
  conversation_history: ConversationHistoryTable;
  settings: SettingsTable;
}
