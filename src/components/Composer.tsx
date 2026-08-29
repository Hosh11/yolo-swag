"use client";

import { useRef, useState } from "react";
import { useDictation } from "@/lib/voice";

export default function Composer({
  onSend,
  disabled,
  voiceEnabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
  voiceEnabled: boolean;
}) {
  const [value, setValue] = useState("");
  const [interim, setInterim] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const dictation = useDictation({
    onInterim: setInterim,
    onFinal: (text) => {
      setInterim("");
      setValue((current) => (current ? `${current.trimEnd()} ${text.trim()}` : text.trim()));
      ref.current?.focus();
    },
  });

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    setInterim("");
    onSend(text);
    ref.current?.focus();
  }

  // Dictation fills the box; it deliberately does not auto-send. Transcription
  // is wrong often enough that firing off a misheard sentence costs more than
  // the extra keypress saves.
  const showMic = voiceEnabled && dictation.supported;

  return (
    <div className="shrink-0 border-t border-ink-line py-4">
      <div className="flex items-end gap-3 rounded-2xl border border-ink-line bg-ink-soft px-4 py-3 focus-within:border-paper-faint/60">
        <textarea
          ref={ref}
          rows={1}
          value={interim ? `${value}${value ? " " : ""}${interim}` : value}
          disabled={disabled}
          placeholder={
            disabled ? "…" : dictation.listening ? "Listening…" : "What are we doing?"
          }
          onChange={(e) => {
            setInterim("");
            setValue(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. Capture should be one keypress.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-48 flex-1 resize-none bg-transparent text-[0.9375rem] leading-relaxed text-paper outline-none placeholder:text-paper-faint disabled:opacity-50"
        />

        {showMic && (
          <button
            type="button"
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
            disabled={disabled}
            aria-label={dictation.listening ? "Stop dictating" : "Dictate"}
            aria-pressed={dictation.listening}
            className={`shrink-0 rounded-lg px-2 py-1 text-base transition disabled:opacity-30 ${
              dictation.listening ? "breathe text-ember" : "text-paper-dim hover:text-paper"
            }`}
          >
            ●
          </button>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={disabled || value.trim().length === 0}
          className="shrink-0 rounded-lg px-2 py-1 text-xs tracking-wide text-paper-dim transition hover:text-ember disabled:opacity-30 disabled:hover:text-paper-dim"
        >
          send
        </button>
      </div>
    </div>
  );
}
