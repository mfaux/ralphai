/**
 * Tests for computeEffectiveSandbox() — the runner-time Docker fallback logic.
 *
 * This function re-checks Docker availability at runner start and decides
 * whether to fall back to "none" (auto-detected) or hard-fail (explicit).
 */
import { describe, it, expect } from "bun:test";
import { computeEffectiveSandbox } from "./config.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dockerAvailable = () => ({ available: true as const });
const dockerUnavailable =
  (error = "Docker daemon is not running.") =>
  () => ({
    available: false as const,
    error,
  });

// ---------------------------------------------------------------------------
// sandbox = "none" — no Docker check needed
// ---------------------------------------------------------------------------

describe("computeEffectiveSandbox — sandbox=none", () => {
  it("returns 'none' regardless of Docker availability", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "none" },
      "default",
      dockerAvailable,
    );
    expect(result).toEqual({ sandbox: "none" });
  });

  it("skips Docker check entirely when sandbox is 'none'", () => {
    let checkCalled = false;
    computeEffectiveSandbox({ sandbox: "none" }, "config", () => {
      checkCalled = true;
      return { available: true };
    });
    expect(checkCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sandbox = "docker", Docker available
// ---------------------------------------------------------------------------

describe("computeEffectiveSandbox — docker available", () => {
  it("returns 'docker' when Docker is available (auto-detected source)", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "auto-detected",
      dockerAvailable,
    );
    expect(result).toEqual({ sandbox: "docker" });
  });

  it("returns 'docker' when Docker is available (explicit config source)", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "config",
      dockerAvailable,
    );
    expect(result).toEqual({ sandbox: "docker" });
  });

  it("returns 'docker' when Docker is available (cli source)", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "cli",
      dockerAvailable,
    );
    expect(result).toEqual({ sandbox: "docker" });
  });
});

// ---------------------------------------------------------------------------
// sandbox = "docker", Docker unavailable, auto-detected — silent fallback
// ---------------------------------------------------------------------------

describe("computeEffectiveSandbox — auto-detected fallback", () => {
  it("falls back to 'none' when auto-detected and Docker unavailable", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "auto-detected",
      dockerUnavailable(),
    );
    expect(result).toEqual({ sandbox: "none" });
  });

  it("does not include an error on silent fallback", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "auto-detected",
      dockerUnavailable("Docker daemon is not running."),
    );
    expect(result.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sandbox = "docker", Docker unavailable, explicit — hard error
// ---------------------------------------------------------------------------

describe("computeEffectiveSandbox — explicit source errors", () => {
  it("returns error when config source and Docker unavailable", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "config",
      dockerUnavailable("Docker daemon is not running."),
    );
    expect(result.sandbox).toBe("docker");
    expect(result.error).toBe("Docker daemon is not running.");
  });

  it("returns error when env source and Docker unavailable", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "env",
      dockerUnavailable("Docker is not installed."),
    );
    expect(result.sandbox).toBe("docker");
    expect(result.error).toBe("Docker is not installed.");
  });

  it("returns error when cli source and Docker unavailable", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "cli",
      dockerUnavailable("Docker not found."),
    );
    expect(result.sandbox).toBe("docker");
    expect(result.error).toBe("Docker not found.");
  });

  it("returns fallback error message when checkDocker provides no error", () => {
    const result = computeEffectiveSandbox(
      { sandbox: "docker" },
      "config",
      () => ({ available: false }),
    );
    expect(result.error).toBe("Docker is not available.");
  });
});
