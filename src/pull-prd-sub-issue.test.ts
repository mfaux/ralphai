/**
 * Unit tests for pullPrdSubIssue() — the auto-drain entry point that discovers
 * PRD sub-issues via the native REST API.
 *
 * Uses setExecImpl() from exec.ts to swap execSync with a mock,
 * verifying the full flow (PRD listing → sub-issues API → label filtering → plan write)
 * without requiring a real GitHub repo or gh CLI.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import type { PullIssueOptions } from "./issues.ts";
import { setExecImpl } from "./exec.ts";
import { pullPrdSubIssue } from "./issues.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ralphai-prd-drain-"));
}

function defaultOptions(dir: string): PullIssueOptions {
  return {
    backlogDir: join(dir, ".ralphai", "pipeline", "backlog"),
    cwd: dir,
    issueSource: "github",
    standaloneLabel: "ralphai-standalone",
    subissueLabel: "ralphai-subissue",
    issueRepo: "owner/repo",
    issueCommentProgress: false,
  };
}

/** Make gh available (version + auth succeed). */
function mockGhAvailable(): void {
  // Default: gh is available but returns nothing for other commands
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

/**
 * Build a command router that dispatches gh calls to handler functions.
 * Unmatched commands throw.
 */
function mockGhCommands(
  handlers: Record<string, (cmd: string) => string | Buffer>,
): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (cmd.includes(pattern)) {
        return handler(cmd);
      }
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  restoreExec = setExecImpl(mockExecSync as any);
  mockExecSync.mockReset();
});

afterEach(() => {
  restoreExec();
});

describe("pullPrdSubIssue — guard clauses", () => {
  it("returns early when issueSource is not github", () => {
    const dir = makeTempDir();
    const opts = { ...defaultOptions(dir), issueSource: "none" };
    const result = pullPrdSubIssue(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("not 'github'");
  });

  it("returns early when gh is not available", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version") {
        throw new Error("not found");
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("not available");
  });

  it("returns early when repo cannot be detected", () => {
    mockGhAvailable();
    const dir = makeTempDir();
    const opts = { ...defaultOptions(dir), issueRepo: "" };
    // No git remote in temp dir, so detection fails
    const result = pullPrdSubIssue(opts);
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("Could not detect GitHub repo");
  });
});

describe("pullPrdSubIssue — no PRD issues", () => {
  it("returns pulled:false when no PRD issues exist", () => {
    mockGhCommands({
      "gh issue list": () => JSON.stringify([]),
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("No open PRD issues found");
  });

  it("returns pulled:false when gh issue list returns null", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue list")) {
        throw new Error("network error");
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("No open PRD issues found");
  });
});

describe("pullPrdSubIssue — sub-issues via REST API", () => {
  it("fetches sub-issues via REST API and pulls first eligible one", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [
      { number: 201, title: "Sub A", state: "open" },
      { number: 202, title: "Sub B", state: "open" },
    ];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      // Label check for sub-issue #201 — no skip labels
      'gh issue view 201 --repo "owner/repo" --json labels': () => "",
      // fetchAndWriteIssuePlan fetches title, body, url for the sub-issue
      'gh issue view 201 --repo "owner/repo" --json title --jq': () => "Sub A",
      'gh issue view 201 --repo "owner/repo" --json body --jq': () =>
        "Sub A body",
      'gh issue view 201 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/201",
      // Parent PRD discovery for sub-issue #201
      "gh api repos/owner/repo/issues/201/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      // GraphQL blockers for sub-issue #201
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: { issue: { blockedBy: { nodes: [] } } },
          },
        }),
      // Label swap after plan creation
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(true);
    expect(result.message).toContain("#201");
    expect(result.planPath).toBeDefined();

    // Verify plan file was written with prd frontmatter
    const content = readFileSync(result.planPath!, "utf-8");
    expect(content).toContain("prd: 100");
    expect(content).toContain("issue: 201");
  });

  it("skips closed sub-issues and only considers open ones", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [
      { number: 201, title: "Done task", state: "closed" },
      { number: 202, title: "Also done", state: "closed" },
      { number: 203, title: "Open task", state: "open" },
    ];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      // Label check for #203 (only open sub-issue)
      'gh issue view 203 --repo "owner/repo" --json labels': () => "",
      'gh issue view 203 --repo "owner/repo" --json title --jq': () =>
        "Open task",
      'gh issue view 203 --repo "owner/repo" --json body --jq': () =>
        "Open task body",
      'gh issue view 203 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/203",
      "gh api repos/owner/repo/issues/203/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: { issue: { blockedBy: { nodes: [] } } },
          },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(true);
    expect(result.message).toContain("#203");
  });

  it("skips sub-issues with in-progress or done labels", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [
      { number: 201, title: "In progress", state: "open" },
      { number: 202, title: "Done", state: "open" },
      { number: 203, title: "Available", state: "open" },
    ];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      // #201 has in-progress label
      'gh issue view 201 --repo "owner/repo" --json labels': () =>
        "in-progress",
      // #202 has done label
      'gh issue view 202 --repo "owner/repo" --json labels': () => "done",
      // #203 has no skip labels
      'gh issue view 203 --repo "owner/repo" --json labels': () => "",
      'gh issue view 203 --repo "owner/repo" --json title --jq': () =>
        "Available",
      'gh issue view 203 --repo "owner/repo" --json body --jq': () =>
        "Available body",
      'gh issue view 203 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/203",
      "gh api repos/owner/repo/issues/203/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: { issue: { blockedBy: { nodes: [] } } },
          },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(true);
    expect(result.message).toContain("#203");
  });

  it("returns pulled:false when all open sub-issues have skip labels", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [
      { number: 201, title: "In progress", state: "open" },
      { number: 202, title: "Done", state: "open" },
    ];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      'gh issue view 201 --repo "owner/repo" --json labels': () =>
        "in-progress",
      'gh issue view 202 --repo "owner/repo" --json labels': () => "done",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain(
      "all open sub-issues already in-progress or done",
    );
  });

  it("skips sub-issues with the stuck label", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [
      { number: 201, title: "Stuck", state: "open" },
      { number: 202, title: "Available", state: "open" },
    ];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      // #201 has stuck label — should be skipped
      'gh issue view 201 --repo "owner/repo" --json labels': () => "stuck",
      // #202 has no skip labels
      'gh issue view 202 --repo "owner/repo" --json labels': () => "",
      'gh issue view 202 --repo "owner/repo" --json title --jq': () =>
        "Available",
      'gh issue view 202 --repo "owner/repo" --json body --jq': () =>
        "Available body",
      'gh issue view 202 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/202",
      "gh api repos/owner/repo/issues/202/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: { issue: { blockedBy: { nodes: [] } } },
          },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(true);
    expect(result.message).toContain("#202");
  });

  it("returns pulled:false when PRD has no open sub-issues", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [
      { number: 201, title: "Done A", state: "closed" },
      { number: 202, title: "Done B", state: "closed" },
    ];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("no open sub-issues");
  });

  it("returns pulled:false when PRD has zero sub-issues (empty array)", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () => JSON.stringify([]),
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("no open sub-issues");
  });
});

describe("pullPrdSubIssue — REST API error handling", () => {
  it("returns pulled:false when sub-issues API call fails", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];

    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue list")) {
        return JSON.stringify(prdIssues);
      }
      if (typeof cmd === "string" && cmd.includes("gh api repos")) {
        throw new Error("rate limited");
      }
      throw new Error(`Unexpected: ${cmd}`);
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("failed to fetch sub-issues via REST API");
  });

  it("returns pulled:false when sub-issues response is not valid JSON", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () => "not json",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("failed to parse sub-issues response");
  });

  it("returns pulled:false when sub-issues response is not an array", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify({ message: "Not Found" }),
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("unexpected sub-issues response");
  });
});

describe("pullPrdSubIssue — picks oldest PRD", () => {
  it("selects the oldest PRD (last element from gh issue list)", () => {
    // gh returns newest first, so oldest is last
    const prdIssues = [
      { number: 300, title: "Newest PRD" },
      { number: 200, title: "Middle PRD" },
      { number: 100, title: "Oldest PRD" },
    ];

    const subIssues = [
      { number: 501, title: "Sub from oldest", state: "open" },
    ];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      // The sub-issues API should be called for PRD #100 (the oldest)
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      'gh issue view 501 --repo "owner/repo" --json labels': () => "",
      'gh issue view 501 --repo "owner/repo" --json title --jq': () =>
        "Sub from oldest",
      'gh issue view 501 --repo "owner/repo" --json body --jq': () => "Body",
      'gh issue view 501 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/501",
      "gh api repos/owner/repo/issues/501/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      "gh api graphql": () =>
        JSON.stringify({
          data: { repository: { issue: { blockedBy: { nodes: [] } } } },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(true);
    expect(result.message).toContain("#501");

    // Verify the sub-issues API was called for PRD #100 (not 200 or 300)
    const apiCalls = mockExecSync.mock.calls
      .map((c: unknown[]) => c[0])
      .filter(
        (c: unknown) =>
          typeof c === "string" &&
          c.includes("gh api repos") &&
          c.includes("sub_issues"),
      );
    expect(apiCalls).toHaveLength(1);
    expect(apiCalls[0]).toContain("issues/100/sub_issues");
  });
});

describe("pullPrdSubIssue — plan file content", () => {
  it("writes plan with prd and depends-on frontmatter from native APIs", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [{ number: 201, title: "Sub task", state: "open" }];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      'gh issue view 201 --repo "owner/repo" --json labels': () => "",
      'gh issue view 201 --repo "owner/repo" --json title --jq': () =>
        "Sub task",
      'gh issue view 201 --repo "owner/repo" --json body --jq': () =>
        "Task body content",
      'gh issue view 201 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/201",
      // Parent API returns PRD #100
      "gh api repos/owner/repo/issues/201/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      // GraphQL returns blockers #50 and #60
      "gh api graphql": () =>
        JSON.stringify({
          data: {
            repository: {
              issue: {
                blockedBy: { nodes: [{ number: 60 }, { number: 50 }] },
              },
            },
          },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(true);

    const content = readFileSync(result.planPath!, "utf-8");
    expect(content).toContain("source: github");
    expect(content).toContain("issue: 201");
    expect(content).toContain("prd: 100");
    expect(content).toContain("depends-on: [gh-50, gh-60]");
    expect(content).toContain("# Sub task");
    expect(content).toContain("Task body content");
  });

  it("writes plan without depends-on when no blockers exist", () => {
    const prdIssues = [{ number: 100, title: "Feature PRD" }];
    const subIssues = [{ number: 201, title: "Sub task", state: "open" }];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      'gh issue view 201 --repo "owner/repo" --json labels': () => "",
      'gh issue view 201 --repo "owner/repo" --json title --jq': () =>
        "Sub task",
      'gh issue view 201 --repo "owner/repo" --json body --jq': () => "Body",
      'gh issue view 201 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/201",
      "gh api repos/owner/repo/issues/201/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "ralphai-prd" }],
        }),
      "gh api graphql": () =>
        JSON.stringify({
          data: { repository: { issue: { blockedBy: { nodes: [] } } } },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(true);

    const content = readFileSync(result.planPath!, "utf-8");
    expect(content).toContain("prd: 100");
    expect(content).not.toContain("depends-on");
  });
});

describe("pullPrdSubIssue — no body parsing", () => {
  it("ignores body task lists — only uses REST API sub-issues", () => {
    // PRD issue list no longer fetches body — this test verifies that
    // even if the PRD had body task lists, they would be irrelevant
    // because the function only calls the sub-issues REST API.
    const prdIssues = [{ number: 100, title: "PRD with body tasks" }];
    // REST API returns empty — no native sub-issues
    const subIssues: unknown[] = [];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
    });

    const dir = makeTempDir();
    const result = pullPrdSubIssue(defaultOptions(dir));
    expect(result.pulled).toBe(false);
    expect(result.message).toContain("no open sub-issues");

    // Verify the gh issue list command does NOT request body
    const listCalls = mockExecSync.mock.calls
      .map((c: unknown[]) => c[0])
      .filter(
        (c: unknown) => typeof c === "string" && c.includes("gh issue list"),
      );
    expect(listCalls.length).toBeGreaterThan(0);
    for (const call of listCalls) {
      expect(call).not.toContain("body");
    }
  });
});

describe("pullPrdSubIssue — custom issuePrdLabel", () => {
  it("pulls sub-issue using custom PRD label and threads it to parent discovery", () => {
    const prdIssues = [{ number: 100, title: "Custom PRD" }];
    const subIssues = [{ number: 201, title: "Sub task", state: "open" }];

    mockGhCommands({
      "gh issue list": () => JSON.stringify(prdIssues),
      "gh api repos/owner/repo/issues/100/sub_issues": () =>
        JSON.stringify(subIssues),
      'gh issue view 201 --repo "owner/repo" --json labels': () => "",
      'gh issue view 201 --repo "owner/repo" --json title --jq': () =>
        "Sub task",
      'gh issue view 201 --repo "owner/repo" --json body --jq': () =>
        "Sub task body",
      'gh issue view 201 --repo "owner/repo" --json url --jq': () =>
        "https://github.com/owner/repo/issues/201",
      // Parent has the custom label (not the default)
      "gh api repos/owner/repo/issues/201/parent": () =>
        JSON.stringify({
          number: 100,
          labels: [{ name: "my-custom-prd" }],
        }),
      "gh api graphql": () =>
        JSON.stringify({
          data: { repository: { issue: { blockedBy: { nodes: [] } } } },
        }),
      "gh issue edit": () => "",
    });

    const dir = makeTempDir();
    const opts = {
      ...defaultOptions(dir),
      issuePrdLabel: "my-custom-prd",
    };
    const result = pullPrdSubIssue(opts);
    expect(result.pulled).toBe(true);
    expect(result.message).toContain("#201");

    // Verify plan file has prd frontmatter (parent discovered via custom label)
    const content = readFileSync(result.planPath!, "utf-8");
    expect(content).toContain("prd: 100");
    expect(content).toContain("issue: 201");
  });
});
