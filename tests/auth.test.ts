import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authState,
  checkPassphrase,
  createSessionToken,
  requireSession,
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth";
import { classifyPath } from "@/lib/auth-paths";

const DAY = 86_400_000;

beforeEach(() => {
  vi.stubEnv("WREN_PASSPHRASE", "correct horse");
  vi.stubEnv("WREN_SESSION_SECRET", "a".repeat(44));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session tokens", () => {
  it("round-trips", async () => {
    expect(await verifySessionToken(await createSessionToken())).toBe(true);
  });

  it("rejects a tampered signature", async () => {
    const token = await createSessionToken();
    const flipped = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(await verifySessionToken(flipped)).toBe(false);
  });

  it("rejects a forged expiry carrying an old signature", async () => {
    const token = await createSessionToken();
    const signature = token.slice(token.indexOf(".") + 1);
    const forged = `${Date.now() + 365 * DAY}.${signature}`;
    expect(await verifySessionToken(forged)).toBe(false);
  });

  it("rejects an expired token", async () => {
    const token = await createSessionToken(Date.now() - 31 * DAY);
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("accepts a token that is still inside its 30 days", async () => {
    const token = await createSessionToken(Date.now() - 29 * DAY);
    expect(await verifySessionToken(token)).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken();
    vi.stubEnv("WREN_SESSION_SECRET", "b".repeat(44));
    expect(await verifySessionToken(token)).toBe(false);
  });

  it("rejects junk and empty input", async () => {
    for (const bad of ["", "nodot", ".sig", "abc.def", undefined, null]) {
      expect(await verifySessionToken(bad)).toBe(false);
    }
  });
});

describe("checkPassphrase()", () => {
  it("accepts the right one and rejects the wrong ones", async () => {
    expect(await checkPassphrase("correct horse")).toBe(true);
    expect(await checkPassphrase("correct hors")).toBe(false);
    expect(await checkPassphrase("")).toBe(false);
  });

  it("rejects everything when no passphrase is configured", async () => {
    vi.stubEnv("WREN_PASSPHRASE", "");
    expect(await checkPassphrase("")).toBe(false);
  });
});

describe("authState() and requireSession()", () => {
  const request = (cookie?: string) =>
    new Request("http://localhost/api/state", { headers: cookie ? { cookie } : {} });

  it("is enforced when both are set, and 401s without a cookie", async () => {
    expect(authState()).toBe("enforced");
    expect((await requireSession(request()))?.status).toBe(401);
  });

  it("lets a valid cookie through", async () => {
    const token = await createSessionToken();
    expect(await requireSession(request(`other=1; ${SESSION_COOKIE}=${token}`))).toBeNull();
  });

  it("is open in dev with both unset", async () => {
    vi.stubEnv("WREN_PASSPHRASE", "");
    vi.stubEnv("WREN_SESSION_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(authState()).toBe("open");
    expect(await requireSession(request())).toBeNull();
  });

  it("fails closed with a 503 in production when unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WREN_PASSPHRASE", "");
    vi.stubEnv("WREN_SESSION_SECRET", "");
    expect(authState()).toBe("misconfigured");
    expect((await requireSession(request()))?.status).toBe(503);
  });

  it("fails closed when only one of the two is set, even in dev", async () => {
    vi.stubEnv("WREN_SESSION_SECRET", "");
    expect((await requireSession(request()))?.status).toBe(503);
  });
});

describe("classifyPath()", () => {
  it("lets login, auth and cron through", () => {
    for (const p of ["/login", "/api/auth/login", "/api/auth/logout", "/api/cron/checkin"]) {
      expect(classifyPath(p)).toBe("public");
    }
  });

  it("treats other /api paths as api", () => {
    for (const p of ["/api/chat", "/api/state"]) expect(classifyPath(p)).toBe("api");
  });

  it("treats everything else as a page", () => {
    expect(classifyPath("/")).toBe("page");
    expect(classifyPath("/settings")).toBe("page");
  });

  it("does not let look-alike prefixes through", () => {
    expect(classifyPath("/loginfoo")).toBe("page");
    expect(classifyPath("/api/authx")).toBe("api");
    expect(classifyPath("/api/cronjobs")).toBe("api");
  });
});
