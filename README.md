# Wren

A chief personal agent. Wren orchestrates the day and hands craft work off to
sub-skills rather than doing everything herself.

Wren, the writing sub-skill, the data layer, a streaming chat UI, voice, and
the proactive scheduler.

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

On Vercel, `DATABASE_URL` is read first, then `POSTGRES_URL` — the Postgres and
Neon integrations provision the latter, and the pooled URL is preferred because
serverless opens many short-lived connections.

`better-sqlite3` is an **optional** dependency, and it is loaded through
`createRequire` with a non-literal specifier rather than a plain dynamic
import. Both are deliberate: a literal `import()` is resolved at build time
even on a branch that never runs in production, so a Postgres deploy would
fail to build without the native SQLite module installed.

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

### Voice

One toggle in the header. On: Wren reads her replies aloud, and a mic button
appears in the composer.

Speech is chunked at sentence boundaries as the reply streams, rather than
waiting for the full response (a long dead pause before every answer) or
speaking each token (stutter). She starts talking about as fast as a person
would. Sending a new message cancels playback, so you can talk over her.

Dictation is push-to-talk and fills the box without auto-sending —
transcription is wrong often enough that firing off a misheard sentence costs
more than the keypress saves. If the platform has an `en-GB` voice, it gets
used; a Midwestern American reading her lines undercuts the character.

Turning voice on speaks a short line immediately, inside the tap itself. That
is not just a confirmation — iOS Safari only grants a page permission to use
speechSynthesis if the *first* call in the session happens synchronously
inside a genuine user gesture. push()/flush() run after the network reply
comes back, which is too late; without this, the first reply after enabling
voice would be silently mute on iOS with no error anywhere.

`SpeechRecognition` (the mic / dictation half) has never shipped in iOS or
iPadOS Safari — desktop Safari has it, the mobile build does not, and this
has been true for years with no sign of changing. Where it's missing the mic
button hides itself rather than pretending to work. **On an iPad this means
our mic button will never appear.** The practical workaround costs no code:
the iPad's own keyboard has a dictation key that types straight into any text
field, this composer included — that's a different, OS-level feature, and it
already works today.

### The scheduler

`GET /api/cron/checkin` wakes Wren, hands her the current state and the last
few things she said, and asks whether anything is worth surfacing. She either
calls `queue_checkin` once or answers `PASS`.

`vercel.json` also pins `"framework": "nextjs"`. Vercel's auto-detection runs
when the project is first connected, so a repo that had no Next.js app at that
moment gets stuck on the "Other" preset and fails the build looking for a
`public/` directory. Declaring it in the repo makes it independent of when the
project happened to be created.

The schedule lives in `vercel.json`: `0 12 * * *`, once a day. **Vercel cron
schedules are always UTC**, and it has no timezone field, so local time is
whatever the conversion works out to — `WREN_TIMEZONE` governs streak day
boundaries and has no effect here. 12:00 UTC is 08:00 EDT in summer and 07:00
EST in winter, which keeps the check-in in the morning year-round without
touching it at the DST switch. Pick a different hour and remember it will
drift an hour twice a year.

Once a day is also the Vercel Hobby plan's limit.

Three guardrails run *before* the model, so an over-eager schedule costs
nothing: don't nudge if one is already waiting, if you nudged in the last 20
hours, or if the user was active in the last 1. Silence is the default — an
assistant that produces a nudge every day gets muted within a fortnight.

A queued nudge is delivered on the next app open and becomes a real assistant
turn in the conversation, so Wren knows what she said and won't repeat it.

Locally:

```bash
npm run cron:checkin      # ?force=1, skips the rate guards
```

`CRON_SECRET` gates the route. Unset in dev it's open; unset in production the
route refuses to run rather than leaving a token-burning endpoint exposed.

## Not built yet

- **Focus/timer sessions** for the writing sub-skill.
- Everything is single-user with no auth. Don't deploy it on a public URL
  without putting something in front of it.
