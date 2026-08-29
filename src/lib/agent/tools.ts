import { tool, type AgentTool } from "./types";
import {
  capture,
  createProject,
  createTask,
  findProject,
  findTask,
  listCaptures,
  listTasks,
  logWords,
  markCaptureProcessed,
  queueCheckin,
  setTaskStatus,
  updateProject,
  writingStreak,
} from "@/lib/db/repo";

/**
 * Tools are plain JSON Schema rather than `strict: true` + Zod. Strict mode
 * requires every property to be listed in `required`, which fights badly with
 * tools whose whole point is that most arguments are optional (capture should
 * take a bare string). Handlers validate what they actually need.
 */

async function resolveProjectId(ref?: string | null): Promise<string | null> {
  if (!ref) return null;
  const project = await findProject(ref);
  return project?.id ?? null;
}

export const captureIdea = tool<{
  content: string;
  kind?: "idea" | "note" | "link" | "question";
  tags?: string[];
  project?: string;
}>({
  def: {
    name: "capture_idea",
    description:
      "File a thought into the capture inbox. Use this the moment the user tosses out an idea, a note to self, a link, or an open question — it is deliberately zero-friction. Do not ask clarifying questions first; capture it, then ask if you must.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The thought, in the user's own words where possible." },
        kind: { type: "string", enum: ["idea", "note", "link", "question"] },
        tags: { type: "array", items: { type: "string" } },
        project: { type: "string", description: "Project name or id, if it clearly belongs to one." },
      },
      required: ["content"],
    },
  },
  label: () => "Capturing that",
  async run(input) {
    const row = await capture({
      content: input.content,
      kind: input.kind,
      tags: input.tags,
      project_id: await resolveProjectId(input.project),
    });
    return { captured: row.id, content: row.content, kind: row.kind };
  },
});

export const addTask = tool<{
  title: string;
  notes?: string;
  project?: string;
  priority?: number;
  due_date?: string;
}>({
  def: {
    name: "add_task",
    description:
      "Add a task. Priority 1 = the next action, 2 = soon, 3 = someday; default 2. Keep titles concrete and startable.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        project: { type: "string", description: "Project name or id." },
        priority: { type: "integer", enum: [1, 2, 3] },
        due_date: { type: "string", description: "YYYY-MM-DD." },
      },
      required: ["title"],
    },
  },
  label: (i) => `Adding "${i.title}"`,
  async run(input) {
    const row = await createTask({
      title: input.title,
      notes: input.notes,
      project_id: await resolveProjectId(input.project),
      priority: input.priority,
      due_date: input.due_date,
    });
    return { added: row.id, title: row.title, priority: row.priority };
  },
});

export const completeTask = tool<{ task: string; status?: "done" | "doing" | "dropped" }>({
  def: {
    name: "complete_task",
    description:
      "Mark a task done (default), in progress, or dropped. Accepts the task id from state, or a fragment of its title.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task id, or part of the title." },
        status: { type: "string", enum: ["done", "doing", "dropped"] },
      },
      required: ["task"],
    },
  },
  label: () => "Updating that task",
  async run(input) {
    const found = await findTask(input.task);
    if (!found) return { error: `No open task matching "${input.task}".` };
    const row = await setTaskStatus(found.id, input.status ?? "done");
    return { id: row?.id, title: row?.title, status: row?.status };
  },
});

export const listTasksTool = tool<{ status?: "open" | "doing" | "done" | "dropped"; project?: string }>({
  def: {
    name: "list_tasks",
    description:
      "List tasks. The open ones are already in <current_state>, so only reach for this to see completed or dropped work, or to page past what state showed you.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["open", "doing", "done", "dropped"] },
        project: { type: "string" },
      },
      required: [],
    },
  },
  label: () => "Checking the task list",
  async run(input) {
    const projectId = await resolveProjectId(input.project);
    const rows = await listTasks({
      status: input.status,
      project_id: projectId ?? undefined,
      limit: 40,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      priority: r.priority,
      due_date: r.due_date,
    }));
  },
});

export const createProjectTool = tool<{
  name: string;
  description?: string;
  deadline?: string;
  word_goal?: number;
}>({
  def: {
    name: "create_project",
    description:
      "Start tracking a project — a book, an essay, a pitch, anything with a shape. Only for things with real ongoing work; a one-off errand is a task, not a project.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        description: { type: "string", description: "One line on what it is." },
        deadline: { type: "string", description: "YYYY-MM-DD." },
        word_goal: { type: "integer" },
      },
      required: ["name"],
    },
  },
  label: (i) => `Setting up ${i.name}`,
  async run(input) {
    const row = await createProject(input);
    return { created: row.id, name: row.name };
  },
});

export const updateProjectTool = tool<{
  project: string;
  status?: "active" | "paused" | "done" | "abandoned";
  deadline?: string;
  word_goal?: number;
  description?: string;
}>({
  def: {
    name: "update_project",
    description:
      "Change a project's status, deadline, word goal, or description. Pausing something is a legitimate outcome — use it rather than letting a dead project sit 'active' forever.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or id." },
        status: { type: "string", enum: ["active", "paused", "done", "abandoned"] },
        deadline: { type: "string", description: "YYYY-MM-DD." },
        word_goal: { type: "integer" },
        description: { type: "string" },
      },
      required: ["project"],
    },
  },
  label: () => "Updating the project",
  async run({ project, ...patch }) {
    const found = await findProject(project);
    if (!found) return { error: `No project matching "${project}".` };
    const row = await updateProject(found.id, patch);
    return { id: row?.id, name: row?.name, status: row?.status, deadline: row?.deadline };
  },
});

export const logWordsTool = tool<{ words: number; project?: string; note?: string }>({
  def: {
    name: "log_words",
    description:
      "Record a writing session's word count. Only log counts the user actually reported — never estimate or invent one.",
    input_schema: {
      type: "object",
      properties: {
        words: { type: "integer" },
        project: { type: "string" },
        note: { type: "string", description: "What they worked on, for later recall." },
      },
      required: ["words"],
    },
  },
  label: (i) => `Logging ${i.words} words`,
  async run(input) {
    await logWords({
      words: input.words,
      project_id: await resolveProjectId(input.project),
      note: input.note,
    });
    return await writingStreak();
  },
});

export const writingStats = tool<Record<string, never>>({
  def: {
    name: "writing_stats",
    description: "Word counts and streak figures. The headline numbers are already in <current_state>.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  label: () => "Checking the streak",
  run: async () => writingStreak(),
});

export const processCapture = tool<{ id: string }>({
  def: {
    name: "process_capture",
    description:
      "Clear an item out of the capture inbox once it's become a task or project, or the user has decided it's not happening.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Capture item id from state." } },
      required: ["id"],
    },
  },
  label: () => "Clearing the inbox item",
  async run({ id }) {
    await markCaptureProcessed(id);
    return { processed: id };
  },
});

export const queueCheckinTool = tool<{ message: string; reason?: string }>({
  def: {
    name: "queue_checkin",
    description:
      "Save something to raise with the user later, when it will actually land — a follow-up after a deadline, a nudge on something they asked you to chase. Not for anything you can just say now.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "What you want to say, in your own voice." },
        reason: { type: "string", description: "Why, so you can drop it if it goes stale." },
      },
      required: ["message"],
    },
  },
  label: () => "Making a note to follow up",
  async run(input) {
    const row = await queueCheckin(input);
    return { queued: row.id };
  },
});

export const projectRecall = tool<{ project: string }>({
  def: {
    name: "project_recall",
    description:
      "Where things stood on a project: recent logged sessions and their notes, open tasks, and related captured ideas. This is the 'where did I leave off' lookup — use it before giving that answer, rather than guessing from state.",
    input_schema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name or id." } },
      required: ["project"],
    },
  },
  label: () => "Pulling up where you left off",
  async run({ project }) {
    const found = await findProject(project);
    if (!found) return { error: `No project matching "${project}".` };

    const { getDb } = await import("@/lib/db/client");
    const db = await getDb();
    const [sessions, tasks, captures] = await Promise.all([
      db
        .selectFrom("writing_log")
        .selectAll()
        .where("project_id", "=", found.id)
        .orderBy("created_at", "desc")
        .limit(8)
        .execute(),
      listTasks({ project_id: found.id, limit: 20 }),
      listCaptures({ unprocessedOnly: false, limit: 50 }),
    ]);

    return {
      project: {
        id: found.id,
        name: found.name,
        description: found.description,
        status: found.status,
        deadline: found.deadline,
        word_goal: found.word_goal,
        last_activity_at: found.last_activity_at,
      },
      recent_sessions: sessions.map((s) => ({
        on: s.logged_on,
        words: s.words,
        note: s.note,
      })),
      tasks: tasks.map((t) => ({ title: t.title, status: t.status, priority: t.priority })),
      related_captures: captures
        .filter((c) => c.project_id === found.id)
        .slice(0, 10)
        .map((c) => ({ kind: c.kind, content: c.content })),
    };
  },
});

/** What the writing sub-skill can reach. Narrower than Wren's, on purpose. */
export const WRITING_TOOLS: AgentTool[] = [
  projectRecall,
  logWordsTool,
  writingStats,
  addTask,
  listTasksTool,
  captureIdea,
  processCapture,
  updateProjectTool,
];
