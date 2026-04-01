import { describe, it, expect } from "bun:test";
import { runCli } from "./test-utils.ts";

describe("removed command guidance", () => {
  it("ralphai prd prints guidance pointing to ralphai run", () => {
    const result = runCli(["prd"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'prd'");
    expect(result.stderr).toContain("ralphai run");
  });

  it("ralphai prd 42 includes the issue number in guidance", () => {
    const result = runCli(["prd", "42"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'prd'");
    expect(result.stderr).toContain("ralphai run 42");
  });

  it("ralphai purge prints guidance pointing to ralphai clean --archive", () => {
    const result = runCli(["purge"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'purge'");
    expect(result.stderr).toContain("ralphai clean --archive");
  });

  it("ralphai teardown prints guidance pointing to ralphai uninstall", () => {
    const result = runCli(["teardown"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'teardown'");
    expect(result.stderr).toContain("ralphai uninstall");
  });

  it("ralphai backlog-dir prints guidance pointing to ralphai config backlog-dir", () => {
    const result = runCli(["backlog-dir"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'backlog-dir'");
    expect(result.stderr).toContain("ralphai config backlog-dir");
  });

  it("ralphai check prints guidance pointing to ralphai config --check", () => {
    const result = runCli(["check"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'check'");
    expect(result.stderr).toContain("ralphai config --check");
  });

  it("ralphai worktree prints guidance pointing to ralphai status", () => {
    const result = runCli(["worktree"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'worktree'");
    expect(result.stderr).toContain("ralphai status");
  });

  it("ralphai worktree list prints guidance pointing to ralphai status", () => {
    const result = runCli(["worktree", "list"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'worktree'");
    expect(result.stderr).toContain("ralphai status");
  });
});

describe("removed run flag guidance", () => {
  it("ralphai run --continuous prints guidance about drain-by-default and --once", () => {
    const result = runCli(["run", "--continuous"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--continuous'");
    expect(result.stderr).toContain("--once");
  });

  it("ralphai run --prd=42 prints guidance pointing to ralphai run <number>", () => {
    const result = runCli(["run", "--prd=42"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--prd'");
    expect(result.stderr).toContain("ralphai run 42");
  });

  it("ralphai run --issue-source=github prints guidance about config-only issue settings", () => {
    const result = runCli(["run", "--issue-source=github"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--issue-source'");
    expect(result.stderr).toContain("config-only");
  });

  it("ralphai run --issue-label=ralphai prints guidance about config-only issue settings", () => {
    const result = runCli(["run", "--issue-label=ralphai"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--issue-label'");
    expect(result.stderr).toContain("config-only");
  });

  it("ralphai run --issue-in-progress-label=wip prints guidance about config-only settings", () => {
    const result = runCli(["run", "--issue-in-progress-label=wip"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--issue-in-progress-label'");
    expect(result.stderr).toContain("config-only");
  });

  it("ralphai run --issue-done-label=done prints guidance about config-only settings", () => {
    const result = runCli(["run", "--issue-done-label=done"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--issue-done-label'");
    expect(result.stderr).toContain("config-only");
  });

  it("ralphai run --issue-repo=owner/repo prints guidance about config-only settings", () => {
    const result = runCli(["run", "--issue-repo=owner/repo"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--issue-repo'");
    expect(result.stderr).toContain("config-only");
  });

  it("ralphai run --issue-comment-progress=true prints guidance about config-only settings", () => {
    const result = runCli(["run", "--issue-comment-progress=true"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown flag '--issue-comment-progress'");
    expect(result.stderr).toContain("config-only");
  });
});
