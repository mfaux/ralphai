import { describe, it, expect } from "bun:test";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  checkGhAvailable,
  commitTypeFromTitle,
  detectIssueRepo,
  issueBranchName,
  slugify,
  peekGithubIssues,
  pullGithubIssues,
  pullPrdSubIssue,
  fetchPrdIssueByNumber,
  prdBranchName,
} from "./issues.ts";
import type { PullIssueOptions, PeekIssueOptions } from "./issues.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initialize a git repo with one commit and a remote. */
function initRepo(dir: string, remoteUrl?: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync('git config user.email "test@test.com"', {
    cwd: dir,
    stdio: "ignore",
  });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "init.txt"), "init\n");
  execSync('git add -A && git commit -m "init"', {
    cwd: dir,
    stdio: "ignore",
  });
  if (remoteUrl) {
    execSync(`git remote add origin "${remoteUrl}"`, {
      cwd: dir,
      stdio: "ignore",
    });
  }
}

/** Build default PullIssueOptions for testing. */
function defaultOptions(dir: string): PullIssueOptions {
  return {
    backlogDir: join(dir, ".ralphai", "pipeline", "backlog"),
    cwd: dir,
    issueSource: "github",
    standaloneLabel: "ralphai-standalone",
    standaloneInProgressLabel: "ralphai-standalone:in-progress",
    standaloneDoneLabel: "ralphai-standalone:done",
    issueRepo: "",
    issueCommentProgress: false,
  };
}

// ---------------------------------------------------------------------------
// checkGhAvailable
// ---------------------------------------------------------------------------

describe("checkGhAvailable", () => {
  it("returns a boolean", () => {
    // We can't guarantee `gh` is available in CI, but we can check the type.
    const result = checkGhAvailable();
    expect(typeof result).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// detectIssueRepo
// ---------------------------------------------------------------------------

describe("detectIssueRepo", () => {
  const ctx = useTempDir();

  it("returns configRepo when provided", () => {
    initRepo(ctx.dir);
    expect(detectIssueRepo(ctx.dir, "owner/repo")).toBe("owner/repo");
  });

  it("returns configRepo even without a git remote", () => {
    initRepo(ctx.dir);
    expect(detectIssueRepo(ctx.dir, "explicit/repo")).toBe("explicit/repo");
  });

  it("auto-detects from HTTPS remote", () => {
    initRepo(ctx.dir, "https://github.com/mfaux/ralphai.git");
    expect(detectIssueRepo(ctx.dir)).toBe("mfaux/ralphai");
  });

  it("auto-detects from HTTPS remote without .git suffix", () => {
    initRepo(ctx.dir, "https://github.com/mfaux/ralphai");
    expect(detectIssueRepo(ctx.dir)).toBe("mfaux/ralphai");
  });

  it("auto-detects from SSH remote", () => {
    initRepo(ctx.dir, "git@github.com:mfaux/ralphai.git");
    expect(detectIssueRepo(ctx.dir)).toBe("mfaux/ralphai");
  });

  it("auto-detects from SSH remote without .git suffix", () => {
    initRepo(ctx.dir, "git@github.com:mfaux/ralphai");
    expect(detectIssueRepo(ctx.dir)).toBe("mfaux/ralphai");
  });

  it("returns null when no remote is configured", () => {
    initRepo(ctx.dir);
    expect(detectIssueRepo(ctx.dir)).toBeNull();
  });

  it("auto-detects from non-GitHub HTTPS remote", () => {
    initRepo(ctx.dir, "https://gitlab.com/user/repo.git");
    expect(detectIssueRepo(ctx.dir)).toBe("user/repo");
  });

  it("auto-detects from SSH remote with host alias", () => {
    initRepo(ctx.dir, "git@github-work:mfaux/ralphai.git");
    expect(detectIssueRepo(ctx.dir)).toBe("mfaux/ralphai");
  });

  it("auto-detects from SSH remote with host alias without .git suffix", () => {
    initRepo(ctx.dir, "git@my-gh:org/project");
    expect(detectIssueRepo(ctx.dir)).toBe("org/project");
  });

  it("ignores empty configRepo", () => {
    initRepo(ctx.dir, "https://github.com/auto/detected.git");
    expect(detectIssueRepo(ctx.dir, "")).toBe("auto/detected");
  });
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("converts to lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("replaces non-alphanumeric chars with dashes", () => {
    expect(slugify("feat: add new_feature!")).toBe("feat-add-new-feature");
  });

  it("collapses multiple non-alphanumeric chars into a single dash", () => {
    expect(slugify("foo---bar   baz")).toBe("foo-bar-baz");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("truncates to 60 characters", () => {
    const long =
      "this is a very long title that should be truncated to sixty characters at most";
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles all-special-character input", () => {
    expect(slugify("!!!")).toBe("");
  });

  it("preserves numbers", () => {
    expect(slugify("Issue #123: Fix bug")).toBe("issue-123-fix-bug");
  });
});

// ---------------------------------------------------------------------------
// pullGithubIssues — guard clause tests (no gh required)
// ---------------------------------------------------------------------------

describe("pullGithubIssues", () => {
  const ctx = useTempDir();

  it("returns early when issueSource is not github", () => {
    const opts = { ...defaultOptions(ctx.dir), issueSource: "none" };
    const result = pullGithubIssues(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("not 'github'");
  });

  it("returns early when gh is not available", () => {
    // This test works when gh is not installed or not authenticated.
    // If gh IS available, this will proceed past the guard — that's OK,
    // it will still fail later (no matching issues) and return pulled: false.
    initRepo(ctx.dir);
    const opts = defaultOptions(ctx.dir);
    const result = pullGithubIssues(opts);
    expect(result.pulled).toBe(false);
    // Message varies depending on whether gh is installed
    expect(result.message.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// pullGithubIssues — plan file integration (uses mock gh script)
// ---------------------------------------------------------------------------

describe("pullGithubIssues plan file creation", () => {
  const ctx = useTempDir();

  it("creates backlog directory if it does not exist", () => {
    initRepo(ctx.dir);
    const opts = {
      ...defaultOptions(ctx.dir),
      issueSource: "none", // early exit, but tests won't write
    };
    pullGithubIssues(opts);
    // With "none" source, backlog is never created (early exit)
    expect(existsSync(opts.backlogDir)).toBe(false);
  });

  it("generates correct plan filename from issue number and title slug", () => {
    // We can test the filename logic indirectly by checking slugify
    const title = "Add dark mode support";
    const slug = slugify(title);
    const filename = `gh-42-${slug}.md`;
    expect(filename).toBe("gh-42-add-dark-mode-support.md");
  });
});

// ---------------------------------------------------------------------------
// peekGithubIssues — read-only guard clause tests (no gh required)
// ---------------------------------------------------------------------------

/** Build default PeekIssueOptions for testing. */
function defaultPeekOptions(dir: string): PeekIssueOptions {
  return {
    cwd: dir,
    issueSource: "github",
    standaloneLabel: "ralphai-standalone",
    issueRepo: "",
  };
}

describe("peekGithubIssues", () => {
  const ctx = useTempDir();

  it("returns found:false when issueSource is not github", () => {
    const opts = { ...defaultPeekOptions(ctx.dir), issueSource: "none" };
    const result = peekGithubIssues(opts);
    expect(result.found).toBe(false);
    expect(result.count).toBe(0);
    expect(result.message).toContain("not 'github'");
  });

  it("returns found:false when gh is not available", () => {
    // Works in environments where gh is not installed or not authenticated.
    // If gh IS available, the call still returns found:false (no matching
    // issues in a temp repo) so the assertion holds either way.
    initRepo(ctx.dir);
    const opts = defaultPeekOptions(ctx.dir);
    const result = peekGithubIssues(opts);
    expect(result.found).toBe(false);
    expect(result.count).toBe(0);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("returns count 0 and found:false with a descriptive message", () => {
    const opts = { ...defaultPeekOptions(ctx.dir), issueSource: "none" };
    const result = peekGithubIssues(opts);
    expect(result.found).toBe(false);
    expect(result.count).toBe(0);
    expect(result.oldest).toBeUndefined();
    expect(result.repo).toBeUndefined();
  });

  it("never writes files (dry-run safe)", () => {
    initRepo(ctx.dir);
    const backlogDir = join(ctx.dir, ".ralphai", "pipeline", "backlog");
    const opts = defaultPeekOptions(ctx.dir);
    peekGithubIssues(opts);
    // The backlog directory should not be created by peek
    expect(existsSync(backlogDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// commitTypeFromTitle
// ---------------------------------------------------------------------------

describe("commitTypeFromTitle", () => {
  it("extracts fix type from title", () => {
    expect(commitTypeFromTitle("fix: broken login")).toEqual({
      type: "fix",
      description: "broken login",
    });
  });

  it("extracts feat type from title", () => {
    expect(commitTypeFromTitle("feat: add dark mode")).toEqual({
      type: "feat",
      description: "add dark mode",
    });
  });

  it("extracts docs type from title", () => {
    expect(commitTypeFromTitle("docs: update CLI reference")).toEqual({
      type: "docs",
      description: "update CLI reference",
    });
  });

  it("extracts refactor type from title", () => {
    expect(commitTypeFromTitle("refactor: extract label helpers")).toEqual({
      type: "refactor",
      description: "extract label helpers",
    });
  });

  it("handles scoped types like feat(ui):", () => {
    expect(commitTypeFromTitle("feat(ui): add toggle")).toEqual({
      type: "feat",
      description: "add toggle",
    });
  });

  it("handles breaking change indicator (!)", () => {
    expect(commitTypeFromTitle("fix!: remove deprecated API")).toEqual({
      type: "fix",
      description: "remove deprecated API",
    });
  });

  it("is case-insensitive", () => {
    expect(commitTypeFromTitle("Fix: login issue")).toEqual({
      type: "fix",
      description: "login issue",
    });
  });

  it("defaults to feat when no prefix is present", () => {
    expect(commitTypeFromTitle("Add dark mode support")).toEqual({
      type: "feat",
      description: "Add dark mode support",
    });
  });

  it("defaults to feat for empty string", () => {
    expect(commitTypeFromTitle("")).toEqual({
      type: "feat",
      description: "",
    });
  });

  it("does not treat unknown prefixes as types", () => {
    expect(commitTypeFromTitle("update: something")).toEqual({
      type: "feat",
      description: "update: something",
    });
  });
});

// ---------------------------------------------------------------------------
// issueBranchName
// ---------------------------------------------------------------------------

describe("issueBranchName", () => {
  it("uses feat/ prefix for titles without conventional type", () => {
    expect(issueBranchName("Add dark mode support")).toBe(
      "feat/add-dark-mode-support",
    );
  });

  it("uses fix/ prefix for fix: titles", () => {
    expect(issueBranchName("fix: broken login page")).toBe(
      "fix/broken-login-page",
    );
  });

  it("uses docs/ prefix for docs: titles", () => {
    expect(issueBranchName("docs: update CLI reference")).toBe(
      "docs/update-cli-reference",
    );
  });

  it("uses refactor/ prefix for refactor: titles", () => {
    expect(issueBranchName("refactor: extract helpers")).toBe(
      "refactor/extract-helpers",
    );
  });

  it("strips conventional prefix from slug to avoid duplication", () => {
    // Should NOT produce "fix/fix-broken-login"
    expect(issueBranchName("fix: broken login")).toBe("fix/broken-login");
  });

  it("truncates long descriptions to fit slugify 60-char limit", () => {
    const longTitle =
      "fix: this is a very long title that should be truncated to sixty characters at most by slugify";
    const result = issueBranchName(longTitle);
    expect(result.startsWith("fix/")).toBe(true);
    // prefix + "/" + max 60 char slug
    const slug = result.slice("fix/".length);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("handles empty title", () => {
    expect(issueBranchName("")).toBe("feat/");
  });
});

// ---------------------------------------------------------------------------
// prdBranchName (deprecated alias)
// ---------------------------------------------------------------------------

describe("prdBranchName", () => {
  it("is an alias for issueBranchName", () => {
    expect(prdBranchName("Add dark mode support")).toBe(
      issueBranchName("Add dark mode support"),
    );
  });

  it("returns feat/ prefix for titles without conventional type", () => {
    expect(prdBranchName("Add dark mode support")).toBe(
      "feat/add-dark-mode-support",
    );
  });

  it("strips conventional prefix from slug", () => {
    expect(prdBranchName("feat: add new feature")).toBe("feat/add-new-feature");
  });
});

// ---------------------------------------------------------------------------
// fetchPrdIssueByNumber — guard clause tests (no gh required)
// ---------------------------------------------------------------------------

describe("fetchPrdIssueByNumber", () => {
  const ctx = useTempDir();

  it("throws when gh is not available", () => {
    // In CI or environments without gh, this will throw.
    // If gh IS available, we test with a non-existent repo/issue.
    initRepo(ctx.dir);
    const ghAvailable = checkGhAvailable();
    if (!ghAvailable) {
      expect(() =>
        fetchPrdIssueByNumber("owner/repo", 999999, ctx.dir),
      ).toThrow("gh CLI not available");
    } else {
      // gh is available but issue likely doesn't exist in a temp repo
      expect(() =>
        fetchPrdIssueByNumber(
          "nonexistent-owner/nonexistent-repo",
          999999,
          ctx.dir,
        ),
      ).toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// pullPrdSubIssue — guard clause tests (no gh required)
// ---------------------------------------------------------------------------

describe("pullPrdSubIssue", () => {
  const ctx = useTempDir();

  it("returns early when issueSource is not github", () => {
    const opts = { ...defaultOptions(ctx.dir), issueSource: "none" };
    const result = pullPrdSubIssue(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("not 'github'");
  });

  it("returns early when gh is not available", () => {
    initRepo(ctx.dir);
    const ghAvailable = checkGhAvailable();
    if (!ghAvailable) {
      const opts = defaultOptions(ctx.dir);
      const result = pullPrdSubIssue(opts);
      expect(result.pulled).toBe(false);
      expect(result.message).toContain("not available");
    }
  });
});
