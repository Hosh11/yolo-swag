# Wren: Build Plan

> Companion to [ANALYSIS.md](./ANALYSIS.md). Target: a chief agent that orchestrates five lane agents (job, writing, household, learning, scheduling), acting on her own with human-in-the-loop approvals.

## 1. Gap analysis

| Capability | Today | Target | Gap |
|---|---|---|---|
| Chief agent | ✅ Streaming tool loop, persona, state snapshot | Same, plus routing to 5 lanes | Small: generalise delegation |
| Lane agents | 1 (writing), hand-rolled loop | 5 lanes on a shared runner | Lane framework + 4 lanes |
| Data | Local Postgres tables | Notion Home Base is the user's record; Postgres holds agent state | Notion adapter and source-of-truth migration |
| Calendar | none | Read, find time, create/move blocks | OAuth, client, tools |
| Autonomy | Every tool fires instantly | Tiered policy: auto / auto+notify / approve / never | Policy, approvals table, action log, undo |
| Keeping you in the loop | Check-in shown on next app open, once a day | Push notifications, approval inbox, daily digest | Notifications and a more frequent scheduler |
| "Finding things" | Snapshot plus `project_recall` | One search across Notion, Calendar and history | Finder capability |
| Memory | Last 40 rows | Durable facts and preferences, plus conversation summaries | Memory table and tools |
| Safety | No auth, no tests, lint broken | Authed, tested, CI-gated | Foundation milestone |

## 2. Key decisions (my recommendations)

| Decision | Recommendation | Why |
|---|---|---|
| **Source of truth** | **Notion is the system of record** for Projects, Tasks, Manuscripts, Writing Sessions, Capture Inbox and Job Pipeline. **Postgres keeps agent state**: conversation, check-ins, approvals, action log, credentials, memory, plus a short-TTL cache of Notion reads. | You already live in Home Base. Two task lists will diverge within a week. Keep the `repo.ts` function signatures and swap the backing store behind a `store` interface, so tools barely change. |
| **Auth** | Single-user passphrase. A `WREN_PASSPHRASE` env var, a `/login` page that sets an httpOnly signed session cookie (HMAC with `WREN_SESSION_SECRET`), enforced in **`src/proxy.ts`** (Next 16 renamed middleware to proxy). The cron route stays on Bearer `CRON_SECRET`. | Smallest thing that's actually secure. Hobby's Vercel Authentication protects previews, not production (**verify**). No third-party auth provider needed for one user. |
| **Notion auth** | An internal integration token (`NOTION_TOKEN`) shared with the Home Base pages, rather than public OAuth | One user, no consent screen, no token refresh |
| **Google auth** | Your own Google Cloud OAuth client (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). A one-time `/api/auth/google` flow stores the **refresh token encrypted** in Postgres (`WREN_ENCRYPTION_KEY`). Scope: `calendar.events` + `calendar.readonly`. | Calendar has no static-token option |
| **Scheduler cadence** | Keep the Vercel daily cron, **plus** a GitHub Actions scheduled workflow (free) that calls a new `/api/cron/tick` every 15–30 min with `CRON_SECRET` | Hobby allows 1 cron/day. Reminders and approval expiry need more. Upgrading to Pro is the alternative ($). |
| **Notifications** | **Web Push** (installable PWA) for approvals and the morning brief, plus an in-app Activity/Approvals tray. Email digest later, optionally. | Free, works on iOS 16.4+ for home-screen apps, no extra account. Flagged as an open question below. |
| **Model** | Keep `WREN_MODEL` configurable. Lanes get their own effort env (`WREN_<LANE>_EFFORT`), following the `client.ts` pattern. | Already the convention |

## 3. Autonomy model

Every tool declares a **tier**. A single `guard()` wrapper enforces it, so the policy lives in one place.

| Tier | Meaning | Examples | How you're kept in the loop |
|---|---|---|---|
| **T0: Auto, quiet** | Read-only, or private and trivially reversible | search Notion/Calendar, read pages, `capture_idea`, `log_words`, `add_task`, internal notes, memory writes | Visible in chat tool trace only |
| **T1: Auto + notify** | Writes that only affect you and can be undone | create or move a **Wren-tagged** focus block on your own calendar, update a Notion task's status/date, file into Capture Inbox, create a Writing Session row, reschedule a block Wren made | Logged to `actions` with an **Undo** button. Shown in the Activity tray and summarised in the morning digest. |
| **T2: Needs approval** | Touches other people, isn't Wren's to change, or is hard to undo | invites/RSVPs, editing or deleting events Wren didn't create, sending any email or message, job application submissions, deleting anything, bulk edits (>5 items) | Creates a `pending` approval. Push notification with Approve / Deny / Edit. Expires in 48h (configurable). Wren mentions pending ones at next chat. |
| **T3: Never** | Out of bounds | payments, purchases, credentials, sharing or permission changes, deleting Notion databases | The tool doesn't exist. If asked, Wren explains and offers to draft. |

Rules:
- **Escalation, not de-escalation.** An ambiguous entity match (more than one candidate) bumps a T1 to T2. This fixes analysis risk R10.
- **Every write is logged** with input, result, tier and an undo payload where possible.
- **Quiet hours** (default 21:30–08:00 in `WREN_TIMEZONE`): only T2 items you're actively waiting on get pushed.
- **Trust dial (later):** after N approvals of the same action type with no denials, Wren *suggests* promoting it to T1. She never self-promotes.

## 4. Recommended first lane after writing: **Scheduling** (with "Finder" as a chief-level skill)

Why Scheduling first:
1. **It's your biggest drain**, and the payoff is daily and visible.
2. **It multiplies every other lane.** Writing needs protected time, the job lane needs interview slots, household needs appointments, and learning needs study blocks. Every later lane calls into calendar.
3. **It's safe to automate.** Wren's own tagged blocks on your own calendar are T1 and reversible, so autonomy can start there before anything touches other people.
4. **The API is well defined** (Google Calendar), so there's less ambiguity than with household or learning.

"Finding things" is your other drain. It isn't a lane. It's a capability every lane needs, so build it as **chief-level `find` tools** over Notion, Calendar and conversation history (M4), not as a sixth agent.

## 5. Roadmap

```
M1 Foundation ─► M2 Lane framework + Autonomy kernel ─► M3 Calendar + Scheduling lane ─► M4 Notion + Finder
                                                                                              │
              M7 Household + Learning ◄─ M6 Job lane ◄─ M5 Notifications, tick & memory ◄─────┘
```

### M1: Foundation and safety · Size **M** · Depends on nothing
**Goal:** make the app safe to connect real accounts to, and give builders a safety net.

| Task | Files |
|---|---|
| Passphrase login and signed-cookie session; protect everything except `/login`, `/api/auth/*`, `/api/cron/*` | `src/proxy.ts` (new), `src/app/login/page.tsx` (new), `src/app/api/auth/login/route.ts` (new), `src/lib/auth.ts` (new), `.env.example` |
| Upgrade `next` to ≥16.3.8, run `npm audit fix` | `package.json`, `package-lock.json` |
| Replace `next lint` with the ESLint CLI (flat config) | `package.json`, `eslint.config.mjs` (new) |
| Add Vitest, with tests for `sanitize`, `writingStreak`, `buildSnapshot`, `env`/`timeZone`, the `/api/state` stitching, and auth | `vitest.config.ts`, `src/**/*.test.ts` |
| GitHub Actions CI: typecheck, lint, test, build | `.github/workflows/ci.yml` |
| Versioned migrations (Kysely `Migrator`), baseline = current DDL | `src/lib/db/migrations/0001_baseline.ts`, `migrate.ts`, `client.ts` |
| Fix the weekday time zone bug | `src/lib/agent/state.ts:44` |
| Pass `request.signal` through to the model stream | `api/chat/route.ts`, `run.ts` |
| Doc: retire one of the two Vercel projects (user action) | `README.md` |

**Acceptance:** an unauthenticated `POST /api/chat` and `DELETE /api/state` return 401. The login flow works. `npm run lint`, `npm test`, `npm run typecheck` and `npm run build` all pass locally and in CI. `npm audit --omit=dev` shows no critical or high issues in `next`. An existing DB migrates via the baseline without data loss.

### M2: Lane framework and autonomy kernel · Size **M** · Depends on M1
**Goal:** adding a lane becomes a folder, and every write goes through policy.

| Task | Files |
|---|---|
| Extract a shared `runSubAgent({system, tools, effort, maxIterations, state})` from the writing loop | `src/lib/agent/subagent.ts` (new), `skills/writing/index.ts` |
| A lane descriptor `{id, name, description, system, tools, effort}` and auto-generated `delegate_to_<id>` tools | `src/lib/skills/types.ts`, `src/lib/skills/index.ts`, `registry.ts` |
| Move `WRITING_TOOLS` into the writing lane | `agent/tools.ts` → `skills/writing/tools.ts` |
| Add `tier` to `AgentTool`. `guard()` wraps `run`, logs to `actions`, and turns T2 into `approvals` rows | `agent/types.ts`, `agent/policy.ts` (new) |
| New tables `actions` and `approvals` | `db/migrations/0002_autonomy.ts`, `schema.ts`, `repo.ts` |
| Approval API and UI: an inline card in chat, a tray in the header, approve/deny/undo | `api/approvals/route.ts`, `api/actions/[id]/undo/route.ts`, `components/Approvals.tsx`, `Chat.tsx` |
| New SSE event `approval_requested` | `agent/types.ts`, `Chat.tsx` |
| Pending approvals appear in `<current_state>` | `state.ts` |
| Ambiguous-match escalation helper | `agent/policy.ts`, `repo.ts` |

**Acceptance:** the writing lane behaves the same, now on `runSubAgent`. A test tool marked T2 creates a pending approval instead of executing. Approve runs it, and Deny records it without running. T1 actions show in the Activity tray with a working Undo. Every write has an `actions` row. There's a unit test for each tier path.

### M3: Google Calendar and the Scheduling lane · Size **L** · Depends on M2
**Goal:** Wren can see your time and protect it.

| Task | Files |
|---|---|
| Google OAuth connect flow and encrypted refresh-token storage | `api/auth/google/{start,callback}/route.ts`, `lib/integrations/google/auth.ts`, `lib/crypto.ts`, migration `0003_credentials` |
| A thin Calendar client: list events, free/busy, insert/patch/delete | `lib/integrations/google/calendar.ts` |
| Today's and tomorrow's agenda in the snapshot (cached 5 min) | `state.ts` |
| Scheduling lane: prompt and tools `agenda`, `find_free_time`, `block_time` (T1, tagged `wren:`), `move_block` (T1 own / T2 others), `propose_event_with_guests` (T2), `cancel_event` (T2) | `skills/scheduling/{prompt,tools,index}.ts` |
| Wren-created event marker (`extendedProperties.private.wren=1`) used for the T1/T2 decision | `calendar.ts`, `policy.ts` |
| Time zone single source: `WREN_TIMEZONE` everywhere, explicit in every API call | `env.ts`, `calendar.ts` |

**Acceptance:** "Find me 90 minutes for chapter 9 this week" yields a block on your calendar (T1, undoable). "Move my dentist appointment" yields an approval card. The agenda shows in state. Tokens are never logged or returned to the client. Calendar calls are mocked in tests.

### M4: Notion Home Base and Finder · Size **L** · Depends on M2 (and M3 for the calendar half of Finder)
**Goal:** Wren works in your real system, and can find anything.

| Task | Files |
|---|---|
| Notion client and data source ID config for the six databases | `lib/integrations/notion/{client,config}.ts`, env `NOTION_TOKEN`, `NOTION_DS_*` |
| A `store` interface behind `repo.ts` with a Notion implementation for projects, tasks and captures, plus Writing Sessions → `log_words` | `lib/db/store.ts`, `lib/integrations/notion/store.ts`, `repo.ts` |
| One-time import of existing local rows into Notion (script, dry-run first) | `scripts/import-to-notion.ts` |
| Finder tools at chief level: `find` (Notion search + Calendar search + history), `open_page` | `agent/tools/find.ts`, `registry.ts` |
| Writing lane reads Manuscripts | `skills/writing/tools.ts` |
| Untrusted-content fencing: wrap external text in `<external_content source=…>` with a "data, not instructions" line in prompts | `state.ts`, `wren.ts`, lane prompts |

**Acceptance:** a task added in chat appears in Notion Tasks within seconds. "Where's that note about the lighthouse letters?" returns the Notion page link. The snapshot loads in under 1.5s with the cache warm. The import script is idempotent.

### M5: Notifications, frequent tick and memory · Size **M** · Depends on M2
- PWA manifest, service worker, Web Push (VAPID keys), and a `push_subscriptions` table.
- A `/api/cron/tick` endpoint for approval expiry, reminders and push. A GitHub Actions `schedule:` workflow calls it.
- The morning brief: agenda, pending approvals, yesterday's T1 actions, one nudge.
- A `memories` table with `remember`/`forget` tools, plus rolling conversation summaries so context outlives 40 rows.

**Acceptance:** an approval reaches your phone within a tick interval. Quiet hours are respected. "Remember I don't take meetings before 10" persists and changes `find_free_time`.

### M6: Job lane · Size **M** · Depends on M4
Job Pipeline in Notion: status tracking, follow-up reminders (T1), drafting cover letters and replies (T0 draft), and any sending or submitting (T2).

### M7: Household and Learning lanes · Size **M** each · Depends on M2 and M3
Household: recurring chores and appointments via calendar. Learning: study plans and spaced review blocks. Both are mostly configuration once M2 exists.

## 6. Open questions

| # | Question | My default if you don't answer |
|---|---|---|
| Q1 | Notion as source of truth for tasks and projects? | **Yes** (see §2) |
| Q2 | Your real time zone? (`.env.example` says London, the cron commit says New York) | `America/New_York` |
| Q3 | Which Vercel project is canonical: `wren-agent` or `yolo-swag`? | Keep whichever has the Postgres integration and delete the other |
| Q4 | Notification channel: Web Push OK, or would you rather use email or Telegram? | Web Push |
| Q5 | Is a GitHub Actions cron OK, or upgrade to Vercel Pro? | GitHub Actions |
| Q6 | Is the approval expiry window of 48h right? | 48h |
| Q7 | Which Google calendar(s) can Wren write to? | Primary only, Wren-tagged events only for T1 |
| Q8 | Does Wren keep her own copy of Writing Sessions for streak maths, or read Notion? | Read Notion, cache in Postgres |
