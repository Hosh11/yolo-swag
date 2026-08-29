"use client";

import { useRef, useState } from "react";

export default function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
    ref.current?.focus();
  }

  return (
    <div className="shrink-0 border-t border-ink-line py-4">
      <div className="flex items-end gap-3 rounded-2xl border border-ink-line bg-ink-soft px-4 py-3 focus-within:border-paper-faint/60">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={disabled ? "…" : "What are we doing?"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a newline. Capture should be one keypress.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-48 flex-1 resize-none bg-transparent text-[0.9375rem] leading-relaxed text-paper outline-none placeholder:text-paper-faint disabled:opacity-50"
        />
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
