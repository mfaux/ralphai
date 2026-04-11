/**
 * Tests for hooks.beforeRun, hooks.afterRun, and hooks.feedbackTimeout
 * lifecycle hooks.
 *
 * Tests the runtime wiring: feedback-wrapper timeout plumbing,
 * completion-gate timeout plumbing, scope-resolved beforeRun workspace
 * overrides, and show-config display of the new keys.
 *
 * Full E2E runner tests for beforeRun/afterRun execution are covered
 * separately; this file covers the unit-level contracts.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

import {
  generateFeedbackWrapper,
  writeFeedbackWrapper,
  DEFAULT_TIMEOUT_SECONDS,
} from "./feedback-wrapper.ts";
import { runFeedbackCommands } from "./completion-gate.ts";
import { resolveScope } from "./scope.ts";
import { DEFAULTS } from "./config.ts";
import { formatShowConfig, type FormatShowConfigInput } from "./show-config.ts";
import { makeTestResolvedConfig, useTempDir } from "./test-utils.ts";

// ---------------------------------------------------------------------------
// hooks.feedbackTimeout — feedback wrapper
// ---------------------------------------------------------------------------

describe("hooks.feedbackTimeout — feedback wrapper", () => {
  const ctx = useTempDir();

  it("DEFAULT_TIMEOUT_SECONDS is 300", () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(300);
  });

  it("generateFeedbackWrapper uses default timeout when none provided", () => {
    const script = generateFeedbackWrapper(["bun test"]);
    expect(script).toContain("TIMEOUT_SECONDS=300");
  });

  it("generateFeedbackWrapper accepts custom timeout", () => {
    const script = generateFeedbackWrapper(["bun test"], 600);
    expect(script).toContain("TIMEOUT_SECONDS=600");
    expect(script).not.toContain("TIMEOUT_SECONDS=300");
  });

  it("generateFeedbackWrapper accepts timeout=0", () => {
    const script = generateFeedbackWrapper(["bun test"], 0);
    expect(script).toContain("TIMEOUT_SECONDS=0");
  });

  it("writeFeedbackWrapper passes timeout to generated script", () => {
    if (process.platform === "win32") return;

    writeFeedbackWrapper(ctx.dir, ["echo ok"], 120);

    const script = readFileSync(join(ctx.dir, "_ralphai_feedback.sh"), "utf-8");
    expect(script).toContain("TIMEOUT_SECONDS=120");
  });

  it("writeFeedbackWrapper uses default timeout when none provided", () => {
    if (process.platform === "win32") return;

    writeFeedbackWrapper(ctx.dir, ["echo ok"]);

    const script = readFileSync(join(ctx.dir, "_ralphai_feedback.sh"), "utf-8");
    expect(script).toContain("TIMEOUT_SECONDS=300");
  });
});

// ---------------------------------------------------------------------------
// hooks.feedbackTimeout — completion gate
// ---------------------------------------------------------------------------

describe("hooks.feedbackTimeout — completion gate", () => {
  const ctx = useTempDir();

  it("runFeedbackCommands uses custom timeoutMs", () => {
    // Use a command that succeeds instantly — we're testing that the
    // timeout parameter is accepted, not that it actually times out.
    const results = runFeedbackCommands("echo ok", ctx.dir, "loop", 60_000);
    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).toBe(0);
  });

  it("runFeedbackCommands defaults to 300_000ms", () => {
    // Verifies the function works without an explicit timeout.
    const results = runFeedbackCommands("echo ok", ctx.dir);
    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).toBe(0);
  });

  it("runFeedbackCommands respects short timeout for slow command", () => {
    // Use a very short timeout (1ms) with a command that would take longer.
    const results = runFeedbackCommands("sleep 10", ctx.dir, "loop", 1);
    expect(results).toHaveLength(1);
    expect(results[0]!.exitCode).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// hooks.beforeRun — workspace override via resolveScope
// ---------------------------------------------------------------------------

describe("hooks.beforeRun — workspace override", () => {
  const ctx = useTempDir();

  it("returns rootBeforeRun when no workspace override", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root" }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/web": { feedbackCommands: ["bun test"] },
    });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "bun test",
      rootPrFeedbackCommands: "",
      rootBeforeRun: "docker compose up -d",
      workspacesConfig: wsConfig,
    });

    expect(result.beforeRun).toBe("docker compose up -d");
  });

  it("returns workspace beforeRun override when present", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root" }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/web": {
        feedbackCommands: ["bun test"],
        beforeRun: "docker compose -f web.yml up -d",
      },
    });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "bun test",
      rootPrFeedbackCommands: "",
      rootBeforeRun: "docker compose up -d",
      workspacesConfig: wsConfig,
    });

    expect(result.beforeRun).toBe("docker compose -f web.yml up -d");
  });

  it("returns empty workspace beforeRun override (clears root)", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root" }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const wsConfig = JSON.stringify({
      "packages/web": {
        feedbackCommands: ["bun test"],
        beforeRun: "",
      },
    });

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "bun test",
      rootPrFeedbackCommands: "",
      rootBeforeRun: "docker compose up -d",
      workspacesConfig: wsConfig,
    });

    // Empty string overrides root value
    expect(result.beforeRun).toBe("");
  });

  it("returns undefined beforeRun when no scope", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root" }),
    );

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "",
      rootFeedbackCommands: "bun test",
      rootPrFeedbackCommands: "",
      rootBeforeRun: "docker compose up -d",
    });

    // No scope = pass-through, beforeRun not in result
    expect(result.beforeRun).toBeUndefined();
  });

  it("passes beforeRun through for unsupported ecosystems", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/mymod\n");

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "cmd/server",
      rootFeedbackCommands: "go test ./...",
      rootPrFeedbackCommands: "",
      rootBeforeRun: "make setup",
    });

    expect(result.beforeRun).toBe("make setup");
  });

  it("passes beforeRun through when no feedback commands to rewrite", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root" }),
    );
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const result = resolveScope({
      cwd: ctx.dir,
      planScope: "packages/web",
      rootFeedbackCommands: "",
      rootPrFeedbackCommands: "",
      rootBeforeRun: "make setup",
    });

    expect(result.beforeRun).toBe("make setup");
  });
});

// ---------------------------------------------------------------------------
// Config defaults
// ---------------------------------------------------------------------------

describe("hooks config defaults", () => {
  it("default beforeRun is empty string", () => {
    expect(DEFAULTS.hooks.beforeRun).toBe("");
  });

  it("default afterRun is empty string", () => {
    expect(DEFAULTS.hooks.afterRun).toBe("");
  });

  it("default feedbackTimeout is 300", () => {
    expect(DEFAULTS.hooks.feedbackTimeout).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// show-config display
// ---------------------------------------------------------------------------

describe("show-config displays new hook keys", () => {
  const defaultInput = (): FormatShowConfigInput => ({
    config: makeTestResolvedConfig(),
    configFilePath: "/home/user/.ralphai/repos/test-repo/config.json",
    configFileExists: false,
    envVars: {},
    rawFlags: {},
    workspaces: null,
  });

  it("shows hooks.beforeRun, hooks.afterRun, hooks.feedbackTimeout defaults", () => {
    const output = formatShowConfig(defaultInput());
    expect(output).toContain("hooks.beforeRun");
    expect(output).toContain("hooks.afterRun");
    expect(output).toContain("hooks.feedbackTimeout");
    expect(output).toContain("300s");
  });

  it("shows configured beforeRun value from env", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig({
      hooks: { beforeRun: "docker compose up -d" },
    });
    rc.hooks.beforeRun = { value: "docker compose up -d", source: "env" };
    input.config = rc;
    input.envVars = { RALPHAI_HOOKS_BEFORE_RUN: "docker compose up -d" };
    const output = formatShowConfig(input);
    expect(output).toContain("hooks.beforeRun");
    expect(output).toContain("docker compose up -d");
    expect(output).toContain("env");
  });

  it("shows configured afterRun value from config", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig({
      hooks: { afterRun: "docker compose down" },
    });
    rc.hooks.afterRun = { value: "docker compose down", source: "config" };
    input.config = rc;
    input.configFileExists = true;
    const output = formatShowConfig(input);
    expect(output).toContain("hooks.afterRun");
    expect(output).toContain("docker compose down");
  });

  it("shows custom feedbackTimeout value", () => {
    const input = defaultInput();
    const rc = makeTestResolvedConfig({
      hooks: { feedbackTimeout: 600 },
    });
    rc.hooks.feedbackTimeout = { value: 600, source: "cli" };
    input.config = rc;
    input.rawFlags = { "hooks-feedback-timeout": "600" };
    const output = formatShowConfig(input);
    expect(output).toContain("hooks.feedbackTimeout");
    expect(output).toContain("600s");
  });
});
