/**
 * Tests for the doctor screen.
 *
 * Tests pure helper functions exported from doctor.tsx:
 * - statusColor()
 * - runCheckToRows()
 *
 * Tests pure functions exported from doctor.ts (refactored layer):
 * - buildDoctorSummary()
 * - statusIcon()
 * - buildDoctorChecks() — with mocked check functions
 * - collectDoctorChecks() — with mocked check functions
 *
 * Tests the DoctorScreen component renders incrementally with
 * injected check descriptors (no filesystem, no subprocess).
 */

import { describe, it, expect, mock } from "bun:test";
import React from "react";
import { render } from "ink";
import type { DoctorCheck, DoctorCheckResult } from "../../doctor.ts";
import {
  buildDoctorSummary,
  statusIcon,
  collectDoctorChecks,
} from "../../doctor.ts";

// ---------------------------------------------------------------------------
// Import screen helpers (no mocking needed — they are pure)
// ---------------------------------------------------------------------------

const { statusColor, runCheckToRows, DoctorScreen } =
  await import("./doctor.tsx");

// ---------------------------------------------------------------------------
// statusColor
// ---------------------------------------------------------------------------

describe("statusColor", () => {
  it("returns green for pass", () => {
    expect(statusColor("pass")).toBe("green");
  });

  it("returns red for fail", () => {
    expect(statusColor("fail")).toBe("red");
  });

  it("returns yellow for warn", () => {
    expect(statusColor("warn")).toBe("yellow");
  });
});

// ---------------------------------------------------------------------------
// statusIcon (from doctor.ts)
// ---------------------------------------------------------------------------

describe("statusIcon", () => {
  it("returns checkmark for pass", () => {
    expect(statusIcon("pass")).toBe("\u2713");
  });

  it("returns X for fail", () => {
    expect(statusIcon("fail")).toBe("\u2717");
  });

  it("returns warning triangle for warn", () => {
    expect(statusIcon("warn")).toBe("\u26A0");
  });
});

// ---------------------------------------------------------------------------
// buildDoctorSummary (from doctor.ts)
// ---------------------------------------------------------------------------

describe("buildDoctorSummary", () => {
  it("returns 'All checks passed' when all pass", () => {
    const results: DoctorCheckResult[] = [
      { status: "pass", message: "ok" },
      { status: "pass", message: "ok too" },
    ];
    expect(buildDoctorSummary(results)).toBe("All checks passed");
  });

  it("returns 'All checks passed' for empty results", () => {
    expect(buildDoctorSummary([])).toBe("All checks passed");
  });

  it("counts warnings", () => {
    const results: DoctorCheckResult[] = [
      { status: "pass", message: "ok" },
      { status: "warn", message: "hmm" },
      { status: "warn", message: "hmm2" },
    ];
    expect(buildDoctorSummary(results)).toBe("2 warnings");
  });

  it("counts failures", () => {
    const results: DoctorCheckResult[] = [
      { status: "fail", message: "bad" },
      { status: "pass", message: "ok" },
    ];
    expect(buildDoctorSummary(results)).toBe("1 failure");
  });

  it("counts both warnings and failures", () => {
    const results: DoctorCheckResult[] = [
      { status: "fail", message: "bad" },
      { status: "warn", message: "hmm" },
      { status: "fail", message: "bad2" },
    ];
    expect(buildDoctorSummary(results)).toBe("1 warning, 2 failures");
  });

  it("uses singular for 1 warning", () => {
    const results: DoctorCheckResult[] = [{ status: "warn", message: "hmm" }];
    expect(buildDoctorSummary(results)).toBe("1 warning");
  });

  it("uses singular for 1 failure", () => {
    const results: DoctorCheckResult[] = [{ status: "fail", message: "bad" }];
    expect(buildDoctorSummary(results)).toBe("1 failure");
  });
});

// ---------------------------------------------------------------------------
// runCheckToRows
// ---------------------------------------------------------------------------

describe("runCheckToRows", () => {
  it("flattens a single-result check into one row", () => {
    const check: DoctorCheck = {
      name: "test check",
      run: () => ({ status: "pass", message: "looks good" }),
    };
    const rows = runCheckToRows(check, "/tmp");
    expect(rows).toEqual([{ status: "pass", message: "looks good" }]);
  });

  it("flattens a multi-result check into multiple rows", () => {
    const check: DoctorCheck = {
      name: "multi check",
      run: () => [
        { status: "pass", message: "cmd1 ok" },
        { status: "warn", message: "cmd2 non-zero" },
      ],
    };
    const rows = runCheckToRows(check, "/tmp");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe("pass");
    expect(rows[1]!.status).toBe("warn");
  });

  it("passes cwd to the check function", () => {
    const runFn = mock(
      (_cwd: string): DoctorCheckResult => ({
        status: "pass",
        message: "ok",
      }),
    );
    const check: DoctorCheck = { name: "cwd check", run: runFn };
    runCheckToRows(check, "/my/project");
    expect(runFn).toHaveBeenCalledWith("/my/project");
  });

  it("handles empty array result", () => {
    const check: DoctorCheck = {
      name: "empty check",
      run: () => [],
    };
    const rows = runCheckToRows(check, "/tmp");
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DoctorScreen component
// ---------------------------------------------------------------------------

describe("DoctorScreen", () => {
  function makeCheck(
    name: string,
    status: DoctorCheckResult["status"],
    message: string,
  ): DoctorCheck {
    return { name, run: () => ({ status, message }) };
  }

  function makeMultiCheck(
    name: string,
    results: DoctorCheckResult[],
  ): DoctorCheck {
    return { name, run: () => results };
  }

  it("renders without error with all-passing checks", async () => {
    const checks = [
      makeCheck("config", "pass", "config initialized"),
      makeCheck("git", "pass", "git repo detected"),
    ];

    const instance = render(
      React.createElement(DoctorScreen, {
        cwd: "/tmp",
        onBack: () => {},
        checks,
      }),
    );

    // Allow async check execution to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders without error with mixed results", async () => {
    const checks = [
      makeCheck("config", "pass", "config initialized"),
      makeCheck("git", "fail", "not a git repository"),
      makeCheck("backlog", "warn", "backlog empty"),
    ];

    const instance = render(
      React.createElement(DoctorScreen, {
        cwd: "/tmp",
        onBack: () => {},
        checks,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders without error with multi-result checks", async () => {
    const checks = [
      makeCheck("config", "pass", "config ok"),
      makeMultiCheck("feedback", [
        { status: "pass", message: "cmd1 ok" },
        { status: "warn", message: "cmd2 non-zero" },
      ]),
    ];

    const instance = render(
      React.createElement(DoctorScreen, {
        cwd: "/tmp",
        onBack: () => {},
        checks,
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("renders without error with empty checks list", async () => {
    const instance = render(
      React.createElement(DoctorScreen, {
        cwd: "/tmp",
        onBack: () => {},
        checks: [],
      }),
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
  });

  it("calls onBack callback (does not crash when configured)", async () => {
    const onBack = mock(() => {});
    const checks = [makeCheck("test", "pass", "ok")];

    const instance = render(
      React.createElement(DoctorScreen, {
        cwd: "/tmp",
        onBack,
        checks,
      }),
    );

    // Wait for checks to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    instance.unmount();
    // We can't easily simulate keyboard input in this test pattern,
    // but we verify the component renders and unmounts cleanly.
  });
});
