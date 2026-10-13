import { afterEach, describe, expect, it } from "vitest";
import { env, timeZone } from "@/lib/env";

afterEach(() => {
  delete process.env.WREN_TEST_VAR;
});

describe("env()", () => {
  it("treats a blank or whitespace value as unset", () => {
    process.env.WREN_TEST_VAR = "";
    expect(env("WREN_TEST_VAR")).toBeUndefined();
    process.env.WREN_TEST_VAR = "   ";
    expect(env("WREN_TEST_VAR")).toBeUndefined();
  });

  it("returns undefined when never set", () => {
    expect(env("WREN_TEST_VAR")).toBeUndefined();
  });

  it("returns the trimmed value otherwise", () => {
    process.env.WREN_TEST_VAR = "  hello ";
    expect(env("WREN_TEST_VAR")).toBe("hello");
  });
});

describe("timeZone()", () => {
  it("uses a valid IANA zone", () => {
    process.env.WREN_TEST_VAR = "Europe/London";
    expect(timeZone("WREN_TEST_VAR")).toBe("Europe/London");
  });

  it("falls back on a bad zone instead of throwing", () => {
    process.env.WREN_TEST_VAR = "Mars/Olympus_Mons";
    expect(timeZone("WREN_TEST_VAR")).toBe("UTC");
    expect(timeZone("WREN_TEST_VAR", "Europe/London")).toBe("Europe/London");
  });

  it("falls back when blank", () => {
    process.env.WREN_TEST_VAR = "";
    expect(timeZone("WREN_TEST_VAR")).toBe("UTC");
  });
});
