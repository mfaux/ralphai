/**
 * Tests for interactive maintenance action handlers.
 *
 * Tests handleDoctor, handleClean, handleViewConfig, and handleEditConfig.
 * Uses module mocking to verify delegation to existing commands without
 * requiring filesystem or subprocess access.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  handleDoctor,
  handleClean,
  handleViewConfig,
  handleEditConfig,
  ExitIntercepted,
} from "./maintenance-actions.ts";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

// We mock the delegated modules to avoid real side effects.
// Each test verifies the handler returns "continue" and delegates correctly.

const mockRunRalphai = mock<(args: string[]) => Promise<void>>();
const mockRunClean =
  mock<
    (opts: {
      cwd: string;
      yes: boolean;
      worktrees: boolean;
      archive: boolean;
    }) => Promise<void>
  >();
const mockRunConfigCommand =
  mock<(opts: { cwd: string; key?: string; check?: string[] }) => void>();

mock.module("../ralphai.ts", () => ({
  runRalphai: mockRunRalphai,
}));

mock.module("../clean.ts", () => ({
  runClean: mockRunClean,
}));

mock.module("../config-cmd.ts", () => ({
  runConfigCommand: mockRunConfigCommand,
}));

beforeEach(() => {
  mockRunRalphai.mockReset();
  mockRunClean.mockReset();
  mockRunConfigCommand.mockReset();
});

// ---------------------------------------------------------------------------
// ExitIntercepted sentinel
// ---------------------------------------------------------------------------

describe("ExitIntercepted", () => {
  it("is an Error subclass", () => {
    const err = new ExitIntercepted();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ExitIntercepted");
  });
});

// ---------------------------------------------------------------------------
// handleDoctor
// ---------------------------------------------------------------------------

describe("handleDoctor", () => {
  it("delegates to runRalphai(['doctor']) and returns 'continue'", async () => {
    mockRunRalphai.mockResolvedValue(undefined);
    const result = await handleDoctor("/fake/cwd");
    expect(result).toBe("continue");
    expect(mockRunRalphai).toHaveBeenCalledWith(["doctor"]);
  });

  it("returns 'continue' even when doctor triggers process.exit", async () => {
    mockRunRalphai.mockImplementation(async () => {
      // Simulate what doctor does on failure — calls process.exit(1)
      process.exit(1);
    });
    const result = await handleDoctor("/fake/cwd");
    expect(result).toBe("continue");
  });

  it("restores process.exit after completion", async () => {
    const originalExit = process.exit;
    mockRunRalphai.mockResolvedValue(undefined);
    await handleDoctor("/fake/cwd");
    expect(process.exit).toBe(originalExit);
  });

  it("restores process.exit even when doctor throws process.exit", async () => {
    const originalExit = process.exit;
    mockRunRalphai.mockImplementation(async () => {
      process.exit(1);
    });
    await handleDoctor("/fake/cwd");
    expect(process.exit).toBe(originalExit);
  });

  it("re-throws non-ExitIntercepted errors", async () => {
    mockRunRalphai.mockRejectedValue(new Error("unexpected"));
    await expect(handleDoctor("/fake/cwd")).rejects.toThrow("unexpected");
  });
});

// ---------------------------------------------------------------------------
// handleClean
// ---------------------------------------------------------------------------

describe("handleClean", () => {
  it("delegates to runClean with correct options and returns 'continue'", async () => {
    mockRunClean.mockResolvedValue(undefined);
    const result = await handleClean("/fake/cwd");
    expect(result).toBe("continue");
    expect(mockRunClean).toHaveBeenCalledWith({
      cwd: "/fake/cwd",
      yes: false,
      worktrees: true,
      archive: true,
    });
  });

  it("passes yes: false so user gets confirmation prompt", async () => {
    mockRunClean.mockResolvedValue(undefined);
    await handleClean("/any/dir");
    const callArgs = mockRunClean.mock.calls[0]![0];
    expect(callArgs.yes).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleViewConfig
// ---------------------------------------------------------------------------

describe("handleViewConfig", () => {
  it("delegates to runConfigCommand with cwd and returns 'continue'", () => {
    mockRunConfigCommand.mockImplementation(() => {});
    const result = handleViewConfig("/fake/cwd");
    expect(result).toBe("continue");
    expect(mockRunConfigCommand).toHaveBeenCalledWith({ cwd: "/fake/cwd" });
  });

  it("returns 'continue' when config command triggers process.exit", () => {
    mockRunConfigCommand.mockImplementation(() => {
      process.exit(1);
    });
    const result = handleViewConfig("/fake/cwd");
    expect(result).toBe("continue");
  });

  it("restores process.exit after completion", () => {
    const originalExit = process.exit;
    mockRunConfigCommand.mockImplementation(() => {});
    handleViewConfig("/fake/cwd");
    expect(process.exit).toBe(originalExit);
  });

  it("re-throws non-ExitIntercepted errors", () => {
    mockRunConfigCommand.mockImplementation(() => {
      throw new Error("config boom");
    });
    expect(() => handleViewConfig("/fake/cwd")).toThrow("config boom");
  });
});

// ---------------------------------------------------------------------------
// handleEditConfig
// ---------------------------------------------------------------------------

describe("handleEditConfig", () => {
  it("delegates to runRalphai(['init', '--force']) and returns 'continue'", async () => {
    mockRunRalphai.mockResolvedValue(undefined);
    const result = await handleEditConfig();
    expect(result).toBe("continue");
    expect(mockRunRalphai).toHaveBeenCalledWith(["init", "--force"]);
  });

  it("returns 'continue' when init wizard triggers process.exit", async () => {
    mockRunRalphai.mockImplementation(async () => {
      process.exit(1);
    });
    const result = await handleEditConfig();
    expect(result).toBe("continue");
  });

  it("restores process.exit after completion", async () => {
    const originalExit = process.exit;
    mockRunRalphai.mockResolvedValue(undefined);
    await handleEditConfig();
    expect(process.exit).toBe(originalExit);
  });

  it("re-throws non-ExitIntercepted errors", async () => {
    mockRunRalphai.mockRejectedValue(new Error("init boom"));
    await expect(handleEditConfig()).rejects.toThrow("init boom");
  });
});
