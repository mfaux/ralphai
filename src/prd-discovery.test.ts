/**
 * Unit tests for discoverPrdTarget() — PRD discovery I/O module.
 *
 * Uses mock.module to control `child_process.execSync` so we can test
 * PRD detection, sub-issue API discovery, and non-PRD passthrough
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

/** Standard sub-issue object as returned by the REST API. */
function subIssue(
  number: number,
  title: string,
  state: "open" | "closed" = "open",
  node_id?: string,
) {
  return {
    number,
    title,
    state,
    node_id: node_id ?? `MDExOklzc3VlMTIz${number}`,
  };
}

/** Make gh available and return specific JSON for issue view + sub-issues. */
function mockGhWithIssueAndSubIssues(
  issueJson: string,
  subIssuesJson: string,
): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("gh issue view")) {
      return issueJson;
    }
    if (typeof cmd === "string" && cmd.includes("gh api")) {
      return subIssuesJson;
    }
    throw new Error(`Unexpected command: ${cmd}`);
  });
}

/** Make gh available but only for issue view (no sub-issues). */
function mockGhWithIssue(json: string): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("gh issue view")) {
      return json;
    }
    if (typeof cmd === "string" && cmd.includes("gh api")) {
      return "[]";
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

describe("discoverPrdTarget — PRD with open sub-issues via REST API", () => {
  it("detects PRD and returns open sub-issues from the API", () => {
    const issueData = {
      title: "Add dark mode",
      body: "PRD body text",
      labels: [{ name: "ralphai-prd" }],
    };
    const apiSubIssues = [
      subIssue(11, "Dark mode toggle"),
      subIssue(12, "Theme persistence"),
      subIssue(13, "Color palette"),
    ];
    mockGhWithIssueAndSubIssues(
      JSON.stringify(issueData),
      JSON.stringify(apiSubIssues),
    );

    const result = discoverPrdTarget("owner/repo", 42, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.prd).toEqual({ number: 42, title: "Add dark mode" });
      expect(result.subIssues).toEqual([11, 12, 13]);
      expect(result.subIssueDetails).toEqual(apiSubIssues);
      expect(result.allCompleted).toBe(false);
      expect(result.body).toBe("PRD body text");
    }
  });

  it("filters out closed sub-issues, returning only open ones", () => {
    const issueData = {
      title: "Feature A",
      body: "Feature body",
      labels: [{ name: "ralphai-prd" }],
    };
    const apiSubIssues = [
      subIssue(10, "Done task", "closed"),
      subIssue(11, "Open task A"),
      subIssue(12, "Another done task", "closed"),
      subIssue(13, "Open task B"),
    ];
    mockGhWithIssueAndSubIssues(
      JSON.stringify(issueData),
      JSON.stringify(apiSubIssues),
    );

    const result = discoverPrdTarget("owner/repo", 1, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([11, 13]);
      expect(result.subIssueDetails).toHaveLength(2);
      expect(result.subIssueDetails[0]!.title).toBe("Open task A");
      expect(result.subIssueDetails[1]!.title).toBe("Open task B");
      expect(result.allCompleted).toBe(false);
    }
  });

  it("carries node_id for each sub-issue", () => {
    const issueData = {
      title: "PRD with node IDs",
      body: "",
      labels: [{ name: "ralphai-prd" }],
    };
    const apiSubIssues = [subIssue(11, "Task", "open", "I_kwDOABC123")];
    mockGhWithIssueAndSubIssues(
      JSON.stringify(issueData),
      JSON.stringify(apiSubIssues),
    );

    const result = discoverPrdTarget("owner/repo", 42, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssueDetails[0]!.node_id).toBe("I_kwDOABC123");
    }
  });
});

describe("discoverPrdTarget — all sub-issues completed", () => {
  it("sets allCompleted when all sub-issues are closed", () => {
    const issueData = {
      title: "Done PRD",
      body: "All done",
      labels: [{ name: "ralphai-prd" }],
    };
    const apiSubIssues = [
      subIssue(10, "Done A", "closed"),
      subIssue(11, "Done B", "closed"),
      subIssue(12, "Done C", "closed"),
    ];
    mockGhWithIssueAndSubIssues(
      JSON.stringify(issueData),
      JSON.stringify(apiSubIssues),
    );

    const result = discoverPrdTarget("owner/repo", 99, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([]);
      expect(result.subIssueDetails).toEqual([]);
      expect(result.allCompleted).toBe(true);
    }
  });
});

describe("discoverPrdTarget — PRD with no sub-issues", () => {
  it("returns empty lists and allCompleted=false when API returns no sub-issues", () => {
    const issueData = {
      title: "Auth feature",
      body: "Implement authentication",
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssueAndSubIssues(JSON.stringify(issueData), JSON.stringify([]));

    const result = discoverPrdTarget("owner/repo", 50, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([]);
      expect(result.subIssueDetails).toEqual([]);
      expect(result.allCompleted).toBe(false);
      expect(result.body).toBe("Implement authentication");
    }
  });

  it("ignores body task lists — only uses API sub-issues", () => {
    const bodyWithTaskList = ["# Feature", "- [ ] #11", "- [ ] #12"].join("\n");
    const issueData = {
      title: "PRD with body tasks but no native sub-issues",
      body: bodyWithTaskList,
      labels: [{ name: "ralphai-prd" }],
    };
    // API returns empty — body task lists are ignored
    mockGhWithIssueAndSubIssues(JSON.stringify(issueData), JSON.stringify([]));

    const result = discoverPrdTarget("owner/repo", 60, "/tmp");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.subIssues).toEqual([]);
      expect(result.subIssueDetails).toEqual([]);
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

  it("throws when issue response is not valid JSON", () => {
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

  it("throws when sub-issues API call fails", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        return JSON.stringify({
          title: "PRD",
          body: "",
          labels: [{ name: "ralphai-prd" }],
        });
      }
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        throw new Error("rate limited");
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    expect(() => discoverPrdTarget("owner/repo", 42, "/tmp")).toThrow(
      /Failed to fetch sub-issues.*rate limit.*auth failure/,
    );
  });

  it("throws when sub-issues response is not valid JSON", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        return JSON.stringify({
          title: "PRD",
          body: "",
          labels: [{ name: "ralphai-prd" }],
        });
      }
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return "not json";
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    expect(() => discoverPrdTarget("owner/repo", 42, "/tmp")).toThrow(
      /Failed to parse sub-issues response/,
    );
  });

  it("throws when sub-issues response is not an array", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        return JSON.stringify({
          title: "PRD",
          body: "",
          labels: [{ name: "ralphai-prd" }],
        });
      }
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({ message: "Not Found" });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    expect(() => discoverPrdTarget("owner/repo", 42, "/tmp")).toThrow(
      /Unexpected sub-issues response.*expected an array/,
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

  it("calls the sub-issues REST API with correct repo and issue number", () => {
    const issueData = {
      title: "PRD",
      body: "",
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssueAndSubIssues(JSON.stringify(issueData), JSON.stringify([]));

    discoverPrdTarget("myorg/myrepo", 42, "/some/dir");

    const ghApiCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh api"),
    );
    expect(ghApiCall).toBeDefined();
    expect(ghApiCall![0]).toContain("repos/myorg/myrepo/issues/42/sub_issues");
  });
});

describe("discoverPrdTarget — custom prdLabel", () => {
  it("detects PRD when issue has the custom label", () => {
    const issueData = {
      title: "Custom PRD",
      body: "PRD body",
      labels: [{ name: "my-custom-prd" }],
    };
    const apiSubIssues = [subIssue(11, "Sub task")];
    mockGhWithIssueAndSubIssues(
      JSON.stringify(issueData),
      JSON.stringify(apiSubIssues),
    );

    const result = discoverPrdTarget("owner/repo", 42, "/tmp", "my-custom-prd");
    expect(result.isPrd).toBe(true);
    if (result.isPrd) {
      expect(result.prd).toEqual({ number: 42, title: "Custom PRD" });
      expect(result.subIssues).toEqual([11]);
    }
  });

  it("returns isPrd: false when issue has default label but custom label is configured", () => {
    const issueData = {
      title: "Has default label",
      body: "Body",
      labels: [{ name: "ralphai-prd" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 42, "/tmp", "my-custom-prd");
    expect(result.isPrd).toBe(false);
  });

  it("returns isPrd: false when issue has no matching custom label", () => {
    const issueData = {
      title: "No match",
      body: "Body",
      labels: [{ name: "bug" }, { name: "enhancement" }],
    };
    mockGhWithIssue(JSON.stringify(issueData));

    const result = discoverPrdTarget("owner/repo", 42, "/tmp", "my-custom-prd");
    expect(result.isPrd).toBe(false);
  });
});
