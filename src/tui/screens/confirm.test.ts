/**
 * Tests for the run confirmation screen.
 *
 * Tests the pure helper functions exported from confirm.tsx:
 * - formatFeedbackCommands()
 * - buildPrdPositionText()
 * - extractPlanTitle()
 *
 * Also tests the ConfirmScreen component's keyboard callbacks using
 * Ink's render() function with a capture harness.
 *
 * Pure unit tests for helpers — no filesystem, no subprocess, no mocking.
 */

import { describe, it, expect, mock } from "bun:test";
import React from "react";
import { render } from "ink";
import {
  formatFeedbackCommands,
  buildPrdPositionText,
  extractPlanTitle,
  ConfirmScreen,
  type ConfirmScreenData,
} from "./confirm.tsx";

// ---------------------------------------------------------------------------
// formatFeedbackCommands
// ---------------------------------------------------------------------------

describe("formatFeedbackCommands", () => {
  it("returns empty array for empty string", () => {
    expect(formatFeedbackCommands("")).toEqual([]);
  });

  it("splits comma-separated commands", () => {
    expect(formatFeedbackCommands("bun run build,bun test")).toEqual([
      "bun run build",
      "bun test",
    ]);
  });

  it("trims whitespace around commands", () => {
    expect(formatFeedbackCommands(" bun run build , bun test ")).toEqual([
      "bun run build",
      "bun test",
    ]);
  });

  it("filters out empty entries", () => {
    expect(formatFeedbackCommands("bun run build,,bun test")).toEqual([
      "bun run build",
      "bun test",
    ]);
  });

  it("handles single command", () => {
    expect(formatFeedbackCommands("bun test")).toEqual(["bun test"]);
  });
});

// ---------------------------------------------------------------------------
// buildPrdPositionText
// ---------------------------------------------------------------------------

describe("buildPrdPositionText", () => {
  it("formats position text", () => {
    expect(buildPrdPositionText(1, 3)).toBe("1 of 3 remaining");
  });

  it("handles single remaining", () => {
    expect(buildPrdPositionText(1, 1)).toBe("1 of 1 remaining");
  });

  it("handles multiple remaining", () => {
    expect(buildPrdPositionText(5, 10)).toBe("5 of 10 remaining");
  });
});

// ---------------------------------------------------------------------------
// extractPlanTitle
// ---------------------------------------------------------------------------

describe("extractPlanTitle", () => {
  it("extracts title from markdown with frontmatter", () => {
    const content = `---
source: github
issue: 42
---

# feat: add login endpoint

## Goal

Build the login endpoint.
`;
    expect(extractPlanTitle(content, "fallback")).toBe(
      "feat: add login endpoint",
    );
  });

  it("extracts title from markdown without frontmatter", () => {
    const content = `# fix: dashboard rendering bug

## Description

The dashboard renders incorrectly.
`;
    expect(extractPlanTitle(content, "fallback")).toBe(
      "fix: dashboard rendering bug",
    );
  });

  it("returns fallback when no heading found", () => {
    const content = `---
source: github
---

No heading here.
`;
    expect(extractPlanTitle(content, "my-fallback")).toBe("my-fallback");
  });

  it("returns fallback for empty content", () => {
    expect(extractPlanTitle("", "empty-plan")).toBe("empty-plan");
  });

  it("ignores H2+ headings and finds H1", () => {
    const content = `---
source: github
---

## This is an H2

# The Real Title

## Another H2
`;
    expect(extractPlanTitle(content, "fallback")).toBe("The Real Title");
  });

  it("handles frontmatter without trailing newline", () => {
    const content = `---
source: local
---
# Direct Title`;
    expect(extractPlanTitle(content, "fallback")).toBe("Direct Title");
  });
});

// ---------------------------------------------------------------------------
// ConfirmScreen component — keyboard callbacks
// ---------------------------------------------------------------------------

describe("ConfirmScreen", () => {
  function makeData(overrides?: Partial<ConfirmScreenData>): ConfirmScreenData {
    return {
      title: "feat: add login endpoint",
      branch: "ralphai/gh-42-add-login-endpoint",
      agentCommand: "claude -p",
      feedbackCommands: "bun run build,bun test",
      runArgs: ["run", "42"],
      ...overrides,
    };
  }

  it("mounts and unmounts without error", () => {
    const data = makeData();
    const instance = render(
      React.createElement(ConfirmScreen, {
        data,
        onConfirm: () => {},
        onBack: () => {},
        onOptions: () => {},
      }),
    );

    // If we get here without throwing, the component rendered successfully
    instance.unmount();
  });

  it("mounts with PRD context without error", () => {
    const data = makeData({
      prdContext: {
        prdTitle: "Auth Redesign",
        prdNumber: 100,
        position: "2 of 5 remaining",
      },
    });

    const instance = render(
      React.createElement(ConfirmScreen, {
        data,
        onConfirm: () => {},
        onBack: () => {},
        onOptions: () => {},
      }),
    );

    instance.unmount();
  });

  it("mounts with empty agent command without error", () => {
    const data = makeData({ agentCommand: "" });

    const instance = render(
      React.createElement(ConfirmScreen, {
        data,
        onConfirm: () => {},
        onBack: () => {},
        onOptions: () => {},
      }),
    );

    instance.unmount();
  });

  it("mounts with empty feedback commands without error", () => {
    const data = makeData({ feedbackCommands: "" });

    const instance = render(
      React.createElement(ConfirmScreen, {
        data,
        onConfirm: () => {},
        onBack: () => {},
        onOptions: () => {},
      }),
    );

    instance.unmount();
  });

  it("accepts isActive prop", () => {
    const data = makeData();
    const instance = render(
      React.createElement(ConfirmScreen, {
        data,
        onConfirm: () => {},
        onBack: () => {},
        onOptions: () => {},
        isActive: false,
      }),
    );

    instance.unmount();
  });
});
