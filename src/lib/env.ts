/**
 * Environment variables, read the way deployment dashboards actually behave.
 *
 * `process.env.X ?? fallback` is wrong in hosted environments. `??` only
 * catches undefined, but a variable added in a dashboard and left blank — or
 * cleared later — arrives as an empty string, sails past the fallback, and
 * becomes a value nothing downstream expects. That has already produced two
 * separate production failures in this app: an empty DATABASE_URL that made
 * the driver dial localhost, and an empty WREN_MODEL that sent `model: ""` to
 * the API. Both looked like bugs a long way from the actual cause.
 *
 * Treating blank as absent is the behaviour every caller here wants.
 */
export function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * An IANA time zone, or the fallback if unset or unrecognised.
 *
 * A bad zone makes Intl throw a RangeError, and this feeds the day-boundary
 * arithmetic behind every state snapshot — so a typo in a dashboard would take
 * down every request rather than merely mis-dating a streak.
 */
export function timeZone(name: string, fallback = "UTC"): string {
  const configured = env(name);
  if (!configured) return fallback;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: configured });
    return configured;
  } catch {
    return fallback;
  }
}
