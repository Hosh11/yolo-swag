"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamEvent } from "@/lib/agent/types";
import Composer from "./Composer";
import ToolTrace, { type TraceStep } from "./ToolTrace";
import { speechSupported, useSpeaker } from "@/lib/voice";

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps?: TraceStep[];
}

interface Streak {
  current: number;
  wordsToday: number;
  wordsLast7: number;
}

export default function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draftText, setDraftText] = useState("");
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [streak, setStreak] = useState<Streak | null>(null);
  const [voice, setVoice] = useState(false);
  // Feature detection has to happen after mount: the server has no `window`,
  // so testing it during render renders a different tree than the client and
  // React throws a hydration mismatch.
  const [canSpeak, setCanSpeak] = useState(false);

  const bottom = useRef<HTMLDivElement>(null);
  const speaker = useSpeaker(voice);

  // Restore the voice preference before the first reply can arrive.
  useEffect(() => {
    setCanSpeak(speechSupported());
    try {
      setVoice(window.localStorage.getItem("wren:voice") === "on");
    } catch {
      // Private browsing and blocked site data both throw here; silence is fine.
    }
  }, []);

  const toggleVoice = useCallback(() => {
    const next = !voice;
    setVoice(next);
    try {
      window.localStorage.setItem("wren:voice", next ? "on" : "off");
    } catch {
      // Preference just won't persist; the toggle still works this session.
    }
    // Must run synchronously, right here in the tap — not in the state
    // updater above, and not after any await. See speakNow's comment.
    if (next) speaker.speakNow("Voice on.");
  }, [voice, speaker]);

  useEffect(() => {
    // `deliver=1` flushes anything the scheduler queued into the conversation.
    (async () => {
      try {
        const response = await fetch("/api/state?deliver=1");
        if (!response.ok) {
          setError(await serverError(response));
          return;
        }
        const data = await response.json();
        setName(data.name);
        setStreak(data.streak);
        setTurns(
          data.messages.map((m: Turn) => ({ id: m.id, role: m.role, text: m.text })),
        );
      } catch {
        // Only a genuine transport failure reaches here now — a served error
        // carries its own message and is reported above.
        setError("Couldn't reach the server. Check your connection.");
      }
    })();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, draftText, steps]);

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      setSteps([]);
      setDraftText("");
      setTurns((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: "user", text },
      ]);

      // Barge-in: a new message means stop reading the last one aloud.
      speaker.cancel();

      const collected: TraceStep[] = [];
      let streamed = "";

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        if (!response.ok) throw new Error(await serverError(response));
        if (!response.body) throw new Error("The server sent an empty response.");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5).trim()) as StreamEvent;

            switch (event.type) {
              case "thinking":
                setThinking(true);
                break;
              case "text":
                setThinking(false);
                streamed += event.delta;
                setDraftText(streamed);
                speaker.push(event.delta);
                break;
              case "tool_start":
                collected.push({ id: event.id, label: event.label, state: "running" });
                setSteps([...collected]);
                break;
              case "tool_end": {
                const step = collected.find((s) => s.id === event.id);
                if (step) step.state = event.ok ? "done" : "failed";
                setSteps([...collected]);
                break;
              }
              case "done":
                streamed = event.text || streamed;
                speaker.flush();
                break;
              case "error":
                setError(event.message);
                break;
            }
          }
        }
      } catch (caught) {
        speaker.cancel();
        setError(caught instanceof Error ? caught.message : "Something broke.");
      } finally {
        setThinking(false);
        setBusy(false);
        setDraftText("");
        setSteps([]);
        if (streamed.trim()) {
          setTurns((prev) => [
            ...prev,
            {
              id: `wren-${Date.now()}`,
              role: "assistant",
              text: streamed,
              steps: collected.length > 0 ? collected : undefined,
            },
          ]);
        }
        fetch("/api/state")
          .then((r) => r.json())
          .then((data) => setStreak(data.streak))
          .catch(() => {});
      }
    },
    [speaker],
  );

  const empty = turns.length === 0 && !busy;

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col px-5">
      <header className="flex shrink-0 items-baseline justify-between border-b border-ink-line py-4">
        <h1 className="prose-wren text-lg tracking-wide text-paper">Wren</h1>
        <div className="flex items-center gap-4">
          {streak && (
            <p className="text-xs text-paper-faint tabular-nums">
              {streak.current > 0 ? `${streak.current}-day streak` : "no streak going"}
              <span className="mx-2 text-ink-line">/</span>
              {streak.wordsToday.toLocaleString()} today
              <span className="mx-2 text-ink-line">/</span>
              {streak.wordsLast7.toLocaleString()} this week
            </p>
          )}
          {canSpeak && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-pressed={voice}
              title={voice ? "Voice on — Wren reads replies aloud" : "Voice off"}
              className={`rounded-lg border px-2 py-1 text-xs tracking-wide transition ${
                voice
                  ? "border-ember/40 text-ember"
                  : "border-ink-line text-paper-faint hover:text-paper-dim"
              } ${speaker.speaking ? "breathe" : ""}`}
            >
              voice {voice ? "on" : "off"}
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto py-8">
        {empty && (
          <p className="prose-wren mt-16 text-center text-paper-faint">
            {name ? `Morning, ${name}.` : "Ready when you are."}
          </p>
        )}

        {turns.map((turn) =>
          turn.role === "user" ? (
            <div key={turn.id} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-ink-soft px-4 py-2.5 text-[0.9375rem] leading-relaxed text-paper/90">
                {turn.text}
              </p>
            </div>
          ) : (
            <div key={turn.id}>
              {turn.steps && <ToolTrace steps={turn.steps} />}
              <Says text={turn.text} />
            </div>
          ),
        )}

        {(steps.length > 0 || thinking || draftText) && (
          <div>
            {steps.length > 0 && <ToolTrace steps={steps} />}
            {thinking && !draftText && (
              <p className="breathe text-xs text-paper-faint">thinking…</p>
            )}
            {draftText && <Says text={draftText} />}
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div ref={bottom} />
      </div>

      <Composer onSend={send} disabled={busy} voiceEnabled={voice} />
    </div>
  );
}

/**
 * Pull the server's own explanation out of a failed response.
 *
 * Collapsing every failure into one generic line hides exactly the message
 * that says what to fix — which is the whole point of the errors the API
 * routes raise.
 */
async function serverError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Not JSON — an edge-level failure, say. Fall back to the status.
  }
  return `The server returned ${response.status} ${response.statusText}.`.trim();
}

/** Wren's own words, split on blank lines so paragraphs breathe. */
function Says({ text }: { text: string }) {
  return (
    <div className="prose-wren text-paper">
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </div>
  );
}
