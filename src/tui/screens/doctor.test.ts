/**
 * Tests for the doctor screen's pure helper functions and check
 * infrastructure.
 *
 * Tests the exported helpers from `src/tui/screens/doctor.tsx`:
 * - `statusIcon` — returns a Unicode icon for a check status
 * - `statusColor` — returns a color string for a check status
 * - `buildDoctorResultLines` — converts check outcomes to display lines
 * - `buildSummary` — builds the summary from display lines
 * - `doctorKeyHandler` — maps key presses to intents
 *
 * Also tests the check infrastructure from `src/doctor.ts`:
 * - `buildDoctorChecks` — returns ordered check descriptors
 * - `runDoctorChecks` — executes checks with gating and callbacks
 */

import { describe, it, expect } from "bun:test";
import type { Key } from "ink";
import type {
  DoctorCheckResult,
  DoctorCheck,
  DoctorCheckOutcome,
} from "../../doctor.ts";
import { buildDoctorChecks, runDoctorChecks } from "../../doctor.ts";
import {
  statusIcon,
  statusColor,
  buildDoctorResultLines,
  buildSummary,
  doctorKeyHandler,
} from "./doctor.tsx";
import type { DoctorLine, DoctorSummary } from "./doctor.tsx";

// ---------------------------------------------------------------------------
// Key helper
// ---------------------------------------------------------------------------

function makeKey(overrides?: Partial<Key>): Key {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    super: false,
    hyper: false,
    capsLock: false,
    numLock: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Check fixture helpers
// ---------------------------------------------------------------------------

function makeCheck(overrides?: Partial<DoctorCheck>): DoctorCheck {
  return {
    key: "test-check",
    label: "Test check",
    run: () => ({ status: "pass", message: "test passed" }),
    ...overrides,
  };
}

function makeDoneOutcome(results: DoctorCheckResult[]): DoctorCheckOutcome {
  return { status: "done", results };
}

function makeSkippedOutcome(reason: string): DoctorCheckOutcome {
  return { status: "skipped", reason };
}

// ---------------------------------------------------------------------------
// statusIcon
// ---------------------------------------------------------------------------

describe("statusIcon", () => {
  it("returns checkmark for pass", () => {
    expect(statusIcon("pass")).toBe("\u2713");
  });

  it("returns cross for fail", () => {
    expect(statusIcon("fail")).toBe("\u2717");
  });

  it("returns warning for warn", () => {
    expect(statusIcon("warn")).toBe("\u26A0");
  });
});

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
// buildDoctorResultLines
// ---------------------------------------------------------------------------

describe("buildDoctorResultLines", () => {
  it("returns empty array for empty outcomes", () => {
    const checks = [makeCheck({ key: "a" })];
    const outcomes = new Map<string, DoctorCheckOutcome>();
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines).toEqual([]);
  });

  it("skips pending outcomes", () => {
    const checks = [makeCheck({ key: "a" })];
    const outcomes = new Map<string, DoctorCheckOutcome>([
      ["a", { status: "pending" }],
    ]);
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines).toEqual([]);
  });

  it("renders a passing check with checkmark icon", () => {
    const checks = [makeCheck({ key: "a", label: "Config exists" })];
    const outcomes = new Map<string, DoctorCheckOutcome>([
      ["a", makeDoneOutcome([{ status: "pass", message: "config found" }])],
    ]);
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.icon).toBe("\u2713");
    expect(lines[0]!.color).toBe("green");
    expect(lines[0]!.message).toBe("config found");
    expect(lines[0]!.status).toBe("pass");
  });

  it("renders a failing check with cross icon", () => {
    const checks = [makeCheck({ key: "a" })];
    const outcomes = new Map<string, DoctorCheckOutcome>([
      [
        "a",
        makeDoneOutcome([
          { status: "fail", message: "config not found — run ralphai init" },
        ]),
      ],
    ]);
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.icon).toBe("\u2717");
    expect(lines[0]!.color).toBe("red");
    expect(lines[0]!.message).toBe("config not found — run ralphai init");
    expect(lines[0]!.status).toBe("fail");
  });

  it("renders a warning check with warning icon", () => {
    const checks = [makeCheck({ key: "a" })];
    const outcomes = new Map<string, DoctorCheckOutcome>([
      ["a", makeDoneOutcome([{ status: "warn", message: "no plans queued" }])],
    ]);
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.icon).toBe("\u26A0");
    expect(lines[0]!.color).toBe("yellow");
    expect(lines[0]!.status).toBe("warn");
  });

  it("renders a skipped check with dash icon", () => {
    const checks = [makeCheck({ key: "a", label: "Working tree" })];
    const outcomes = new Map<string, DoctorCheckOutcome>([
      ["a", makeSkippedOutcome("git-repo failed")],
    ]);
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.icon).toBe("-");
    expect(lines[0]!.color).toBe("gray");
    expect(lines[0]!.message).toBe("Working tree: skipped (git-repo failed)");
    expect(lines[0]!.status).toBe("skipped");
  });

  it("expands multi-result checks into multiple lines", () => {
    const checks = [makeCheck({ key: "a" })];
    const outcomes = new Map<string, DoctorCheckOutcome>([
      [
        "a",
        makeDoneOutcome([
          { status: "pass", message: "feedback: build — exits 0" },
          { status: "warn", message: "feedback: test — exits non-zero" },
        ]),
      ],
    ]);
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.status).toBe("pass");
    expect(lines[1]!.status).toBe("warn");
  });

  it("preserves check order from descriptors", () => {
    const checks = [
      makeCheck({ key: "a", label: "A" }),
      makeCheck({ key: "b", label: "B" }),
      makeCheck({ key: "c", label: "C" }),
    ];
    const outcomes = new Map<string, DoctorCheckOutcome>([
      ["c", makeDoneOutcome([{ status: "pass", message: "c ok" }])],
      ["a", makeDoneOutcome([{ status: "pass", message: "a ok" }])],
      ["b", makeDoneOutcome([{ status: "pass", message: "b ok" }])],
    ]);
    const lines = buildDoctorResultLines(checks, outcomes);
    expect(lines.map((l) => l.message)).toEqual(["a ok", "b ok", "c ok"]);
  });
});

// ---------------------------------------------------------------------------
// buildSummary
// ---------------------------------------------------------------------------

describe("buildSummary", () => {
  it("returns all-passed text when everything passes", () => {
    const lines: DoctorLine[] = [
      { icon: "\u2713", color: "green", message: "ok", status: "pass" },
      { icon: "\u2713", color: "green", message: "ok", status: "pass" },
    ];
    const summary = buildSummary(lines);
    expect(summary.text).toBe("All checks passed");
    expect(summary.passes).toBe(2);
    expect(summary.failures).toBe(0);
    expect(summary.warnings).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it("counts failures and warnings", () => {
    const lines: DoctorLine[] = [
      { icon: "\u2713", color: "green", message: "ok", status: "pass" },
      { icon: "\u2717", color: "red", message: "fail", status: "fail" },
      { icon: "\u26A0", color: "yellow", message: "warn", status: "warn" },
      { icon: "-", color: "gray", message: "skip", status: "skipped" },
    ];
    const summary = buildSummary(lines);
    expect(summary.passes).toBe(1);
    expect(summary.failures).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it("shows failures and warnings in summary text", () => {
    const lines: DoctorLine[] = [
      { icon: "\u2717", color: "red", message: "fail1", status: "fail" },
      { icon: "\u2717", color: "red", message: "fail2", status: "fail" },
      { icon: "\u26A0", color: "yellow", message: "warn1", status: "warn" },
    ];
    const summary = buildSummary(lines);
    expect(summary.text).toBe("2 failures, 1 warning");
  });

  it("shows only failures when no warnings", () => {
    const lines: DoctorLine[] = [
      { icon: "\u2717", color: "red", message: "fail", status: "fail" },
    ];
    const summary = buildSummary(lines);
    expect(summary.text).toBe("1 failure");
  });

  it("shows only warnings when no failures", () => {
    const lines: DoctorLine[] = [
      { icon: "\u26A0", color: "yellow", message: "warn", status: "warn" },
      { icon: "\u26A0", color: "yellow", message: "warn2", status: "warn" },
    ];
    const summary = buildSummary(lines);
    expect(summary.text).toBe("2 warnings");
  });

  it("handles empty lines (no checks ran)", () => {
    const summary = buildSummary([]);
    expect(summary.text).toBe("All checks passed");
    expect(summary.passes).toBe(0);
  });

  it("treats skipped checks as neither pass nor fail in summary text", () => {
    const lines: DoctorLine[] = [
      { icon: "\u2713", color: "green", message: "ok", status: "pass" },
      { icon: "-", color: "gray", message: "skip", status: "skipped" },
    ];
    const summary = buildSummary(lines);
    expect(summary.text).toBe("All checks passed");
    expect(summary.skipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// doctorKeyHandler
// ---------------------------------------------------------------------------

describe("doctorKeyHandler", () => {
  it("returns back on Escape regardless of completion", () => {
    expect(doctorKeyHandler("", makeKey({ escape: true }), false)).toBe("back");
    expect(doctorKeyHandler("", makeKey({ escape: true }), true)).toBe("back");
  });

  it("returns back on Enter when complete", () => {
    expect(doctorKeyHandler("", makeKey({ return: true }), true)).toBe("back");
  });

  it("returns null on Enter when not complete", () => {
    expect(doctorKeyHandler("", makeKey({ return: true }), false)).toBeNull();
  });

  it("returns null for regular character input", () => {
    expect(doctorKeyHandler("a", makeKey(), false)).toBeNull();
    expect(doctorKeyHandler("a", makeKey(), true)).toBeNull();
  });

  it("returns null for arrow keys", () => {
    expect(doctorKeyHandler("", makeKey({ upArrow: true }), true)).toBeNull();
    expect(doctorKeyHandler("", makeKey({ downArrow: true }), true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildDoctorChecks
// ---------------------------------------------------------------------------

describe("buildDoctorChecks", () => {
  it("returns an array of check descriptors", () => {
    const checks = buildDoctorChecks();
    expect(checks.length).toBeGreaterThan(0);
  });

  it("each check has key, label, and run", () => {
    const checks = buildDoctorChecks();
    for (const check of checks) {
      expect(typeof check.key).toBe("string");
      expect(check.key.length).toBeGreaterThan(0);
      expect(typeof check.label).toBe("string");
      expect(check.label.length).toBeGreaterThan(0);
      expect(typeof check.run).toBe("function");
    }
  });

  it("has unique keys", () => {
    const checks = buildDoctorChecks();
    const keys = checks.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes expected checks", () => {
    const checks = buildDoctorChecks();
    const keys = checks.map((c) => c.key);
    expect(keys).toContain("config-exists");
    expect(keys).toContain("config-valid");
    expect(keys).toContain("git-repo");
    expect(keys).toContain("working-tree");
    expect(keys).toContain("base-branch");
    expect(keys).toContain("agent-command");
    expect(keys).toContain("feedback-commands");
    expect(keys).toContain("backlog");
    expect(keys).toContain("orphaned-receipts");
  });

  it("gates git checks on git-repo", () => {
    const checks = buildDoctorChecks();
    const workingTree = checks.find((c) => c.key === "working-tree")!;
    const baseBranch = checks.find((c) => c.key === "base-branch")!;
    expect(workingTree.gate).toBe("git-repo");
    expect(baseBranch.gate).toBe("git-repo");
  });

  it("gates config-dependent checks on config-valid", () => {
    const checks = buildDoctorChecks();
    const agent = checks.find((c) => c.key === "agent-command")!;
    const feedback = checks.find((c) => c.key === "feedback-commands")!;
    expect(agent.gate).toBe("config-valid");
    expect(feedback.gate).toBe("config-valid");
  });

  it("gates backlog and receipt checks on config-exists", () => {
    const checks = buildDoctorChecks();
    const backlog = checks.find((c) => c.key === "backlog")!;
    const receipts = checks.find((c) => c.key === "orphaned-receipts")!;
    expect(backlog.gate).toBe("config-exists");
    expect(receipts.gate).toBe("config-exists");
  });
});

// ---------------------------------------------------------------------------
// runDoctorChecks
// ---------------------------------------------------------------------------

describe("runDoctorChecks", () => {
  it("runs all checks and returns outcomes map", () => {
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "a",
        run: () => ({ status: "pass", message: "a ok" }),
      }),
      makeCheck({
        key: "b",
        run: () => ({ status: "pass", message: "b ok" }),
      }),
    ];

    const outcomes = runDoctorChecks("/tmp", checks);
    expect(outcomes.size).toBe(2);
    expect(outcomes.get("a")!.status).toBe("done");
    expect(outcomes.get("b")!.status).toBe("done");
  });

  it("skips gated checks when gate fails", () => {
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "gate-check",
        run: () => ({ status: "fail", message: "gate failed" }),
      }),
      makeCheck({
        key: "dependent",
        gate: "gate-check",
        run: () => ({ status: "pass", message: "should not run" }),
      }),
    ];

    const outcomes = runDoctorChecks("/tmp", checks);
    expect(outcomes.get("dependent")!.status).toBe("skipped");
    const depOutcome = outcomes.get("dependent")!;
    if (depOutcome.status === "skipped") {
      expect(depOutcome.reason).toBe("gate-check failed");
    }
  });

  it("does not skip gated checks when gate passes", () => {
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "gate-check",
        run: () => ({ status: "pass", message: "gate passed" }),
      }),
      makeCheck({
        key: "dependent",
        gate: "gate-check",
        run: () => ({ status: "pass", message: "dependent ran" }),
      }),
    ];

    const outcomes = runDoctorChecks("/tmp", checks);
    expect(outcomes.get("dependent")!.status).toBe("done");
  });

  it("does not skip gated checks when gate warns (only fails gate)", () => {
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "gate-check",
        run: () => ({ status: "warn", message: "gate warned" }),
      }),
      makeCheck({
        key: "dependent",
        gate: "gate-check",
        run: () => ({ status: "pass", message: "dependent ran" }),
      }),
    ];

    const outcomes = runDoctorChecks("/tmp", checks);
    expect(outcomes.get("dependent")!.status).toBe("done");
  });

  it("handles multi-result checks (arrays)", () => {
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "multi",
        run: () => [
          { status: "pass", message: "feedback: build — exits 0" },
          { status: "warn", message: "feedback: test — exits non-zero" },
        ],
      }),
    ];

    const outcomes = runDoctorChecks("/tmp", checks);
    const outcome = outcomes.get("multi")!;
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.results).toHaveLength(2);
    }
  });

  it("calls onResult callback for each check", () => {
    const callbackResults: Array<{
      key: string;
      outcome: DoctorCheckOutcome;
    }> = [];

    const checks: DoctorCheck[] = [
      makeCheck({
        key: "a",
        run: () => ({ status: "pass", message: "a ok" }),
      }),
      makeCheck({
        key: "b",
        run: () => ({ status: "fail", message: "b fail" }),
      }),
      makeCheck({
        key: "c",
        gate: "b",
        run: () => ({ status: "pass", message: "should skip" }),
      }),
    ];

    runDoctorChecks("/tmp", checks, (key, outcome) => {
      callbackResults.push({ key, outcome });
    });

    expect(callbackResults).toHaveLength(3);
    expect(callbackResults[0]!.key).toBe("a");
    expect(callbackResults[0]!.outcome.status).toBe("done");
    expect(callbackResults[1]!.key).toBe("b");
    expect(callbackResults[1]!.outcome.status).toBe("done");
    expect(callbackResults[2]!.key).toBe("c");
    expect(callbackResults[2]!.outcome.status).toBe("skipped");
  });

  it("handles checks without gates", () => {
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "no-gate",
        run: () => ({ status: "pass", message: "no gate" }),
      }),
    ];

    const outcomes = runDoctorChecks("/tmp", checks);
    expect(outcomes.get("no-gate")!.status).toBe("done");
  });

  it("handles chained gating (A gates B, B gates C)", () => {
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "a",
        run: () => ({ status: "fail", message: "a failed" }),
      }),
      makeCheck({
        key: "b",
        gate: "a",
        run: () => ({ status: "pass", message: "should not run" }),
      }),
      makeCheck({
        key: "c",
        gate: "b",
        run: () => ({ status: "pass", message: "should not run either" }),
      }),
    ];

    const outcomes = runDoctorChecks("/tmp", checks);
    expect(outcomes.get("a")!.status).toBe("done");
    expect(outcomes.get("b")!.status).toBe("skipped");
    // c is gated on b, but b was skipped (not "done" with fail), so c runs
    // This tests the edge case: skipped != failed for gating purposes
    expect(outcomes.get("c")!.status).toBe("done");
  });

  it("runs checks in order", () => {
    const order: string[] = [];
    const checks: DoctorCheck[] = [
      makeCheck({
        key: "first",
        run: () => {
          order.push("first");
          return { status: "pass", message: "first" };
        },
      }),
      makeCheck({
        key: "second",
        run: () => {
          order.push("second");
          return { status: "pass", message: "second" };
        },
      }),
      makeCheck({
        key: "third",
        run: () => {
          order.push("third");
          return { status: "pass", message: "third" };
        },
      }),
    ];

    runDoctorChecks("/tmp", checks);
    expect(order).toEqual(["first", "second", "third"]);
  });
});
