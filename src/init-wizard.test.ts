import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ralphaiSrc = readFileSync(join(__dirname, "ralphai.ts"), "utf-8");

describe("init wizard", () => {
  it("does not prompt for removed workflow options", () => {
    expect(ralphaiSrc).not.toContain('message: "Workflow mode:"');
  });

  // ---------------------------------------------------------------------------
  // Labels are NOT prompted — they are created automatically with defaults
  // ---------------------------------------------------------------------------

  it("does not prompt for label names", () => {
    expect(ralphaiSrc).not.toContain(
      'message: "Standalone issue label (base name):"',
    );
    expect(ralphaiSrc).not.toContain('message: "Sub-issue label (base name):"');
    expect(ralphaiSrc).not.toContain('message: "PRD label (base name):"');
  });

  it("WizardAnswers type does not include label fields", () => {
    const parseOptsSrc = readFileSync(
      join(__dirname, "parse-options.ts"),
      "utf-8",
    );
    expect(parseOptsSrc).not.toContain("standaloneLabel?:");
    expect(parseOptsSrc).not.toContain("subissueLabel?:");
    expect(parseOptsSrc).not.toContain("prdLabel?:");
  });

  // ---------------------------------------------------------------------------
  // scaffold uses DEFAULTS directly for label values
  // ---------------------------------------------------------------------------

  it("scaffold uses DEFAULTS directly for label values", () => {
    expect(ralphaiSrc).toContain("standaloneLabel: DEFAULTS.standaloneLabel");
    expect(ralphaiSrc).toContain("subissueLabel: DEFAULTS.subissueLabel");
    expect(ralphaiSrc).toContain("prdLabel: DEFAULTS.prdLabel");
  });

  // ---------------------------------------------------------------------------
  // Post-init text references configured label
  // ---------------------------------------------------------------------------

  it("post-init GitHub hint uses configObj label value", () => {
    expect(ralphaiSrc).toContain(
      'configObj.standaloneLabel}" and Ralphai will pick it up automatically',
    );
  });

  // ---------------------------------------------------------------------------
  // Docker sandboxing step
  // ---------------------------------------------------------------------------

  it("wizard prompts for Docker sandboxing", () => {
    expect(ralphaiSrc).toContain("Enable Docker sandboxing?");
  });

  it("wizard shows recommendation when Docker detected", () => {
    expect(ralphaiSrc).toContain(
      "Enable Docker sandboxing? (recommended — Docker detected)",
    );
  });

  it("wizard notes Docker not detected when unavailable", () => {
    expect(ralphaiSrc).toContain(
      "Enable Docker sandboxing? (Docker not detected)",
    );
  });

  it("WizardAnswers type includes sandbox field", () => {
    const parseOptsSrc = readFileSync(
      join(__dirname, "parse-options.ts"),
      "utf-8",
    );
    expect(parseOptsSrc).toContain('sandbox?: "none" | "docker"');
  });

  it("scaffold writes sandbox to config", () => {
    expect(ralphaiSrc).toContain('sandbox: answers.sandbox ?? "none"');
  });

  it("--yes mode auto-detects Docker for sandbox", () => {
    expect(ralphaiSrc).toContain("detectDockerAvailable()");
    // Sandbox is included in the detection summary
    expect(ralphaiSrc).toContain("Sandbox:");
  });
});
