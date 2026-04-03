import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ralphaiSrc = readFileSync(join(__dirname, "ralphai.ts"), "utf-8");

describe("init wizard", () => {
  it("does not prompt for removed workflow options", () => {
    expect(ralphaiSrc).not.toContain('message: "Workflow mode:"');
    expect(ralphaiSrc).not.toContain('message: "Auto-commit between tasks?"');
  });

  // ---------------------------------------------------------------------------
  // Label prompts in wizard when GitHub Issues enabled
  // ---------------------------------------------------------------------------

  it("prompts for all four label names when issues are enabled", () => {
    expect(ralphaiSrc).toContain('message: "Issue intake label:"');
    expect(ralphaiSrc).toContain('message: "Issue in-progress label:"');
    expect(ralphaiSrc).toContain('message: "Issue done label:"');
    expect(ralphaiSrc).toContain('message: "PRD label:"');
  });

  it("label prompts use DEFAULTS as initialValue", () => {
    expect(ralphaiSrc).toContain("initialValue: DEFAULTS.issueLabel");
    expect(ralphaiSrc).toContain("initialValue: DEFAULTS.issueInProgressLabel");
    expect(ralphaiSrc).toContain("initialValue: DEFAULTS.issueDoneLabel");
    expect(ralphaiSrc).toContain("initialValue: DEFAULTS.issuePrdLabel");
  });

  it("label prompts are inside the enableIssues block", () => {
    // Extract the section from "if (enableIssues)" to the AGENTS.md step
    const issueBlock = ralphaiSrc.slice(
      ralphaiSrc.indexOf("if (enableIssues)"),
      ralphaiSrc.indexOf("// 7. Update AGENTS.md"),
    );
    expect(issueBlock).toContain('message: "Issue intake label:"');
    expect(issueBlock).toContain('message: "PRD label:"');
  });

  it("wizard returns label fields in the answers object", () => {
    // The return statement should include all four label fields
    expect(ralphaiSrc).toContain("issueLabel,");
    expect(ralphaiSrc).toContain("issueInProgressLabel,");
    expect(ralphaiSrc).toContain("issueDoneLabel,");
    expect(ralphaiSrc).toContain("issuePrdLabel,");
  });

  // ---------------------------------------------------------------------------
  // WizardAnswers type includes label fields
  // ---------------------------------------------------------------------------

  it("WizardAnswers type includes label fields", () => {
    const parseOptsSrc = readFileSync(
      join(__dirname, "parse-options.ts"),
      "utf-8",
    );
    expect(parseOptsSrc).toContain("issueLabel?:");
    expect(parseOptsSrc).toContain("issueInProgressLabel?:");
    expect(parseOptsSrc).toContain("issueDoneLabel?:");
    expect(parseOptsSrc).toContain("issuePrdLabel?:");
  });

  // ---------------------------------------------------------------------------
  // scaffold uses answers' label values with fallback to DEFAULTS
  // ---------------------------------------------------------------------------

  it("scaffold uses answers label values with DEFAULTS fallback", () => {
    expect(ralphaiSrc).toContain("answers.issueLabel ?? DEFAULTS.issueLabel");
    expect(ralphaiSrc).toContain(
      "answers.issueInProgressLabel ?? DEFAULTS.issueInProgressLabel",
    );
    expect(ralphaiSrc).toContain(
      "answers.issueDoneLabel ?? DEFAULTS.issueDoneLabel",
    );
    expect(ralphaiSrc).toContain(
      "answers.issuePrdLabel ?? DEFAULTS.issuePrdLabel",
    );
  });

  // ---------------------------------------------------------------------------
  // Post-init text references configured label, not hardcoded DEFAULTS
  // ---------------------------------------------------------------------------

  it("post-init GitHub hint uses answers label value", () => {
    expect(ralphaiSrc).toContain(
      'answers.issueLabel ?? DEFAULTS.issueLabel}" and Ralphai will pick it up automatically',
    );
  });
});
