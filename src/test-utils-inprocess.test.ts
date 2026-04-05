import { describe, it, expect } from "bun:test";
import {
  runCliInProcess,
  runCliOutputInProcess,
  useTempDir,
} from "./test-utils.ts";

describe("runCliInProcess", () => {
  const ctx = useTempDir();

  it("--help returns exit code 0 with Usage in stdout", async () => {
    const result = await runCliInProcess(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage");
  });

  it("status in a non-initialized dir returns non-zero exit code", async () => {
    const result = await runCliInProcess(["status", "--once"], ctx.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("not set up");
  });

  it("restores process.cwd after call with cwd override", async () => {
    const before = process.cwd();
    await runCliInProcess(["--help"], ctx.dir);
    expect(process.cwd()).toBe(before);
  });

  it("restores console.log and console.error after call", async () => {
    const origLog = console.log;
    const origError = console.error;
    await runCliInProcess(["--help"]);
    expect(console.log).toBe(origLog);
    expect(console.error).toBe(origError);
  });
});

describe("runCliOutputInProcess", () => {
  it("returns stdout for --help", async () => {
    const output = await runCliOutputInProcess(["--help"]);
    expect(output).toContain("Usage");
  });
});
