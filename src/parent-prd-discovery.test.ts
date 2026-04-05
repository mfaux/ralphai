/**
 * Unit tests for discoverParentPrd() — parent PRD discovery via REST API.
 *
 * Uses setExecImpl() to swap execSync with a mock so we can test
 * parent discovery without requiring a real GitHub repo.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { setExecImpl } from "./exec.ts";
import { discoverParentPrd } from "./issues.ts";

// ---------------------------------------------------------------------------
// Mock setup — swap execSync via DI
// ---------------------------------------------------------------------------

const mockExecSync = mock();
let restoreExec: () => void;

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
