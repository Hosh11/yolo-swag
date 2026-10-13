# Wren: Codebase Analysis

> Snapshot of `Hosh11/yolo-swag` at commit `438211b`, analysed 2026-10-13.
> Read-only analysis. Every claim cites a file. Anything I couldn't verify is labelled **unverified**.

## TL;DR

- **The core works.** A real chief agent with a streaming manual tool loop, a separate writing sub-agent, a Postgres/SQLite data layer, voice, and a daily proactive check-in. Typecheck ✅ and build ✅ pass.
- **Nothing touches the outside world yet.** There's no Notion code and no Google Calendar code anywhere in `src/`. Projects, tasks and captures live in Wren's own database, separate from Home Base.
- **It's wide open.** `/api/chat` and `/api/state` (including `DELETE`, which wipes history) have no auth. I confirmed this live: an unauthenticated `DELETE /api/state` returned `{"ok":true}`.
- **There's no autonomy layer yet.** No approvals, no action log, no policy tiers. Today every tool runs immediately. That's fine for local captures, but it's unsafe once Wren can write to a calendar.

---

## 1. Verified state (commands run)

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | ✅ OK. Audit: **1 critical, 2 high** (see §5) |
| Typecheck | `npx tsc --noEmit` | ✅ exit 0 (TypeScript 7, `strict: true`) |
| Lint | `npm run lint` | ❌ **Broken.** `next lint` was removed in Next 16 (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md:1082-1084`). No ESLint config or deps exist. |
| Build | `npm run build` | ✅ Next 16.3.3 (Turbopack). Routes: `/` static; `/api/chat`, `/api/state`, `/api/cron/checkin` dynamic |
| Tests | n/a | ❌ No test runner, no tests |
| Smoke (prod server, SQLite, no API key) | `curl` | `GET /` 200 · `GET /api/state` 200 JSON · `POST /api/chat` streams a clean `error` event (no key) · cron without `CRON_SECRET` in prod → 503 ✅ · **`DELETE /api/state` with no credentials → 200 ok** ❌ |
| Live model call | n/a | **Unverified.** No `ANTHROPIC_API_KEY` in this environment, so the writing delegation and check-in paths are code-reviewed but not exercised. |

---

## 2. Architecture

### Directory map

```
src/
  app/
    page.tsx                 → <Chat/> (only page)
    layout.tsx, globals.css  → dark "ink/paper/ember" theme (globals.css:3-14)
    api/chat/route.ts        → POST, SSE stream of runWren() events
    api/state/route.ts       → GET (history + streak; ?deliver=1 flushes check-ins), DELETE (wipe history)
    api/cron/checkin/route.ts→ GET, Bearer CRON_SECRET, runs proactive pass
  components/
    Chat.tsx                 → SSE client, turn rendering, voice toggle, clear button
    Composer.tsx             → textarea + push-to-talk dictation
    ToolTrace.tsx            → "what she's doing" line under replies
  lib/
    agent/
      wren.ts                → WREN_SYSTEM persona (frozen string, cacheable)
      client.ts              → Anthropic singleton, MODEL, effort config
      run.ts                 → chief agent streaming tool loop + history sanitise
      registry.ts            → Wren's tool list (direct tools + delegation tools)
      tools.ts               → all tool defs + handlers, and WRITING_TOOLS
      state.ts               → buildSnapshot(): <current_state> block per turn
      checkin.ts             → proactive cron pass
      types.ts               → AgentTool, tool(), StreamEvent
    skills/writing/
      prompt.ts              → WRITING_SYSTEM
      index.ts               → runWritingAssistant() loop + delegateToWritingAssistant()
    db/
      schema.ts              → Kysely table types
      migrate.ts             → idempotent CREATE TABLE/INDEX list
      client.ts              → driver selection (pg vs better-sqlite3), guards, today()
      repo.ts                → all queries
    env.ts                   → env(): blank = unset; timeZone()
    voice.ts                 → Web Speech TTS (sentence-chunked) + dictation
scripts/db.ts                → migrate | reset | seed
vercel.json                  → framework pin + daily cron 0 12 * * *
```

### Request flow

```
Chat.tsx ──POST /api/chat──► route.ts ──► runWren(text)            (run.ts:72)
                                            ├─ buildSnapshot()       (state.ts:29)  ← DB
                                            ├─ loadHistory(40 rows)  (run.ts:56)    ← DB, sanitize()
                                            ├─ loop ≤10: messages.stream(...)        (run.ts:114-200)
                                            │    ├─ text/thinking deltas → SSE
                                            │    └─ tool_use → impl.run() → tool_result
                                            │         └─ delegate_to_writing_assistant
                                            │              → runWritingAssistant() (skills/writing/index.ts:21)
                                            │                 non-streaming loop ≤8, WRITING_TOOLS
                                            └─ persist each assistant/tool_result turn (appendHistory)
Vercel Cron 12:00 UTC ──► /api/cron/checkin ──► runCheckinPass() (checkin.ts:44) → queue_checkin → checkins table
App open ──► GET /api/state?deliver=1 ──► check-ins become assistant turns (state/route.ts:38-48)
```

### Chief agent ↔ sub-skills

- **Direct tools** (`registry.ts:21-38`) are `capture_idea`, `add_task`, `complete_task`, `list_tasks`, `create_project`, `update_project`, `process_capture`, `queue_checkin`, `log_words` and `writing_stats`. Wren runs these herself because they're fast.
- **Delegation tool** (`skills/writing/index.ts:99-130`). `delegate_to_writing_assistant(request, context)` runs a separate agent with its own system prompt (`skills/writing/prompt.ts:9`), a narrower tool set (`WRITING_TOOLS`, `agent/tools.ts:345-354`, which adds `project_recall`), `effort: high`, and an 8-iteration cap. It returns `{report}` and Wren relays it in her own voice (`wren.ts:42-44`).
- The **state string is bound by the caller** (`registry.ts:36`), so the sub-agent sees the real snapshot rather than Wren's paraphrase of it. Caveat: the snapshot is from the start of the turn, so it's stale if Wren mutated something earlier in the same turn.
- **Adding a lane today** takes a prompt file, a tool list, a copy of the loop in `skills/writing/index.ts:40-91`, and one entry in `registry.ts`. The loop isn't shared with `run.ts`, so it's duplicated.

### Tool-use implementation

- The `AgentTool<I>` interface binds `def` (an Anthropic.Tool JSON Schema), `run()` and `label()` (`types.ts:4-13`).
- It's a manual loop, not the SDK tool runner, because the UI needs per-tool `tool_start`/`tool_end` events (`run.ts:65-71`).
- Unknown tools and handler exceptions become `is_error` tool results (`run.ts:168-195`). That's good.
- There's no runtime validation of model-supplied tool input: `block.input as never` at `run.ts:159` and `skills/writing/index.ts:72`. The design note at `tools.ts:18-23` says this is deliberate.

### Persona and prompts

- `WREN_SYSTEM` is one frozen string with no interpolation (`wren.ts:8-56`). It carries `cache_control: ephemeral` (`run.ts:118-124`).
- Volatile context (name, date, state) rides on the **user turn** as `<current_state>` (`state.ts:42-112`, `run.ts:93-102`) and is never persisted.
- The model is `claude-sonnet-4-6` by default, with `thinking: adaptive` and `output_config.effort` (`client.ts:16-30`). All three are overridable via env.

### Data model (`db/schema.ts`, `db/migrate.ts`)

| Table | Purpose | Notes |
|---|---|---|
| `projects` | writing projects | `deadline`, `word_goal`, `last_activity_at` drive stall detection |
| `tasks` | to-dos | `priority` 1/2/3, `status` open/doing/done/dropped |
| `capture_items` | inbox | `tags` JSON text, `processed` 0/1 |
| `writing_log` | word counts | `logged_on` is the local date for streaks |
| `checkins` | queued proactive nudges | `delivered_at` null until seen |
| `conversation_history` | full Anthropic content blocks as JSON + text projection | |
| `settings` | key/value | only `user_name` is ever read (`run.ts:20`), and **nothing writes it** |

The portable-types design (text UUIDs, ISO strings, int booleans, JSON text; see `schema.ts:1-16`) means one DDL works for SQLite and Postgres. Migrations are idempotent `CREATE … IF NOT EXISTS` only (`migrate.ts:8-11`) and run on **every cold start** (`client.ts:156-161`).

---

## 3. Feature status

| Feature | Status | Evidence |
|---|---|---|
| Streaming chat UI (SSE) | 🟢 Working | `api/chat/route.ts`, `Chat.tsx:108-165` |
| Chief agent tool loop | 🟢 Working | `run.ts:72-218` |
| Wren persona | 🟢 Working | `wren.ts` |
| Direct tools (capture/task/project/log words/stats/inbox/queue) | 🟢 Working | `tools.ts:31-288` |
| Writing sub-agent delegation | 🟢 Working (code-verified, not live-tested) | `skills/writing/index.ts` |
| "Where did I leave off" recall | 🟡 Partial | `tools.ts:290-342`. Writing lane only, and only scans the 50 newest captures (`:317`) |
| Per-turn state snapshot | 🟢 Working | `state.ts`. Small bug: the weekday uses server time zone, not `WREN_TIMEZONE` (`state.ts:44`) |
| Conversation persistence | 🟢 Working | `repo.ts:362-394`, `run.ts:56-63` |
| Long-term memory / summaries | 🔴 Missing | Only the last 40 **rows** are replayed (`run.ts:16`). Tool hops eat rows. |
| Clear conversation | 🟢 Working (unauthenticated) | `state/route.ts:89`, `Chat.tsx:200-219` |
| Proactive daily check-in | 🟢 Working | `checkin.ts`, `vercel.json:4` |
| Check-in delivery on open | 🟢 Working | `state/route.ts:38-48` |
| Voice: speak replies | 🟢 Working | `voice.ts:138-255` |
| Voice: dictation | 🟡 Partial | Not available on iOS/iPadOS Safari (`README.md:134-141`) |
| User name via settings | 🟡 Partial | Read at `run.ts:20` but never written. Env `WREN_USER_NAME` is the only working path. |
| Focus/timer sessions | ⚪ Stubbed (documented, not built) | `README.md:184` |
| Postgres (prod) | 🟢 Working (code) | `db/client.ts`. Production connection **unverified** |
| SQLite (dev) | 🟢 Working | smoke-tested |
| Auth / access control | 🔴 Missing | `README.md:185-186` admits it; smoke test confirms |
| Notion (Home Base) | 🔴 Missing | zero references in `src/` |
| Google Calendar | 🔴 Missing | zero references in `src/` |
| Manuscripts / Writing Sessions / Job Pipeline | 🔴 Missing | local tables only cover projects, tasks, captures, writing_log |
| Other lanes (job, household, learning, scheduling) | 🔴 Missing | only `skills/writing/` exists |
| Approvals / autonomy policy | 🔴 Missing | every tool executes immediately |
| Action/audit log | 🔴 Missing | only conversation rows |
| Push/email notifications | 🔴 Missing | check-ins appear only when the app is opened |
| Lint | 🔴 Broken | `package.json:10` |
| Tests / CI | 🔴 Missing | no runner, no `.github/` |

---

## 4. Integrations

| Integration | State | Notes |
|---|---|---|
| **Anthropic** | 🟢 | `new Anthropic()` reads `ANTHROPIC_API_KEY` server-side (`client.ts:7`). No `NEXT_PUBLIC_` vars, so the key is never sent to the browser. |
| **Postgres** | 🟢 code / ❓ deploy | Reads `DATABASE_URL` → `POSTGRES_URL` → `POSTGRES_PRISMA_URL` → `POSTGRES_URL_NON_POOLING` (`db/client.ts:23-28`). Pool max 2 on Vercel (`:142`). Fails loudly on SQLite-on-Vercel (`:63`). |
| **Notion** | 🔴 none | The Notion MCP connector you use in Claude is **not** available to the deployed app. The app needs its own Notion integration token. |
| **Google Calendar** | 🔴 none | Same point: "connected" in your Claude account ≠ connected in Wren. The app needs its own Google OAuth client and stored refresh token. |
| **Vercel** | ❓ partly verified | `vercel.json` pins `framework: nextjs` and a daily cron (Hobby limit). The Vercel API lists **two projects linked to this repo: `wren-agent` and `yolo-swag`**. That means duplicate builds and possibly two crons. Env vars and deployments returned **403** for this connector's scope, so I could not check which vars are set. |

### Env vars the code reads (names only)

| Name | Required | Read at |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | SDK default (`client.ts:7`) |
| `DATABASE_URL` (or `POSTGRES_URL` / `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`) | ✅ prod | `db/client.ts:23` |
| `CRON_SECRET` | ✅ prod (route 503s without it) | `cron/checkin/route.ts:15`. Uses raw `process.env`, not `env()`, which is inconsistent but harmless. |
| `WREN_USER_NAME` | recommended | `run.ts:21` |
| `WREN_TIMEZONE` | recommended | `db/client.ts:170`. ⚠️ `.env.example:36` says `Europe/London`, but commit `a512d5f` targets 08:00 America/New_York. Confirm the deployed value. |
| `WREN_MODEL`, `WREN_EFFORT`, `WREN_WRITING_EFFORT` | optional | `client.ts:16,27,30` |

**Auth gaps:** there is no user auth on any route except the cron.

---

## 5. Quality

| Area | Finding |
|---|---|
| **Security: open routes** | `POST /api/chat` (`chat/route.ts:9`) lets anyone with the URL spend your Anthropic credit and read/write your data. `GET /api/state` returns your conversation. `DELETE /api/state` wipes it. |
| **Security: deps** | Next 16.3.3 is in range for a critical advisory (next/og ImageResponse RCE, <16.3.6) and a high one (Image Optimization SSRF, <16.3.8). This app doesn't use `next/og`, but upgrade to ≥16.3.8 anyway. `sharp` and `source-map-js` are rated high. |
| **Security: prompt injection (future)** | Once Notion pages or calendar descriptions enter the context, their text is untrusted. There's no separation yet between "instructions" and "data". |
| **Security: secrets hygiene** | ✅ `.env*` is gitignored (`.gitignore:8-10`). `.env.example` holds placeholders only. DB URLs are redacted in errors (`db/client.ts:10`). |
| **Error handling** | ✅ Good and deliberate: errors surface their real message (`state/route.ts:27-34`, `Chat.tsx:347-355`), the env blank-string trap is handled (`env.ts`), and DB misconfig guards exist. ⚠️ Raw upstream error text goes to the client, which is acceptable for a single user. |
| **Streaming** | ✅ SSE with anti-buffering header. ⚠️ `request.signal` isn't passed to the SDK stream, so closing the tab doesn't stop the model and tokens keep burning. ⚠️ The sub-agent is non-streaming and shows as one step for up to 8 high-effort hops, which risks hitting `maxDuration = 300` (`chat/route.ts:7`). Whether Hobby allows 300s depends on Fluid Compute (**unverified**). |
| **Persistence** | ✅ Full content blocks are kept, and `sanitize()` trims broken edges (`run.ts:34-54`). ⚠️ **Concurrency:** two tabs sending at once interleave rows, which can split a tool_use/tool_result pair *mid-window*. `sanitize` only trims the ends, so this would 400. ⚠️ If `MAX_ITERATIONS` is hit, nothing closes the turn (`run.ts:114-208`). |
| **Memory** | ⚠️ There's no long-term memory. The `HISTORY_TURNS = 40` window counts rows, so a tool-heavy turn eats ~4 rows. |
| **Type safety** | ✅ `strict: true`, typecheck clean. ⚠️ `AgentTool<I = any>` (`types.ts:4`), `as never` casts, and unvalidated `JSON.parse` of history (`run.ts:60`). |
| **Entity resolution** | ⚠️ `findTask`/`findProject` use a substring match over all rows (`repo.ts:76-91, 162-181`), so "email" can hit the wrong task. That's harmless for local tasks but **dangerous once actions have side effects**. |
| **Migrations** | ⚠️ Create-only. The first column change needs a versioned migrator. It also runs 13 DDL statements on every cold start. |
| **Tests** | ❌ None. Pure, testable units already exist: `sanitize`, `writingStreak`, `buildSnapshot`, `env`, `timeZone`, `score` in voice.ts, and the `/api/state` stitching logic. |

---

## 6. Risks and tech debt that block the next stage

| # | Risk | Why it blocks | Severity |
|---|---|---|---|
| R1 | **No auth** | You can't connect Calendar or Notion tokens to an app anyone can drive | 🔴 Blocker |
| R2 | **No approval/action layer** | Autonomous lanes need tiers, a pending-action queue, an audit log and undo | 🔴 Blocker |
| R3 | **Source of truth split**: local `projects/tasks/capture_items/writing_log` vs Notion Home Base | Building lanes on local tables means migrating them later; two task lists will rot | 🔴 Decision needed |
| R4 | **Duplicated agent loop** (`run.ts` vs `skills/writing/index.ts`) | Every new lane copies it | 🟠 |
| R5 | **Create-only migrations** | First schema change (approvals, credentials) needs a versioned migrator | 🟠 |
| R6 | **Hobby cron = once/day** | Scheduling and approvals need more frequent wakeups (reminders, expiry) | 🟠 |
| R7 | **Lint broken, no tests, no CI** | A builder agent has no safety net | 🟠 |
| R8 | **Two Vercel projects on one repo** | Duplicate deploys and crons, and confusion about which has the env vars | 🟡 |
| R9 | **Next.js security advisories** | Easy fix | 🟡 |
| R10 | **Fuzzy entity resolution** | Wrong-target writes once actions are external | 🟡 (🔴 after integrations) |
| R11 | **No abort propagation / 300s ceiling** | Long lane runs get killed mid-turn | 🟡 |
| R12 | **Time zone ambiguity** (`.env.example` London vs commit NY; weekday bug `state.ts:44`) | Scheduling must be TZ-correct | 🟡 (🔴 for scheduling lane) |
