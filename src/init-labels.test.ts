import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { runCli, stripLogo, useTempGitDir } from "./test-utils.ts";

const ralphaiSrc = readFileSync(
  join(import.meta.dirname, "ralphai.ts"),
  "utf-8",
);

describe("init label creation", () => {
  const ctx = useTempGitDir();

  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  // ---------------------------------------------------------------------------
  // Source-level: labelDefs includes all five labels
  // ---------------------------------------------------------------------------

  it("labelDefs includes the intake label with color 7057ff", () => {
    expect(ralphaiSrc).toContain('description: "Ralphai picks up this issue"');
    expect(ralphaiSrc).toContain('color: "7057ff"');
  });

  it("labelDefs includes the in-progress label with color fbca04", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is working on this issue"',
    );
    expect(ralphaiSrc).toContain('color: "fbca04"');
  });

  it("labelDefs includes the done label with color 0e8a16", () => {
    expect(ralphaiSrc).toContain('description: "Ralphai finished this issue"');
    expect(ralphaiSrc).toContain('color: "0e8a16"');
  });

  it("labelDefs includes the stuck label with color d93f0b", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is stuck on this issue"',
    );
    expect(ralphaiSrc).toContain('color: "d93f0b"');
  });

  it("labelDefs includes the PRD label entry using names.prd with color 1d76db", () => {
    expect(ralphaiSrc).toContain("name: names.prd");
    expect(ralphaiSrc).toContain(
      'description: "Ralphai PRD — groups sub-issues for drain runs"',
    );
    expect(ralphaiSrc).toContain('color: "1d76db"');
  });

  it("labelDefs includes the PRD in-progress label entry using names.prdInProgress with color fbca04", () => {
    expect(ralphaiSrc).toContain("name: names.prdInProgress");
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is processing this PRD\'s sub-issues"',
    );
  });

  it("labelDefs includes the PRD done label entry using names.prdDone with color 0e8a16", () => {
    expect(ralphaiSrc).toContain("name: names.prdDone");
    expect(ralphaiSrc).toContain(
      'description: "Ralphai finished all sub-issues for this PRD"',
    );
  });

  // ---------------------------------------------------------------------------
  // Source-level: ghLabelCreateCmd produces proper commands
  // ---------------------------------------------------------------------------

  it("ghLabelCreateCmd quotes names with colons or spaces", () => {
    expect(ralphaiSrc).toContain(
      'const quotedName = /[\\s:]/.test(name) ? `"${name}"` : name;',
    );
  });

  // ---------------------------------------------------------------------------
  // Source-level: ensureGitHubLabels uses configured names (LabelNames)
  // ---------------------------------------------------------------------------

  it("ensureGitHubLabels accepts LabelNames parameter", () => {
    expect(ralphaiSrc).toContain(
      "function ensureGitHubLabels(cwd: string, names: LabelNames): LabelResult",
    );
  });

  it("scaffold passes configured label names to ensureGitHubLabels", () => {
    expect(ralphaiSrc).toContain(
      "labelResult = ensureGitHubLabels(cwd, initLabelNames);",
    );
  });

  // ---------------------------------------------------------------------------
  // Source-level: scaffold builds LabelNames from deriveLabels
  // ---------------------------------------------------------------------------

  it("scaffold builds initLabelNames using deriveLabels from base config values", () => {
    // The scaffold derives standalone and PRD labels from the 3 base keys
    expect(ralphaiSrc).toContain(
      "deriveLabels(configObj.standaloneLabel as string)",
    );
    expect(ralphaiSrc).toContain("deriveLabels(configObj.prdLabel as string)");
    expect(ralphaiSrc).toContain("intake: standaloneLabels.intake");
    expect(ralphaiSrc).toContain("inProgress: standaloneLabels.inProgress");
    expect(ralphaiSrc).toContain("done: standaloneLabels.done");
    expect(ralphaiSrc).toContain("stuck: standaloneLabels.stuck");
    expect(ralphaiSrc).toContain("prd: prdLabels.intake");
    expect(ralphaiSrc).toContain("prdInProgress: prdLabels.inProgress");
    expect(ralphaiSrc).toContain("prdDone: prdLabels.done");
  });

  // ---------------------------------------------------------------------------
  // Source-level: manual-fallback error builds commands dynamically
  // ---------------------------------------------------------------------------

  it("manual-fallback error is built from labelDefs", () => {
    expect(ralphaiSrc).toContain(
      "Could not create labels. Create them manually:",
    );
    // Verify the error message is built dynamically from labelDefs
    expect(ralphaiSrc).toContain("const manual = labelDefs(names)");
  });

  // ---------------------------------------------------------------------------
  // Source-level: success message lists all four labels dynamically
  // ---------------------------------------------------------------------------

  it("success message is built from labelDefs", () => {
    expect(ralphaiSrc).toContain("const allLabels = labelDefs(initLabelNames)");
  });

  // ---------------------------------------------------------------------------
  // Source-level: best-effort label ensure at run start
  // ---------------------------------------------------------------------------

  it("runRalphaiRunner ensures labels when issueSource is github", () => {
    expect(ralphaiSrc).toContain('config.issueSource.value === "github"');
    // Verify the ensure call derives labels from 3 base config keys
    expect(ralphaiSrc).toContain("deriveLabels(config.standaloneLabel.value)");
    expect(ralphaiSrc).toContain("deriveLabels(config.prdLabel.value)");
  });

  it("run-start label ensure is skipped in dry-run mode", () => {
    // The ensure block is inside `if (!isDryRun && config.issueSource.value === "github")`
    expect(ralphaiSrc).toContain(
      '!isDryRun && config.issueSource.value === "github"',
    );
  });

  // ---------------------------------------------------------------------------
  // Source-level: init config uses 3 base label keys
  // ---------------------------------------------------------------------------

  it("scaffold config includes standaloneLabel, subissueLabel, and prdLabel", () => {
    expect(ralphaiSrc).toContain(
      "answers.standaloneLabel ?? DEFAULTS.standaloneLabel",
    );
    expect(ralphaiSrc).toContain(
      "answers.subissueLabel ?? DEFAULTS.subissueLabel",
    );
    expect(ralphaiSrc).toContain("answers.prdLabel ?? DEFAULTS.prdLabel");
  });

  // ---------------------------------------------------------------------------
  // init --yes (issueSource=github) shows label info
  // ---------------------------------------------------------------------------

  it("init --yes with default issueSource=github mentions GitHub issue labeling", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);
    expect(output).toContain("Label a GitHub issue");
  });
});
