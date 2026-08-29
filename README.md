# Wren

A chief personal agent. Wren orchestrates the day and hands craft work off to
sub-skills rather than doing everything herself.

This is the first slice: **Wren, the writing sub-skill, the data layer, and a
streaming chat UI.** Voice and the scheduler are deliberately not built yet.

## Stack

Next.js (App Router) · TypeScript · Tailwind v4 · Kysely over SQLite (dev) /
Postgres (prod) · Anthropic API with tool use.

## Running it

```bash
npm install
cp .env.example .env.local     # add your ANTHROPIC_API_KEY
npm run db:migrate
npm run db:seed                # optional: a project, tasks, an idea, a session
npm run dev
```

Set `WREN_USER_NAME` in `.env.local` — Wren addresses you by name, and the
default placeholder will feel wrong immediately.

## How it's put together

```
src/lib/agent/     Wren herself
  wren.ts            the persona (frozen, cacheable)
  state.ts           the "what's in motion" briefing, rebuilt every turn
  run.ts             the streaming tool loop
  tools.ts           tool definitions bound to their handlers
  registry.ts        which tools Wren gets
src/lib/skills/    sub-skills
  writing/           its own prompt, own tools, own loop
src/lib/db/        schema, migrations, repository
src/app/api/chat   SSE endpoint
```

### Orchestration

Wren has two kinds of tool. **Direct tools** (`capture_idea`, `add_task`,
`log_words`, …) she runs herself — they're fast, and routing quick capture
through a second model call would add latency to exactly the interactions that
need to feel instant. **`delegate_to_writing_assistant`** spins up a genuinely
separate agent: its own system prompt, its own narrower tool surface, its own
loop. It reports back to Wren, who relays in her own voice.

That split is the point of the architecture. Adding a sub-skill means writing a
prompt, a tool list, a runner, and one delegation tool in `registry.ts` — Wren's
own prompt barely changes.

### State, rather than memory

Every turn, `buildSnapshot()` assembles active projects (with days-until-
deadline and days-since-activity), open tasks, the capture inbox, and writing
streak into a `<current_state>` block. It rides on the **user turn**, not the
system prompt, so the persona and tool definitions stay a stable cacheable
prefix and history never accumulates stale copies of the world.

This is what makes proactivity cheap: "that chapter hasn't moved in nine days"
needs no extra query, it's already in front of her.

### One schema, two databases

Every column type is valid in both SQLite and Postgres with the same semantics —
`text` UUIDs instead of serials, ISO-8601 strings instead of timestamps (they
sort chronologically either way), `integer` 0/1 for booleans, `text` for JSON.
So there's one set of DDL and one set of queries. The cost is losing native date
and JSON operators; the benefit is no second schema to keep in sync. Swap
`DATABASE_URL` and the driver switches itself.

### Conversation history

Full Anthropic content blocks are persisted, not just text — thinking blocks and
tool_use/tool_result pairs have to survive round-trips or replay breaks. The
history window is sanitised on load: a window can cut through a tool_use /
tool_result pair, and a request that died mid-loop leaves unanswered tool calls.
Both are 400s from the API, so `sanitize()` trims from both ends.

## Model configuration

`claude-sonnet-4-6`, adaptive thinking, effort `medium` for Wren and `high` for
the writing sub-skill (it drafts and critiques prose; she mostly talks). All
three are environment variables.

## Not built yet

- **Voice** — Web Speech API for speech-to-text and text-to-speech, as a toggle.
- **Scheduler** — a cron job asking Wren "anything worth surfacing right now?".
  The groundwork is in: the `checkins` table, the `queue_checkin` tool, and
  delivery of queued nudges through the state snapshot. What's missing is the
  job that runs it on a timer.
- **Focus/timer sessions** for the writing sub-skill.
