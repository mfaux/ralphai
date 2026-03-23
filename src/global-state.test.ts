import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { useTempDir, useTempGitDir } from "./test-utils.ts";
import {
  getRalphaiHome,
  getRepoId,
  getRepoStateDir,
  getRepoPipelineDirs,
  getRepoLearningsPath,
  getRepoCandidatesPath,
} from "./global-state.ts";

describe("getRalphaiHome", () => {
  it("returns $RALPHAI_HOME when set", () => {
    expect(getRalphaiHome({ RALPHAI_HOME: "/custom/home" })).toBe(
      "/custom/home",
    );
  });

  it("returns ~/.ralphai when RALPHAI_HOME is not set", () => {
    expect(getRalphaiHome({})).toBe(join(homedir(), ".ralphai"));
  });

  it("ignores empty RALPHAI_HOME", () => {
    expect(getRalphaiHome({ RALPHAI_HOME: "" })).toBe(
      join(homedir(), ".ralphai"),
    );
  });
});

describe("getRepoId", () => {
  const ctx = useTempGitDir();

  it("slugifies an HTTPS remote URL", () => {
    execSync('git remote add origin "https://github.com/mfaux/ralphai.git"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });

  it("slugifies an SSH remote URL", () => {
    execSync('git remote add origin "git@github.com:mfaux/ralphai.git"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });

  it("falls back to _path-<hash> when no remote exists", () => {
    const id = getRepoId(ctx.dir);
    expect(id).toMatch(/^_path-[a-f0-9]{12}$/);
  });

  it("produces stable path-based IDs for the same directory", () => {
    const id1 = getRepoId(ctx.dir);
    const id2 = getRepoId(ctx.dir);
    expect(id1).toBe(id2);
  });

  it("slugifies ssh:// protocol URLs", () => {
    execSync('git remote add origin "ssh://git@github.com/mfaux/ralphai.git"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });

  it("handles URLs without .git suffix", () => {
    execSync('git remote add origin "https://github.com/mfaux/ralphai"', {
      cwd: ctx.dir,
      stdio: "ignore",
    });
    expect(getRepoId(ctx.dir)).toBe("github-com-mfaux-ralphai");
  });
});

describe("getRepoStateDir", () => {
  const ctx = useTempDir();

  it("creates the repo state directory under RALPHAI_HOME", () => {
    const home = join(ctx.dir, "ralphai-home");
    const dir = getRepoStateDir(ctx.dir, { RALPHAI_HOME: home });
    expect(dir).toMatch(new RegExp(`^${home.replace(/[/\\]/g, ".")}`));
    expect(existsSync(dir)).toBe(true);
  });

  it("nests under repos/<repoId>", () => {
    const home = join(ctx.dir, "ralphai-home");
    const dir = getRepoStateDir(ctx.dir, { RALPHAI_HOME: home });
    expect(dir).toContain(join("repos", "_path-"));
  });
});

describe("getRepoPipelineDirs", () => {
  const ctx = useTempDir();

  it("creates backlog, in-progress, and out directories", () => {
    const home = join(ctx.dir, "ralphai-home");
    const dirs = getRepoPipelineDirs(ctx.dir, { RALPHAI_HOME: home });
    expect(existsSync(dirs.backlogDir)).toBe(true);
    expect(existsSync(dirs.wipDir)).toBe(true);
    expect(existsSync(dirs.archiveDir)).toBe(true);
    expect(dirs.backlogDir).toContain(join("pipeline", "backlog"));
    expect(dirs.wipDir).toContain(join("pipeline", "in-progress"));
    expect(dirs.archiveDir).toContain(join("pipeline", "out"));
  });
});

describe("getRepoLearningsPath", () => {
  const ctx = useTempDir();

  it("returns LEARNINGS.md inside the repo state dir", () => {
    const home = join(ctx.dir, "ralphai-home");
    const p = getRepoLearningsPath(ctx.dir, { RALPHAI_HOME: home });
    expect(p).toMatch(/LEARNINGS\.md$/);
    expect(p.startsWith(home)).toBe(true);
  });
});

describe("getRepoCandidatesPath", () => {
  const ctx = useTempDir();

  it("returns LEARNING_CANDIDATES.md inside the repo state dir", () => {
    const home = join(ctx.dir, "ralphai-home");
    const p = getRepoCandidatesPath(ctx.dir, { RALPHAI_HOME: home });
    expect(p).toMatch(/LEARNING_CANDIDATES\.md$/);
    expect(p.startsWith(home)).toBe(true);
  });
});
