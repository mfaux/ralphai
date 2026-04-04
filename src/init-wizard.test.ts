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

  it("prompts for all three base label names when issues are enabled", () => {
    expect(ralphaiSrc).toContain(
      'message: "Standalone issue label (base name):"',
    );
    expect(ralphaiSrc).toContain('message: "Sub-issue label (base name):"');
    expect(ralphaiSrc).toContain('message: "PRD label (base name):"');
  });

  it("label prompts use DEFAULTS as initialValue", () => {
    expect(ralphaiSrc).toContain("initialValue: DEFAULTS.standaloneLabel");
    expect(ralphaiSrc).toContain("initialValue: DEFAULTS.subissueLabel");
    expect(ralphaiSrc).toContain("initialValue: DEFAULTS.prdLabel");
  });

  it("label prompts are inside the enableIssues block", () => {
    // Extract the section from "if (enableIssues)" to the AGENTS.md step
    const issueBlock = ralphaiSrc.slice(
      ralphaiSrc.indexOf("if (enableIssues)"),
      ralphaiSrc.indexOf("// 7. Update AGENTS.md"),
    );
    expect(issueBlock).toContain(
      'message: "Standalone issue label (base name):"',
    );
    expect(issueBlock).toContain('message: "PRD label (base name):"');
  });

  it("wizard returns label fields in the answers object", () => {
    // The return statement should include all three base label fields
    expect(ralphaiSrc).toContain("standaloneLabel,");
    expect(ralphaiSrc).toContain("subissueLabel,");
    expect(ralphaiSrc).toContain("prdLabel,");
  });

  // ---------------------------------------------------------------------------
  // WizardAnswers type includes label fields
  // ---------------------------------------------------------------------------

  it("WizardAnswers type includes label fields", () => {
    const parseOptsSrc = readFileSync(
      join(__dirname, "parse-options.ts"),
      "utf-8",
    );
    expect(parseOptsSrc).toContain("standaloneLabel?:");
    expect(parseOptsSrc).toContain("subissueLabel?:");
    expect(parseOptsSrc).toContain("prdLabel?:");
  });

  // ---------------------------------------------------------------------------
  // scaffold uses answers' label values with fallback to DEFAULTS
  // ---------------------------------------------------------------------------

  it("scaffold uses answers label values with DEFAULTS fallback", () => {
    expect(ralphaiSrc).toContain(
      "answers.standaloneLabel ?? DEFAULTS.standaloneLabel",
    );
    expect(ralphaiSrc).toContain(
      "answers.subissueLabel ?? DEFAULTS.subissueLabel",
    );
    expect(ralphaiSrc).toContain("answers.prdLabel ?? DEFAULTS.prdLabel");
  });

  // ---------------------------------------------------------------------------
  // Post-init text references configured label, not hardcoded DEFAULTS
  // ---------------------------------------------------------------------------

  it("post-init GitHub hint uses answers label value", () => {
    expect(ralphaiSrc).toContain(
      'answers.standaloneLabel ?? DEFAULTS.standaloneLabel}" and Ralphai will pick it up automatically',
    );
  });
});
