"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !passphrase) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (response.ok) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload on purpose, so the page is rendered fresh with the new cookie
        window.location.href = "/";
        return;
      }
      const body = await response.json().catch(() => null);
      setError(typeof body?.error === "string" ? body.error : `The server returned ${response.status}.`);
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-full items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <p className="prose-wren text-paper">Who goes there?</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          className="w-full rounded-lg border border-ink-line bg-ink-soft px-4 py-3 text-paper placeholder:text-paper-faint focus:border-ember focus:outline-none"
        />
        {error && <p className="text-sm text-ember">{error}</p>}
        <button
          type="submit"
          disabled={busy || !passphrase}
          className="w-full rounded-lg bg-ember px-4 py-3 font-medium text-ink disabled:opacity-40"
        >
          {busy ? "One moment…" : "Come in"}
        </button>
      </form>
    </main>
  );
}
