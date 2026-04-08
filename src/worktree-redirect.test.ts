import { describe, it, expect } from "bun:test";
import { runCliInProcess, useTempGitDir } from "./test-utils.ts";

describe("ralphai worktree (removed subcommand redirects)", () => {
  const ctx = useTempGitDir();

  it("worktree clean redirects to ralphai clean --worktrees", async () => {
    const result = await runCliInProcess(["worktree", "clean"], ctx.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ralphai clean --worktrees");
    expect(result.stderr).not.toContain("not set up");
  });

  it("worktree list redirects to ralphai status", async () => {
    const result = await runCliInProcess(["worktree", "list"], ctx.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ralphai status");
    expect(result.stderr).not.toContain("not set up");
  });

  it("worktree (bare) prints helpful summary of replacements", async () => {
    const result = await runCliInProcess(["worktree"], ctx.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ralphai clean --worktrees");
    expect(result.stderr).toContain("ralphai status");
    expect(result.stderr).not.toContain("not set up");
  });

  it("worktree --help prints redirect guidance", async () => {
    const result = await runCliInProcess(["worktree", "--help"], ctx.dir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ralphai clean --worktrees");
    expect(result.stderr).toContain("ralphai status");
    expect(result.stderr).not.toContain("not set up");
  });
});
