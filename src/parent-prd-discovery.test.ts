/**
 * Unit tests for discoverParentPrd() — parent PRD discovery via REST API.
 *
 * Uses mock.module to control `child_process.execSync` so we can test
 * parent discovery without requiring a real GitHub repo.
 */
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

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
const { discoverParentPrd } = await import("./issues.ts");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockExecSync.mockReset();
});

describe("discoverParentPrd", () => {
  it("returns parent issue number when parent has ralphai-prd label", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          labels: [{ name: "ralphai-prd" }, { name: "enhancement" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd("owner/repo", "100", "/tmp");
    expect(result).toBe(245);
  });

  it("returns undefined when parent does not have ralphai-prd label", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          labels: [{ name: "enhancement" }, { name: "bug" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd("owner/repo", "100", "/tmp");
    expect(result).toBeUndefined();
  });

  it("returns undefined when parent has no labels", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          labels: [],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd("owner/repo", "100", "/tmp");
    expect(result).toBeUndefined();
  });

  it("returns undefined when issue has no parent (API returns 404/error)", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        throw new Error("HTTP 404: Not Found");
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd("owner/repo", "100", "/tmp");
    expect(result).toBeUndefined();
  });

  it("returns undefined and warns when API returns invalid JSON", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return "not valid json";
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd("owner/repo", "100", "/tmp");
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![0]).toContain(
      "failed to parse parent response",
    );

    warnSpy.mockRestore();
  });

  it("calls the correct REST API endpoint", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          labels: [{ name: "ralphai-prd" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    discoverParentPrd("myorg/myrepo", "42", "/some/dir");

    const ghApiCall = mockExecSync.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === "string" && call[0].includes("gh api"),
    );
    expect(ghApiCall).toBeDefined();
    expect(ghApiCall![0]).toContain("repos/myorg/myrepo/issues/42/parent");
  });

  it("returns undefined when parent labels field is missing", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          // no labels field
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd("owner/repo", "100", "/tmp");
    expect(result).toBeUndefined();
  });
});

describe("discoverParentPrd — custom prdLabel", () => {
  it("returns parent when parent has the custom PRD label", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          labels: [{ name: "my-custom-prd" }, { name: "enhancement" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd(
      "owner/repo",
      "100",
      "/tmp",
      "my-custom-prd",
    );
    expect(result).toBe(245);
  });

  it("returns undefined when parent has default label but custom label is configured", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          labels: [{ name: "ralphai-prd" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd(
      "owner/repo",
      "100",
      "/tmp",
      "my-custom-prd",
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when parent has no matching custom label", () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh api")) {
        return JSON.stringify({
          number: 245,
          labels: [{ name: "bug" }, { name: "enhancement" }],
        });
      }
      throw new Error(`Unexpected command: ${cmd}`);
    });

    const result = discoverParentPrd(
      "owner/repo",
      "100",
      "/tmp",
      "my-custom-prd",
    );
    expect(result).toBeUndefined();
  });
});
