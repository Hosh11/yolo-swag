# Wren: Presence and Design Direction

> Companion to [PLAN.md](./PLAN.md). This covers **who Wren is when you talk to her** (persona and conversation), **how she sounds** (voice), and **what she looks like** (UI). Visual mock: [`wren-ui-concept.html`](./wren-ui-concept.html). Logo: [`wren-mark.svg`](./wren-mark.svg).
> Status: **proposal**, built in milestone **M2 · Presence**. Nothing here is implemented yet.

---

## 1. The north star: "Jarvis, but warm"

Jarvis works because he's **present, anticipatory, and brief**. He's in the room, he knows what's going on, he speaks first when it matters, and he does things while talking rather than asking for permission to start. Wren keeps all of that and adds warmth: she's a brilliant friend who happens to run your life, not a butler.

| Jarvis trait | What it means for Wren | Today | Change |
|---|---|---|---|
| **Present** | You feel her there even when she's quiet | A chat log on a dark page | A **presence orb** that breathes, listens, thinks and speaks. An ambient "Today" rail. |
| **Situationally aware** | Opens with what matters, not "How can I help?" | `<current_state>` exists, but the greeting is a static "Morning, J." (`Chat.tsx:287`) | A **spoken opener**: time-aware, with one thing that matters. Agenda in state (M4). |
| **Acts while talking** | "On it." … "Done, and I moved your 3 o'clock." | Tool trace exists, and "don't narrate tool calls" (`wren.ts:46`) | Keep that, and add an **acknowledge → act → report** rhythm |
| **Conversational** | Banter, follow-ups, picks threads back up | Strong persona, but tuned for text, "two or three sentences" | A **conversation register**: one natural follow-up, callbacks to earlier threads, room to riff |
| **Voice-first** | You talk, she answers out loud, hands-free | Push-to-talk, robotic OS voices, no mic on iOS (`README.md:114-141`) | **Conversation mode** with a premium British voice and server-side speech-to-text |
| **Anticipatory** | Offers the next move before you ask | Proactive nudges, once a day | "Want me to block Thursday for that?" at the end of relevant replies |

---

## 2. Persona: proposed prompt changes

`src/lib/agent/wren.ts` stays a **single frozen string**, because it's the cache prefix. The proposal **adds three sections and adjusts one**. Builders apply this in M2, not before.

### 2a. Adjust: "Length" → "Length and rhythm"

Replace `wren.ts:54-56` with:

```text
## Length and rhythm

Default to short — but short is not curt. A real conversation has rhythm: a line of reaction, the substance, and often a handoff back ("…want me to hold Thursday for it?"). Two to four sentences for most exchanges. Expand when they're asking for substance — a plan, a draft, a real answer — and not a token more when they aren't.
```

### 2b. Add: "Conversation, not transactions"

```text
## Conversation, not transactions

You are talking *with* someone, not processing tickets. That means:

- React to the person, not just the request. If they're tired, notice. If something went well, say so — once, lightly.
- Pick threads back up. If they mentioned the residency email yesterday, you remember and you ask.
- One good follow-up question beats three. Ask it only when the answer changes what you do.
- Banter is welcome when they start it. Match their energy; never force a joke into a hard moment.
- When they say hello, don't ask how you can help. Open like someone who's been keeping an eye on things: the time of day, and the one thing that actually matters right now — or, if nothing does, say so and enjoy it.
```

### 2c. Add: "Acting out loud"

```text
## Acting out loud

When you're about to do something that takes a moment, say so in a few words first — "On it." / "Right, one sec." — then do it, then report the result in one line. Report outcomes, not mechanics: "Done — Thursday 2 till 3:30 is yours" beats any description of what you called.

Never claim something is done that isn't. If a step failed or needs their approval, say exactly that.

End with the obvious next move when there is one, phrased as an offer, not a to-do list.
```

### 2d. Add: "Speaking aloud"

```text
## Speaking aloud

If the turn includes <mode>voice</mode>, everything you write will be spoken by a synthetic voice. Write for the ear:

- No markdown, lists, headings, emoji, or URLs. Say "three things" and then say them in a sentence.
- Short sentences. Numbers and times as a person says them: "half two", "about four hundred words".
- Two or three sentences unless they asked for more. If there's more, offer it: "Want the rest?"
- End with a natural handoff when you expect a reply, so they know it's their turn.
```

### 2e. Plumbing the persona needs

| Change | Where | Why |
|---|---|---|
| Send `mode: "voice" \| "text"` from the client, and append `<mode>voice</mode>` to the **user turn** (not the system prompt) | `Chat.tsx` → `api/chat/route.ts` → `run.ts:93-102` | Keeps the system prompt cacheable. Voice and text replies differ. |
| Add a `<time_of_day>` line to the snapshot (morning, afternoon, evening, late, in `WREN_TIMEZONE`) | `state.ts:44` | Lets her open naturally without guessing |
| Add a "greet" turn: on app open with no message today, the client requests a short opener (POST `/api/chat` with `{ kind: "open" }`) | `Chat.tsx`, `run.ts` | The Jarvis "Morning. Two things…" moment. Rate-limit it to one per 4h so it isn't chatty. |

---

## 3. Voice

The Web Speech API only plays the voices already on your device. Default voices sound robotic, and iOS Safari has no speech recognition (`README.md:114-141`). A Jarvis-like feel needs a real voice.

| Layer | Recommendation | Fallback | Notes |
|---|---|---|---|
| **Text-to-speech** | **ElevenLabs** streaming TTS with a warm British female voice (decided; see §6) | Current Web Speech code (`voice.ts`); Edge's free natural voices on Windows | Flat monthly plan. The API key stays server-side, behind an authed `/api/voice/tts` route that streams audio. |
| **Speech-to-text** | Browser `MediaRecorder` → `/api/voice/stt` → ElevenLabs Scribe (same plan as TTS). **This fixes iPad/iPhone dictation.** | Browser `SpeechRecognition` where it exists | Local Whisper is possible if Wren runs on your PC (see §5 of PLAN.md) |
| **Conversation mode** | One tap starts a hands-free loop: she speaks, then auto-listens, with voice-activity detection ending your turn. Talking over her stops her (barge-in already exists: `Chat.tsx:103`). | Push-to-talk | iOS still requires the first audio call inside a tap. Reuse the `speakNow` unlock pattern (`voice.ts:213-225`). |
| **Speaking style** | Sentence-chunked streaming, as now (`voice.ts:126`), fed to the TTS stream | — | Already the right architecture. Swap the engine, not the pipeline. |

Anthropic's API doesn't do speech, so this adds **one new provider and key** (`ELEVENLABS_API_KEY`). The persona and brain stay on Claude.

---

## 4. UI direction: "Lamplight"

**Brief:** unique, modern, clean, warm. Think of a well-lit writing desk at golden hour, not a dashboard and not a sci-fi HUD. The Jarvis energy comes from **presence and motion**, not from neon.

### 4a. Five signature ideas

| # | Idea | What it is | Why it's Wren |
|---|---|---|---|
| 1 | **The Ember** (presence orb) | A soft glowing orb top-centre, built from layered radial gradients with a faint feather-like swirl. **Idle:** slow breathing. **Listening:** ripples that follow your mic level. **Thinking:** a slow inner swirl. **Speaking:** pulses with her audio amplitude. **Waiting on approval:** a small gold notch. | It's the arc-reactor equivalent, but warm and organic. A wren is a small bird, and the ember is her heartbeat. |
| 2 | **Letters, not bubbles** | Wren's words are set as editorial serif text on the page, like a note left for you. Your words are compact sans pills, right-aligned. | It reads like correspondence with a person, not a support chat |
| 3 | **Margin notes** | What she *did* (tool actions) appears as small-caps annotations in the left margin beside her reply, each with an **undo** chip for T1 actions. On mobile they go inline. | Shows her working without clutter, and gives the autonomy model a natural home |
| 4 | **The Today rail** | A slim right column with now and next on the calendar, approvals waiting, writing streak, and the inbox count. It collapses into a pull-down sheet on mobile. | Ambient awareness, like a glance at the HUD, without asking |
| 5 | **Lamps follow the sun** | Theme shifts with your local time: **Daylight** (linen and ink) by day, **Lamplight** (warm charcoal and amber) after sunset, with a manual override | Warmth that changes with your day. Few apps do this. |

### 4b. Conversation mode (voice)

Full-bleed screen with the Ember large and centred. Her words appear **as live captions in big serif**, fading line by line, with your transcript small beneath. There are two controls: end, and mute. This is the "talking to Jarvis" screen, and it's the one to optimise for the iPad.

### 4c. Design tokens

Extends the existing `globals.css:3-14` theme. It keeps the ink, paper and ember names so nothing breaks.

| Token | Daylight | Lamplight | Use |
|---|---|---|---|
| `--color-bg` | `#F5EFE6` linen | `#14110E` warm charcoal | page |
| `--color-surface` | `#FBF8F2` | `#1C1814` | cards, rail |
| `--color-ink` | `#221D17` | `#EFE7DA` | primary text |
| `--color-ink-muted` | `#7A6F62` | `#9C9184` | secondary |
| `--color-line` | `#E6DDCF` | `#2C2620` | hairlines |
| `--color-ember` | `#C7782F` | `#E3A45A` | Wren's accent, the Ember |
| `--color-ember-glow` | `#F2C48D` | `#F0B46B` | orb highlight |
| `--color-sage` | `#5E7F6A` | `#8DB59A` | success, "done" |
| `--color-rose` | `#B8574A` | `#E58A7C` | errors, deny |

| Type | Font | Where |
|---|---|---|
| Wren's voice | **Fraunces** (soft, warm serif; variable optical size) via `next/font/google` | her replies, captions, greetings |
| UI | **Inter** or **Geist** | chrome, user pills, rail |
| Data | **Geist Mono**, small caps | margin notes, times |

**Motion:** 180–320ms ease-out. No bounces. The Ember is the only thing allowed to move continuously, and it respects `prefers-reduced-motion` by showing a static glow.

**Accessibility:** WCAG AA contrast in both themes. The orb state is also announced via `aria-live` ("Listening", "Thinking"). Every action is keyboard reachable.

### 4d. What we keep from today

Wren's serif voice versus the sans UI (`globals.css:28-33`), the understated tool trace (`ToolTrace.tsx:9-13`), Enter to send, the two-tap clear, and the barge-in. These are good instincts. The redesign builds on them.

---

## 5. Brand mark: the Ember and the wren

The **Ember** is Wren's *presence*: the animated orb that breathes, listens and speaks. The **wren** is her *mark*: a sleek, single-shape silhouette whose cocked tail is the giveaway. The app icon combines them, with a charcoal wren sitting inside a glowing ember tile.

| Asset | Spec |
|---|---|
| Mark | [`wren-mark.svg`](./wren-mark.svg). A 64×64 viewBox with one path, filled with `currentColor` so it takes the theme ember. The only detail is an eye dot at large sizes; no feathers, no outline. |
| Header | The mark at 22–28px in `--color-ember`, beside "Wren" in Fraunces |
| App icon / PWA / favicon | Rounded-square tile with the Ember radial gradient and the mark in charcoal (`#1C1814`) at about 62% of the tile. Export 512, 192, 180 (Apple touch) and 32px. |
| Never | Stack the mark *on* the animated Ember in the UI. Presence and logo stay separate so the orb can move freely. |

## 6. Voice plan: decided

| | Choice |
|---|---|
| **Provider** | **ElevenLabs**, one flat monthly plan covering both speaking (TTS) and listening (speech-to-text, "Scribe"). Start on **Starter (about $6/mo)** and move to **Creator (about $22/mo)** only if you hit the monthly credit cap. Prices are from 2026 third-party summaries; confirm at elevenlabs.io/pricing. |
| **Keeping it one price** | In the ElevenLabs dashboard, make sure **usage-based overage billing is off** so hitting the cap *stops* rather than charges (**verify this setting exists on your tier**). In-app, `/api/voice/tts` checks the remaining quota and falls back to the free device voice when it's low, with a quiet note in the trace. |
| **Stretching credits** | Use ElevenLabs' faster, cheaper "Flash/Turbo" model for chat replies (check the current credit rate per character). Speak only the reply, never the margin notes. Cap spoken length in voice mode (the persona already asks for 2–3 sentences). |
| **Rough budget** | About 1 credit per character on standard models, so a 300-character reply is about 300 credits. Starter's ~30k credits is roughly 100 spoken replies a month. Speech-to-text costs ~330 credits per audio minute (**verify**). If you talk to her daily, expect Creator. |
| **Free fallback on your PC** | **Microsoft Edge on Windows** exposes Microsoft's neural "Online (Natural)" voices (for example Sonia and Libby, both British) through the browser speech API, at no cost. `voice.ts` already prefers "natural" and those names (`voice.ts:61-97`). Not available on the iPad. |
| **Voice choice** | Pick a British female voice from the ElevenLabs library by ear. Store its `ELEVENLABS_VOICE_ID` as an env var so it can change without a deploy. |
| **New env vars** | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL` (all server-only) |

## 7. Decisions log

| # | Question | Decision (13 Oct 2026) |
|---|---|---|
| D1 | Voice provider and budget | **ElevenLabs, flat plan**, Starter first (§6) |
| D2 | Greet out loud on open | Yes, at most once every 4 hours (default, not objected to) |
| D3 | Form of address | **Your name**, via `WREN_USER_NAME`. Drop the separate "address" setting from M2. |
| D4 | Theme | Auto by sunset, with an override (default) |
| D5 | Signature | **Ember as presence plus a sleek wren as the mark** (§5) |
