# Builder Brief: Wren · Milestone M1 (Foundation and Safety)

> A self-contained handoff. Read this file top to bottom, then `ANALYSIS.md` §2–§6 if you want more depth. Build **only M1**. Everything after it is in `PLAN.md` (and `DESIGN.md` for M2 Presence); don't start it.

---

## 1. What Wren is

Wren is a single-user "chief agent" web app. A Next.js 16 App Router front end streams a chat with Wren, a Claude-powered agent that uses tools to manage the user's projects, tasks, capture inbox and writing streak. She delegates craft work to a separate **writing sub-agent** (its own prompt, tools and loop), and a daily cron lets her queue one proactive nudge. Data lives in Postgres in production and SQLite locally, through one portable Kysely schema. The roadmap turns her into an orchestrator of five autonomous "lane" agents (job, writing, household, learning, scheduling) with human-in-the-loop approvals. **M1 makes the app safe to connect real accounts to, and gives future builders lint, tests and CI.**

### Persona and tone rules (don't regress these)
- Wren is a **witty, warm, whip-smart British woman**. She's dry but on the user's side, and her wit is a way of showing care.
- **No assistant-speak** ("I'd be happy to help!"). Default replies are 2–3 sentences.
- The user **has ADHD**. Zero friction, one or two concrete next actions, never guilt, mention a stalled thing once and then drop it.
- She **acts rather than asking** about small things and doesn't narrate tool calls ("Logged.").
- Sub-agents report *to Wren*. She relays their output in her own voice. Sub-agents never address the user.
- Her voice must be **female**. See the `MALE` exclusion list in `src/lib/voice.ts:74-77`, and don't "simplify" it away.
- Source of truth: `src/lib/agent/wren.ts`. **Don't edit the persona prompt in M1.** Any user-facing copy you add (like the login page) should match the tone: short, dry, warm.

---

## 2. Current-state snapshot (commit `438211b`)

| Check | State |
|---|---|
| `npx tsc --noEmit` | ✅ passes |
| `npm run build` | ✅ passes (Next 16.3.3, Turbopack) |
| `npm run lint` | ❌ broken (`next lint` was removed in Next 16) |
| Tests | ❌ none |
| CI | ❌ none (no `.github/`) |
| Auth | ❌ none. `/api/chat`, `GET/DELETE /api/state` are open (verified live) |
| `npm audit --omit=dev` | ❌ 1 critical + 1 high in `next` (<16.3.8), plus high in `sharp` and `source-map-js` |
| Migrations | create-only `IF NOT EXISTS` list, run on every cold start |

### Key file map

| Path | What it is |
|---|---|
| `src/app/api/chat/route.ts` | POST → SSE stream of `runWren()` events. `maxDuration = 300` |
| `src/app/api/state/route.ts` | GET history + streak (`?deliver=1` flushes check-ins). DELETE wipes history |
| `src/app/api/cron/checkin/route.ts` | Daily proactive pass. Bearer `CRON_SECRET`, fails closed in prod |
| `src/components/Chat.tsx` | Client: SSE parsing, turns, voice, clear. `serverError()` helper at `:347` |
| `src/lib/agent/run.ts` | Chief agent loop. `sanitize()` at `:34`, `runWren()` at `:72` |
| `src/lib/agent/state.ts` | `buildSnapshot()`, the `<current_state>` block |
| `src/lib/agent/tools.ts` | All tool defs and handlers, plus `WRITING_TOOLS` |
| `src/lib/agent/registry.ts` | Wren's tool list |
| `src/lib/skills/writing/` | Writing sub-agent (`prompt.ts`, `index.ts`) |
| `src/lib/db/{schema,migrate,client,repo}.ts` | Types, DDL, driver selection and guards, queries |
| `src/lib/env.ts` | `env()` treats a blank string as unset. **Always use it** |
| `scripts/db.ts` | `db:migrate` / `db:reset` / `db:seed` |
| `vercel.json` | Framework pin and daily cron `0 12 * * *` |

---

## 3. The milestone: M1, Foundation and Safety

Do these **in order**. Commit after each numbered step, with a message that explains *why*, matching the existing history style (for example "Stop the production build from requiring the SQLite driver").

### ☐ 1. Upgrade Next.js and fix the audit
- Bump `next` to the latest 16.x that is **≥ 16.3.8**, then run `npm audit fix` (not `--force`).
- Run `npx tsc --noEmit && npm run build`.
- **Accept when** `npm audit --omit=dev` reports no critical or high issues, and the build passes.

### ☐ 2. Restore linting (ESLint CLI, flat config)
- `npm i -D eslint eslint-config-next`
- Create `eslint.config.mjs` following `node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`, with `core-web-vitals` and `eslint-config-next/typescript`.
- Set `"lint": "eslint ."` in `package.json`.
- Fix real findings. Where a rule fights a documented deliberate choice, disable it **on that line, with a reason**. One example: `AgentTool<I = any>` in `src/lib/agent/types.ts:4`.
- **Accept when** `npm run lint` exits 0.

### ☐ 3. Add the test harness and baseline tests
- Add Vitest (`vitest`, plus `@vitest/coverage-v8` if you want coverage). Set `"test": "vitest run"`. Add a `vitest.config.ts` with the `@/` → `src/` alias.
- Tests use a **temp SQLite file** (`DATABASE_URL=sqlite:<tmpdir>/test.sqlite`). Reset the module-level `dbPromise` between suites, or use a fresh file per suite.
- Write tests for:
  - `sanitize()` (`run.ts:34`): leading tool_result turn dropped, trailing assistant tool_use dropped, clean history untouched.
  - `writingStreak()` (`repo.ts:258`): streak alive if the last log was yesterday, broken after a gap, longest-run maths, wordsLast7.
  - `env()` / `timeZone()` (`env.ts`): blank → undefined, bad zone → fallback.
  - `buildSnapshot()` (`state.ts`): overdue vs days-left wording, empty-state lines.
  - `/api/state` GET stitching (`state/route.ts:66-83`): continuation under 60s merges, over 60s doesn't.
- **Accept when** `npm test` passes with at least 15 meaningful assertions, and the tests don't need network or an API key.

### ☐ 4. Single-user auth
Design (decided, don't re-litigate):
- Env vars: `WREN_PASSPHRASE` (what the user types) and `WREN_SESSION_SECRET` (HMAC key, 32+ random bytes). Add both to `.env.example` with comments in the existing style. **Never commit real values.**
- `src/lib/auth.ts`:
  - `createSessionToken()` returns `<expiryEpochMs>.<base64url HMAC-SHA256(expiry)>`. Use Web Crypto (`crypto.subtle`), 30-day expiry.
  - `verifySessionToken(token)` uses a constant-time compare and checks expiry.
  - `requireSession(request)` returns `null` or a `401` Response, for use inside route handlers.
  - `checkPassphrase(input)` does a constant-time compare.
  - Read env through `env()` from `src/lib/env.ts`.
- `src/app/api/auth/login/route.ts`: POST `{passphrase}`. On success, set cookie `wren_session` (`httpOnly`, `secure` in production, `sameSite=lax`, `path=/`, 30d). On failure, return 401 `{error}` after a ~500ms delay.
- `src/app/api/auth/logout/route.ts`: POST clears the cookie.
- `src/app/login/page.tsx`: a minimal form in the existing ink/paper/ember styling (`globals.css`). Copy in Wren's voice, for example "Who goes there?" On success it does `location.href = "/"`. Keep it simple: M2 restyles everything to the "Lamplight" design in DESIGN.md, so use existing tokens only and don't invent new ones.
- **`src/proxy.ts`** (Next 16 renamed `middleware` to `proxy`; see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). Export `function proxy(request)`.
  - Allow: `/login`, `/api/auth/*`, `/api/cron/*` (the cron route keeps its own Bearer check), and static assets (use a negative matcher for `_next/static`, `_next/image`, `favicon.ico`).
  - Otherwise, if there's no valid cookie: API paths get a `401` JSON `{error: "Not signed in."}`, and pages redirect to `/login`.
  - **Don't** set `runtime` in proxy. It's always Node there, and setting it throws.
- **Defence in depth:** also call `requireSession()` at the top of `chat/route.ts` POST and `state/route.ts` GET and DELETE. The Next docs warn that proxy coverage can silently drop.
- `Chat.tsx`: on any `401`, redirect to `/login`. Reuse the `serverError()` flow.
- **Fail closed:** if `WREN_PASSPHRASE` or `WREN_SESSION_SECRET` is unset in production, every protected route returns 503 with a clear message (mirror `cron/checkin/route.ts:21-25`). In dev with both unset, allow access and log one warning.
- Tests: token round-trip, a tampered token is rejected, an expired token is rejected, and the proxy's allow/deny decision as a pure function (export the path-classification helper).
- **Accept when** these all hold against `npm run build && npm start` with the env set:
  - `curl -X POST /api/chat` with no cookie → 401
  - `curl -X DELETE /api/state` with no cookie → 401
  - `/api/cron/checkin` with no Bearer → 401, with the correct Bearer → 200
  - The browser shows the login page, then the chat after login
  - CSS and JS load on `/login`

### ☐ 5. Versioned migrations
- Replace the bare statement loop in `src/lib/db/migrate.ts` with Kysely's `Migrator` and an **inline `MigrationProvider`**: `getMigrations: async () => ({ "0001_baseline": baseline })`. **Don't use `FileMigrationProvider`.** It reads the filesystem at runtime, which breaks under Vercel bundling.
- `src/lib/db/migrations/0001_baseline.ts`: `up()` runs the **current** statements unchanged (`CREATE … IF NOT EXISTS`), so it's a no-op on the existing production DB and creates everything on a fresh one.
- Keep the Postgres race tolerance (`ALREADY_EXISTS` codes, `migrate.ts:96-105`).
- Keep `drop()` working for `db:reset`, and also drop Kysely's `kysely_migration` and `kysely_migration_lock` tables.
- Keep the auto-migrate on first connection (`client.ts:156-161`). With the Migrator it becomes a cheap "already applied" check.
- **Accept when** all three hold:
  - On a DB created by the *old* code (run `git stash` or check out `438211b`, then `db:migrate` and `db:seed`, then switch back and `db:migrate`), seeded rows survive and `kysely_migration` lists `0001_baseline`.
  - A fresh DB migrates.
  - There's a test for both cases.

### ☐ 6. Small correctness fixes
- `src/lib/agent/state.ts:44`: the weekday must use `timeZone("WREN_TIMEZONE")`. Pass `timeZone` to `toLocaleDateString`. Add a test.
- Abort propagation: pass `request.signal` from `chat/route.ts` into `runWren(text, { signal })` and on to `client.messages.stream(..., { signal })` in `run.ts:115`. On abort, stop cleanly without emitting an `error` event. History stays consistent because `sanitize()` already handles a dangling tool_use.
- `cron/checkin/route.ts:15`: read `CRON_SECRET` through `env()` to keep the blank-string convention consistent.

### ☐ 7. CI
- `.github/workflows/ci.yml` runs on push and pull_request:
  - Node 22, `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
  - The build needs no secrets. Set `DATABASE_URL=sqlite:./data/ci.sqlite` for tests only.
- **Accept when** the workflow file is valid YAML and every step passes locally in the same order.

### ☐ 8. Docs
- `README.md`: replace the "Not built yet → no auth" bullet with an **Access** section explaining the passphrase, the session secret and how to generate it (`openssl rand -base64 32`), plus the new `lint`/`test` commands.
- Add a short **Deploy checklist** listing the env var *names* to set in Vercel: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `CRON_SECRET`, `WREN_PASSPHRASE`, `WREN_SESSION_SECRET`, `WREN_USER_NAME`, `WREN_TIMEZONE`.

---

## 4. Conventions already in the code (follow them)

| Convention | Example |
|---|---|
| **Comments explain *why*, at length, above the thing.** Not what. | `db/client.ts:86-97`, `voice.ts:213-224` |
| Env vars go through `env()`. Never `process.env.X ?? default`. | `env.ts:14` |
| Route handlers: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`, then `try/catch` returning `Response.json({ error: message }, { status })` | `state/route.ts:11-35` |
| Errors are **written for the person deploying**: say what's wrong and what to do | `db/client.ts:41-45` |
| Path alias `@/` maps to `src/` | everywhere |
| DB: portable types only (text UUID via `newId()`, ISO strings via `nowIso()`, 0/1 ints, JSON as text). All queries live in `repo.ts`. | `schema.ts:1-16` |
| Tools: `tool<Input>({ def, label, run })`. Labels are short present-tense phrases in Wren's voice. Handlers return small JSON, or `{error}` for not-found. | `tools.ts:31-62` |
| UI: Tailwind v4 with theme tokens `ink`, `ink-soft`, `ink-line`, `paper`, `paper-dim`, `paper-faint`, `ember`. Serif `.prose-wren` for Wren's words only. | `globals.css:3-37` |
| Named exports in `lib/`, default export for React components | `components/*.tsx` |
| Commit messages: imperative sentence describing the *user-visible why* | `git log --oneline` |

## 5. Do / Don't

| ✅ Do | ❌ Don't |
|---|---|
| Read `node_modules/next/dist/docs/` before using any Next API (as `AGENTS.md` instructs). This is Next 16. | Assume Next 13–15 conventions (`middleware.ts`, `next lint`) |
| Keep `WREN_SYSTEM` a frozen string (it's the cache prefix) | Interpolate anything into the system prompt |
| Keep the snapshot on the user turn, never persisted | Store `<current_state>` in history |
| Run `tsc`, lint, tests and build before every commit | Push with any of them red |
| Use constant-time comparisons for secrets | Log, return, or commit any secret value |
| Keep `better-sqlite3` loaded via `createRequire` with a non-literal specifier | "Simplify" it to `import("better-sqlite3")`, which breaks the prod build (`db/client.ts:86-111`) |
| Keep changes scoped to M1 | Start Notion, Calendar, approvals, new lanes, **or the M2 redesign/persona changes** (see DESIGN.md) |
| Surface open questions in your final report | Guess on anything in §7 |
| Commit to branch `claude/gracious-knuth-m7cvww` (or the branch you're assigned) | Push to `main` or open a PR unless asked |

## 6. Commands

### Which model to run the builder on
**Sonnet is the right default for M1.** This brief spells out every step and acceptance check, which is the kind of well-scoped, test-verified work Sonnet handles well, and it uses much less of the plan's limits. Two guardrails:
- **Step 4 (auth) is security code.** Before merging, have a stronger-model pass (Opus, or `/code-review` / `/security-review`) review the auth diff specifically.
- If the builder gets stuck twice on the same problem, or wants to change the design, **stop and surface it** rather than improvising.


### Where things run
**Production = Vercel (always on). Development = the user's PC.** See PLAN.md §2a. Build M1 so the app works in both places: nothing Vercel-only in the auth code, and SQLite stays fully supported for local development.

### First-time setup on the user's PC
- The user's PC runs **Windows** and is **not on 24/7**, which is why production stays on Vercel. Develop natively in PowerShell (WSL2 is optional).
- Install **Node 22 LTS** (from nodejs.org) and **Git for Windows**.
  - **Native Windows:** `better-sqlite3` normally installs a prebuilt binary for Node 22 x64. If it tries to compile, install the "Desktop development with C++" workload from the Visual Studio Build Tools, or use WSL2.
  - `npm run cron:checkin` uses `curl`, which ships with Windows 10 and later.
- Then:
  - `git clone https://github.com/Hosh11/yolo-swag.git`
  - `cd yolo-swag`
  - `git checkout <your branch>`
  - continue below.


```bash
npm ci
cp .env.example .env.local        # set ANTHROPIC_API_KEY, WREN_PASSPHRASE, WREN_SESSION_SECRET
npm run db:migrate && npm run db:seed
npm run dev                        # http://localhost:3000

npm run typecheck                  # tsc --noEmit
npm run lint                       # eslint . (after step 2)
npm test                           # vitest run (after step 3)
npm run build && npm start         # prod-mode smoke test
npm run cron:checkin               # hits /api/cron/checkin?force=1 (needs CRON_SECRET header once auth exists in prod mode)
```

**On Windows (PowerShell):** use `Copy-Item .env.example .env.local` in place of `cp`. Everything else in the block above works as-is. Run the bash-style smoke test below in **Git Bash** (it ships with Git for Windows), or call `curl.exe` explicitly in PowerShell, because plain `curl` there is an alias for `Invoke-WebRequest`.

Smoke test after step 4 (prod mode, with the passphrase set):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/chat -H 'content-type: application/json' -d '{"message":"hi"}'   # expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE localhost:3000/api/state                                                       # expect 401
curl -s -c jar -X POST localhost:3000/api/auth/login -H 'content-type: application/json' -d "{\"passphrase\":\"$WREN_PASSPHRASE\"}"
curl -s -b jar localhost:3000/api/state | head -c 200                                                                              # expect JSON
```

## 7. Definition of done

- [ ] Steps 1–8 are checked off, each in its own commit
- [ ] `npm run typecheck && npm run lint && npm test && npm run build` all pass, from a clean `npm ci`
- [ ] The auth smoke tests in §6 return the expected codes
- [ ] An existing seeded DB survives the migration change
- [ ] `npm audit --omit=dev` has no critical or high issues
- [ ] No secrets appear in the diff (`git diff main | grep -iE "sk-ant|passphrase=.+|secret=.+"` is empty, apart from `.env.example` placeholders)
- [ ] `README.md` and `.env.example` are updated
- [ ] The final report lists what was done, the test count, anything skipped and why, and the open questions below

## 8. Known pitfalls

1. **`proxy.ts`, not `middleware.ts`.** Next 16 renamed it, and setting `runtime` in proxy throws.
2. **The matcher has to exclude static assets**, or the login page renders unstyled.
3. **Don't use `FileMigrationProvider`** on Vercel. Use an inline provider.
4. **`getDb()` is memoised per process** (`db/client.ts:5,152`), so tests that switch DB files need a reset hook. Add an exported `__resetDbForTests()` and don't hack around it.
5. **The `cache_control` mutation on the last history block** (`run.ts:83-89`) mutates the parsed object. It's fine because history is re-read per request. Don't share that array across requests.
6. **SSE and auth:** `fetch` sends the cookie automatically (same origin). Don't add custom auth headers in `Chat.tsx`.
7. **A Vercel Cron request has no cookie.** That's why `/api/cron/*` is excluded from the proxy and keeps its Bearer check.
8. **iOS voice unlock** (`Chat.tsx:59-61`, `voice.ts:213-225`): don't move `speakNow` behind an `await`.
9. **`next dev` rewrites `AGENTS.md`** with its own block (see `AGENTS.md:5`). Commit it if it appears, or leave it alone. Don't fight it.

## 9. Open questions to surface (don't guess)

| # | Question | Why it matters for M1 |
|---|---|---|
| Q1 | Two Vercel projects (`wren-agent`, `yolo-swag`) deploy this repo. Which is canonical? | The user must set the new env vars on the right one and delete the other |
| Q2 | What is the real `WREN_TIMEZONE`? (`.env.example` says London, the cron commit says New York) | Affects the weekday fix test expectations and docs |
| Q3 | Are any production env vars blank or missing? (The analyst's Vercel access returned 403.) | The deploy checklist can't be verified from the repo |
| Q4 | Is a passphrase acceptable, or does the user want Google sign-in later? | The M1 design assumes a passphrase. Note any friction you hit. |
