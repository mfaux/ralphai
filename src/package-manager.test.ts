import { describe, it, expect } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { runCli, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";

describe("package manager detection", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  it("detects pnpm from pnpm-lock.yaml and populates feedbackCommands", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        {
          name: "test",
          scripts: { build: "tsc", test: "vitest", lint: "eslint ." },
        },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([
      "pnpm build",
      "pnpm test",
      "pnpm lint",
    ]);
  });

  it("detects npm from package-lock.json and populates feedbackCommands", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        { name: "test", scripts: { build: "tsc", test: "jest" } },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual(["npm run build", "npm test"]);
  });

  it("detects yarn from yarn.lock and populates feedbackCommands", () => {
    writeFileSync(join(ctx.dir, "yarn.lock"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        {
          name: "test",
          scripts: { build: "tsc", test: "jest", lint: "eslint ." },
        },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([
      "yarn build",
      "yarn test",
      "yarn lint",
    ]);
  });

  it("detects bun from bun.lockb and populates feedbackCommands", () => {
    writeFileSync(join(ctx.dir, "bun.lockb"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        {
          name: "test",
          scripts: { build: "tsc", test: "bun test", lint: "eslint" },
        },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([
      "bun run build",
      "bun run test",
      "bun run lint",
    ]);
  });

  it("detects deno from deno.json and reads tasks", () => {
    writeFileSync(
      join(ctx.dir, "deno.json"),
      JSON.stringify(
        { tasks: { build: "deno compile", lint: "deno lint" } },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    // No test task in deno.json, but deno has a built-in test runner
    expect(parsed.feedbackCommands).toEqual([
      "deno task build",
      "deno task lint",
      "deno test",
    ]);
  });

  it("detects PM from packageManager field when no lock file exists", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        {
          name: "test",
          packageManager: "pnpm@9.0.0",
          scripts: { build: "tsc", test: "vitest" },
        },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual(["pnpm build", "pnpm test"]);
  });

  it("only includes scripts that actually exist in package.json", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", scripts: { test: "jest" } }, null, 2),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual(["npm test"]);
  });

  it("defaults feedbackCommands to empty array when no scripts exist", () => {
    // pnpm project with only "start" script → no feedback commands detected
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        { name: "test", scripts: { start: "node index.js" } },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([]);
  });

  it("defaults feedbackCommands to empty array for non-JS projects", () => {
    // No package.json, no deno.json — nothing to detect
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([]);
  });

  it("defaults feedbackCommands to empty array when no matching scripts detected", () => {
    // pnpm project with no matching scripts → feedbackCommands is empty array
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        { name: "test", scripts: { start: "node index.js" } },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([]);
  });

  it("feedbackCommands is empty array for non-JS projects (no package.json)", () => {
    // No package.json, no deno.json — nothing to detect
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([]);
  });

  it("feedbackCommands is empty array when no matching scripts detected", () => {
    // pnpm project with no matching scripts → feedbackCommands is empty array
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        { name: "test", scripts: { start: "node index.js" } },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([]);
  });

  it("detects type-check and format:check scripts", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        {
          name: "test",
          scripts: {
            build: "tsc",
            test: "vitest",
            "type-check": "tsc --noEmit",
            lint: "eslint .",
            "format:check": "prettier --check .",
          },
        },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    expect(parsed.feedbackCommands).toEqual([
      "pnpm build",
      "pnpm test",
      "pnpm type-check",
      "pnpm lint",
      "pnpm format:check",
    ]);
  });

  it("lock file takes priority over packageManager field", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify(
        {
          name: "test",
          packageManager: "yarn@4.0.0",
          scripts: { build: "tsc", test: "vitest" },
        },
        null,
        2,
      ),
    );

    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(config);
    // pnpm should win because lock file beats packageManager field
    expect(parsed.feedbackCommands).toEqual(["pnpm build", "pnpm test"]);
  });
});
