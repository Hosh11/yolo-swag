"use client";

export interface TraceStep {
  id: string;
  label: string;
  state: "running" | "done" | "failed";
}

/**
 * The quiet line under Wren showing what she's actually doing. Deliberately
 * understated — the point is reassurance that something is happening, not a
 * debug log.
 */
export default function ToolTrace({ steps }: { steps: TraceStep[] }) {
  if (steps.length === 0) return null;

  return (
    <ul className="mb-3 space-y-1">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`flex items-center gap-2 text-xs ${
            step.state === "running" ? "breathe text-ember" : "text-paper-faint"
          }`}
        >
          <span aria-hidden className="text-[0.6rem]">
            {step.state === "failed" ? "×" : step.state === "done" ? "·" : "○"}
          </span>
          {step.label}
        </li>
      ))}
    </ul>
  );
}
