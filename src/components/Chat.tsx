"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StreamEvent } from "@/lib/agent/types";
import Composer from "./Composer";
import ToolTrace, { type TraceStep } from "./ToolTrace";

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

  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/state")
      .then((r) => r.json())
      .then((data) => {
        setName(data.name);
        setStreak(data.streak);
        setTurns(
          data.messages.map((m: Turn) => ({ id: m.id, role: m.role, text: m.text })),
        );
      })
      .catch(() => setError("Couldn't reach the server."));
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

      const collected: TraceStep[] = [];
      let streamed = "";

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text }),
        });

        if (!response.ok || !response.body) {
          throw new Error(`Request failed (${response.status}).`);
        }

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
                break;
              case "error":
                setError(event.message);
                break;
            }
          }
        }
      } catch (caught) {
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
    [],
  );

  const empty = turns.length === 0 && !busy;

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col px-5">
      <header className="flex shrink-0 items-baseline justify-between border-b border-ink-line py-4">
        <h1 className="prose-wren text-lg tracking-wide text-paper">Wren</h1>
        {streak && (
          <p className="text-xs text-paper-faint tabular-nums">
            {streak.current > 0 ? `${streak.current}-day streak` : "no streak going"}
            <span className="mx-2 text-ink-line">/</span>
            {streak.wordsToday.toLocaleString()} today
            <span className="mx-2 text-ink-line">/</span>
            {streak.wordsLast7.toLocaleString()} this week
          </p>
        )}
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

      <Composer onSend={send} disabled={busy} />
    </div>
  );
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
