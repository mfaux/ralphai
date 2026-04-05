/**
 * Unit tests for fetchPrdIssue() — auto-detection of a single PRD issue.
 *
 * Uses setExecImpl() to swap execSync with a mock so we can test the
 * 0, 1, and multiple-result paths without requiring a real GitHub repo.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { setExecImpl } from "./exec.ts";
import { fetchPrdIssue, fetchPrdIssueByNumber } from "./issues.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up mockExecSync so that:
 * - `gh --version` and `gh auth status` succeed (gh is available)
 * - `gh issue list ...` returns the given JSON string
 */
function mockGhAvailableWithIssues(json: string): void {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === "gh --version" || cmd === "gh auth status") {
      return Buffer.from("ok");
    }
    if (typeof cmd === "string" && cmd.includes("gh issue list")) {
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
  restoreExec = setExecImpl(mockExecSync as any);
  mockExecSync.mockReset();
});

afterEach(() => {
  restoreExec();
});

describe("fetchPrdIssue", () => {
  it("returns null when zero PRD issues exist", () => {
    mockGhAvailableWithIssues("[]");
    const result = fetchPrdIssue("owner/repo", "/tmp");
    expect(result).toBeNull();
  });

  it("returns the issue when exactly one PRD issue exists", () => {
    const issues = [{ number: 42, title: "Add dark mode" }];
    mockGhAvailableWithIssues(JSON.stringify(issues));
    const result = fetchPrdIssue("owner/repo", "/tmp");
    expect(result).toEqual({ number: 42, title: "Add dark mode" });
  });

  it("throws with a listing when multiple PRD issues exist", () => {
    const issues = [
      { number: 10, title: "Feature A" },
      { number: 20, title: "Feature B" },
      { number: 30, title: "Feature C" },
    ];
    mockGhAvailableWithIssues(JSON.stringify(issues));

    expect(() => fetchPrdIssue("owner/repo", "/tmp")).toThrow(
      /Multiple open PRD issues found/,
    );
  });

  it("error message lists all issue numbers and titles", () => {
    const issues = [
      { number: 10, title: "Feature A" },
      { number: 20, title: "Feature B" },
    ];
    mockGhAvailableWithIssues(JSON.stringify(issues));

    let errorMessage = "";
    try {
      fetchPrdIssue("owner/repo", "/tmp");
    } catch (e: unknown) {
      errorMessage = (e as Error).message;
    }

    expect(errorMessage).toContain("#10");
    expect(errorMessage).toContain("Feature A");
    expect(errorMessage).toContain("#20");
    expect(errorMessage).toContain("Feature B");
  });

  it("error message suggests --prd=<number>", () => {
    const issues = [
      { number: 10, title: "Feature A" },
      { number: 20, title: "Feature B" },
    ];
    mockGhAvailableWithIssues(JSON.stringify(issues));

    expect(() => fetchPrdIssue("owner/repo", "/tmp")).toThrow(/--prd=<number>/);
  });

  it("error message suggests ralphai prd <number>", () => {
    const issues = [
      { number: 10, title: "Feature A" },
      { number: 20, title: "Feature B" },
    ];
    mockGhAvailableWithIssues(JSON.stringify(issues));

    expect(() => fetchPrdIssue("owner/repo", "/tmp")).toThrow(
      /ralphai prd <number>/,
    );
  });

  it("throws when gh is not available", () => {
    mockGhUnavailable();
    expect(() => fetchPrdIssue("owner/repo", "/tmp")).toThrow(
      /gh CLI not available/,
    );
  });

  it("returns null when gh issue list returns non-JSON", () => {
    mockGhAvailableWithIssues("not json");
    const result = fetchPrdIssue("owner/repo", "/tmp");
    expect(result).toBeNull();
  });

  it("returns null when gh issue list command fails", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue list")) {
        throw new Error("network error");
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = fetchPrdIssue("owner/repo", "/tmp");
    expect(result).toBeNull();
  });

  it("passes the correct repo and label to gh issue list", () => {
    mockGhAvailableWithIssues("[]");
    fetchPrdIssue("myorg/myrepo", "/some/dir");

    const ghListCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue list"),
    );
    expect(ghListCall).toBeDefined();
    expect(ghListCall![0]).toContain('--repo "myorg/myrepo"');
    expect(ghListCall![0]).toContain('--label "ralphai-prd"');
    expect(ghListCall![0]).toContain("--state open");
    expect(ghListCall![0]).toContain("--json number,title");
  });
});

describe("fetchPrdIssue — custom prdLabel", () => {
  it("uses custom label in gh issue list query", () => {
    mockGhAvailableWithIssues("[]");
    fetchPrdIssue("myorg/myrepo", "/some/dir", "my-custom-prd");

    const ghListCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh issue list"),
    );
    expect(ghListCall).toBeDefined();
    expect(ghListCall![0]).toContain('--label "my-custom-prd"');
    expect(ghListCall![0]).not.toContain('"ralphai-prd"');
  });

  it("returns the issue when exactly one exists with custom label", () => {
    const issues = [{ number: 42, title: "Custom PRD" }];
    mockGhAvailableWithIssues(JSON.stringify(issues));
    const result = fetchPrdIssue("owner/repo", "/tmp", "my-custom-prd");
    expect(result).toEqual({ number: 42, title: "Custom PRD" });
  });

  it("error message references custom label when multiple PRDs exist", () => {
    const issues = [
      { number: 10, title: "Feature A" },
      { number: 20, title: "Feature B" },
    ];
    mockGhAvailableWithIssues(JSON.stringify(issues));

    let errorMessage = "";
    try {
      fetchPrdIssue("owner/repo", "/tmp", "my-custom-prd");
    } catch (e: unknown) {
      errorMessage = (e as Error).message;
    }

    expect(errorMessage).toContain("my-custom-prd");
    expect(errorMessage).not.toContain("ralphai-prd");
    expect(errorMessage).toContain("#10");
    expect(errorMessage).toContain("#20");
  });
});

describe("fetchPrdIssueByNumber — custom prdLabel", () => {
  it("validates against custom label", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        return JSON.stringify({
          title: "Custom PRD issue",
          labels: [{ name: "my-custom-prd" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = fetchPrdIssueByNumber(
      "owner/repo",
      42,
      "/tmp",
      "my-custom-prd",
    );
    expect(result).toEqual({ number: 42, title: "Custom PRD issue" });
  });

  it("throws when issue has default label but custom label is configured", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        return JSON.stringify({
          title: "Has default label",
          labels: [{ name: "ralphai-prd" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    expect(() =>
      fetchPrdIssueByNumber("owner/repo", 42, "/tmp", "my-custom-prd"),
    ).toThrow(/does not have the 'my-custom-prd' label/);
  });

  it("error message references custom label name", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "gh --version" || cmd === "gh auth status") {
        return Buffer.from("ok");
      }
      if (typeof cmd === "string" && cmd.includes("gh issue view")) {
        return JSON.stringify({
          title: "No PRD label",
          labels: [{ name: "bug" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    let errorMessage = "";
    try {
      fetchPrdIssueByNumber("owner/repo", 42, "/tmp", "my-custom-prd");
    } catch (e: unknown) {
      errorMessage = (e as Error).message;
    }

    expect(errorMessage).toContain("my-custom-prd");
    expect(errorMessage).not.toContain("ralphai-prd");
  });
});
