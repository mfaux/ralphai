/**
 * Unit tests for discoverPrdTarget() — PRD discovery I/O module.
 *
 * Uses mock.module to control `child_process.execSync` so we can test
 * PRD detection, sub-issue parsing, empty task list, and non-PRD passthrough
 * without requiring a real GitHub repo.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";

const realChildProcess = require("child_process");
const realExecSync =
  realChildProcess.execSync as typeof import("child_process").execSync;

// ---------------------------------------------------------------------------
// Mock child_process.execSync
// ---------------------------------------------------------------------------

const mockExecSync = mock();

mock.module("child_process", () => ({
  ...realChildProcess,
  execSync: (...args: Parameters<typeof realExecSync>) => {
    const [cmd, options] = args;
    if (typeof cmd === "string" && cmd.startsWith("gh ")) {
      return mockExecSync(...args);
    }

    return realExecSync(cmd, options as Parameters<typeof realExecSync>[1]);
  },
}));

// Import AFTER mocking so the module picks up the mock
const { discoverPrdTarget } = await import("./prd-discovery.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make gh available and return specific JSON for `gh issue view`. */
function mockGhWithIssue(json: string): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("gh issue view")) {
      return json;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

/** Make gh unavailable (version check fails). */
function mockGhUnavailable(): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version") {
      throw new Error("not found");
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecSync.mockReset();
});

describe("discoverPrdTarget — non-PRD passthrough", () => {
  it("returns isPrd: false for issue without ralphai-prd label", () => {
    const issueData = {
      title: "Fix login bug",
      body: "The login form crashes on empty input.",
      labels: [{ name: "bug" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 42, "/tmp");
    expect(result.isPrd).toBe(false);
    if (!result.isPrd) {
      expect(result.issue.number).toBe(42);
      expect(result.issue.title).toBe("Fix login bug");
      expect(result.issue.body).toBe("The login form crashes on empty input.");
    }
  });

  it("returns isPrd: false for issue with no labels", () => {
    const issueData = {
      title: "No labels issue",
      body: "Some body",
      labels: [],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 10, "/tmp");
    expect(result.isPrd).toBe(false);
  });

  it("returns isPrd: false for issue with unrelated labels", () => {
    const issueData = {
      title: "Docs update",
      body: "Update README",
      labels: [{ name: "documentation" }, { name: "good first issue" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 5, "/tmp");
    expect(result.isPrd).toBe(false);
  });
});

describe("discoverPrdTarget — PRD with sub-issues", () => {
  it("detects PRD and extracts unchecked sub-issues", () => {
    const body = [
      "# Feature: Dark Mode",
      "",
      "## Sub-issues",
      "",
      "- [ ] #11",
      "- [ ] #12",
      "- [ ] #13",
    ].join("\n");
    const issueData = {
      title: "Add dark mode",
      body,
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 42, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.prd).toEqual({ number: 42, title: "Add dark mode" });
      expect(result.subIssues).toEqual([11, 12, 13]);
      expect(result.allCompleted).toBe(false);
      expect(result.body).toBe(body);
    }
  });

  it("excludes checked sub-issues from the list", () => {
    const body = ["- [x] #10", "- [ ] #11", "- [x] #12", "- [ ] #13"].join(
      "\n",
    );
    const issueData = {
      title: "Feature A",
      body,
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 1, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([11, 13]);
      expect(result.allCompleted).toBe(false);
    }
  });
});

describe("discoverPrdTarget — all sub-issues completed", () => {
  it("sets allCompleted when all items are checked", () => {
    const body = ["- [x] #10", "- [x] #11", "- [x] #12"].join("\n");
    const issueData = {
      title: "Done PRD",
      body,
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 99, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([]);
      expect(result.allCompleted).toBe(true);
    }
  });
});

describe("discoverPrdTarget — PRD with no task list", () => {
  it("returns empty subIssues and allCompleted=false when body has no task list", () => {
    const body = [
      "# Feature: Auth",
      "",
      "Implement authentication with JWT tokens.",
      "",
      "## Requirements",
      "",
      "- Support login/logout",
      "- Token refresh",
    ].join("\n");
    const issueData = {
      title: "Auth feature",
      body,
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 50, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([]);
      expect(result.allCompleted).toBe(false);
      expect(result.body).toBe(body);
    }
  });

  it("returns empty subIssues when body is empty", () => {
    const issueData = {
      title: "Empty PRD",
      body: "",
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 60, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([]);
      expect(result.allCompleted).toBe(false);
    }
  });
});

describe("discoverPrdTarget — error handling", () => {
  it("throws when gh is not available", () => {
    mockGhUnavailable();
    expect(() => discoverPrdTarget("owner/repo", 42, "/tmp")).toThrow(
      /gh CLI not available/,
    );
  });

  it("throws when issue is not found", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        throw new Error("not found");
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    expect(() => discoverPrdTarget("owner/repo", 999, "/tmp")).toThrow(
      /Could not fetch issue #999/,
    );
  });

  it("throws when response is not valid JSON", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        return "not json";
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    expect(() => discoverPrdTarget("owner/repo", 42, "/tmp")).toThrow(
      /Failed to parse response/,
    );
  });
});

describe("discoverPrdTarget — passes correct arguments to gh", () => {
  it("passes repo and issue number to gh issue view", () => {
    const issueData = {
      title: "Test",
      body: "",
      labels: [],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    discoverPrdTarget("myorg/myrepo", 42, "/some/dir");

    const ghViewCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue view"),
    );
    expect(ghViewCall).toBeDefined();
    expect(ghViewCall![0]).toContain('--repo "myorg/myrepo"');
    expect(ghViewCall![0]).toContain("42");
    expect(ghViewCall![0]).toContain("--json title,body,labels");
  });
});
