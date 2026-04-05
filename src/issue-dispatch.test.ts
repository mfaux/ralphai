/**
 * Unit tests for issue-dispatch.ts — label-driven dispatch classification
 * and validation rules.
 *
 * Pure functions, no mocks needed.
 */
import { describe, expect, it } from "bun:test";

import {
  classifyIssue,
  validateStandalone,
  validateSubissue,
  type LabelConfig,
} from "./issue-dispatch.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default label config matching DEFAULTS in config.ts. */
const defaultConfig: LabelConfig = {
  standaloneLabel: "ralphai-standalone",
  subissueLabel: "ralphai-subissue",
  prdLabel: "ralphai-prd",
};

// ---------------------------------------------------------------------------
// classifyIssue — dispatch paths
// ---------------------------------------------------------------------------

describe("classifyIssue", () => {
  // Scenario 35: Standalone dispatches to dedicated branch
  it("classifies ralphai-standalone intake label as standalone", () => {
    const result = classifyIssue(["ralphai-standalone"], defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("standalone");
    }
  });

  it("classifies issue with ralphai-standalone and in-progress as standalone", () => {
    const result = classifyIssue(
      ["ralphai-standalone", "in-progress"],
      defaultConfig,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("standalone");
    }
  });

  // Scenario 36: Sub-issue dispatches to parent PRD's shared branch
  it("classifies ralphai-subissue intake label as subissue", () => {
    const result = classifyIssue(["ralphai-subissue"], defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("subissue");
    }
  });

  it("classifies issue with ralphai-subissue and in-progress as subissue", () => {
    const result = classifyIssue(
      ["ralphai-subissue", "in-progress"],
      defaultConfig,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("subissue");
    }
  });

  // Scenario 37: PRD dispatches to sub-issue processing on shared branch
  it("classifies ralphai-prd intake label as prd", () => {
    const result = classifyIssue(["ralphai-prd"], defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("prd");
    }
  });

  it("classifies issue with ralphai-prd and in-progress as prd", () => {
    const result = classifyIssue(["ralphai-prd", "in-progress"], defaultConfig);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("prd");
    }
  });

  // Scenario 33: No recognized label → error with guidance
  it("returns no-label when issue has no recognized labels", () => {
    const result = classifyIssue(["bug", "enhancement"], defaultConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-label");
      expect(result.message).toContain("ralphai-standalone");
      expect(result.message).toContain("ralphai-subissue");
      expect(result.message).toContain("ralphai-prd");
    }
  });

  it("returns no-label when issue has no labels at all", () => {
    const result = classifyIssue([], defaultConfig);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-label");
    }
  });

  // Priority: standalone checked first
  it("classifies as standalone when multiple family labels present", () => {
    const result = classifyIssue(
      ["ralphai-subissue", "ralphai-standalone"],
      defaultConfig,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("standalone");
    }
  });

  // Ignores unrelated labels
  it("ignores unrelated labels during classification", () => {
    const result = classifyIssue(
      ["bug", "ralphai-prd", "enhancement"],
      defaultConfig,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("prd");
    }
  });

  // Custom label config
  it("works with custom label configuration", () => {
    const custom: LabelConfig = {
      standaloneLabel: "my-bot",
      subissueLabel: "my-bot-sub",
      prdLabel: "my-bot-prd",
    };
    const result = classifyIssue(["my-bot"], custom);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("standalone");
    }
  });

  it("custom config with in-progress shared label works", () => {
    const custom: LabelConfig = {
      standaloneLabel: "my-bot",
      subissueLabel: "my-bot-sub",
      prdLabel: "my-bot-prd",
    };
    const result = classifyIssue(["my-bot-sub", "in-progress"], custom);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family).toBe("subissue");
    }
  });

  it("custom config no-label message includes custom label names", () => {
    const custom: LabelConfig = {
      standaloneLabel: "my-bot",
      subissueLabel: "my-bot-sub",
      prdLabel: "my-bot-prd",
    };
    const result = classifyIssue([], custom);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("my-bot");
      expect(result.message).toContain("my-bot-sub");
      expect(result.message).toContain("my-bot-prd");
    }
  });
});

// ---------------------------------------------------------------------------
// validateStandalone
// ---------------------------------------------------------------------------

describe("validateStandalone", () => {
  // Scenario 30: Standalone with parent PRD → skip with warning
  it("fails when standalone issue has a parent PRD", () => {
    const result = validateStandalone(42, 100);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain("#42");
      expect(result.message).toContain("#100");
      expect(result.message).toContain("standalone");
      expect(result.message).toContain("parent PRD");
    }
  });

  it("passes when standalone issue has no parent PRD", () => {
    const result = validateStandalone(42, undefined);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSubissue
// ---------------------------------------------------------------------------

describe("validateSubissue", () => {
  // Scenario 31: Sub-issue without parent PRD → skip with warning
  it("fails when sub-issue has no parent PRD", () => {
    const result = validateSubissue(55, undefined, false);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain("#55");
      expect(result.message).toContain("no parent PRD");
    }
  });

  // Scenario 32: Sub-issue with unlabeled parent → skip with warning
  it("fails when parent exists but lacks PRD label", () => {
    const result = validateSubissue(55, 100, false);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain("#55");
      expect(result.message).toContain("#100");
      expect(result.message).toContain("PRD label");
    }
  });

  it("passes when parent exists and has PRD label", () => {
    const result = validateSubissue(55, 100, true);
    expect(result.valid).toBe(true);
  });
});
