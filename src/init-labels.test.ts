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
  // Source-level: labelDefs produces 12 labels (3 families × 4 states)
  // ---------------------------------------------------------------------------

  it("labelDefs includes standalone intake label with color 7057ff", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai picks up this standalone issue"',
    );
    expect(ralphaiSrc).toContain('const STANDALONE_INTAKE_COLOR = "7057ff"');
  });

  it("labelDefs includes standalone in-progress label with shared yellow color", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is working on this standalone issue"',
    );
  });

  it("labelDefs includes standalone done label with shared green color", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai finished this standalone issue"',
    );
  });

  it("labelDefs includes standalone stuck label with shared red color", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is stuck on this standalone issue"',
    );
  });

  it("labelDefs includes subissue intake label with color c5def5", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai picks up this PRD sub-issue"',
    );
    expect(ralphaiSrc).toContain('const SUBISSUE_INTAKE_COLOR = "c5def5"');
  });

  it("labelDefs includes subissue in-progress label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is working on this PRD sub-issue"',
    );
  });

  it("labelDefs includes subissue done label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai finished this PRD sub-issue"',
    );
  });

  it("labelDefs includes subissue stuck label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is stuck on this PRD sub-issue"',
    );
  });

  it("labelDefs includes PRD intake label with color 1d76db", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai PRD — groups sub-issues for drain runs"',
    );
    expect(ralphaiSrc).toContain('const PRD_INTAKE_COLOR = "1d76db"');
  });

  it("labelDefs includes PRD in-progress label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is processing this PRD\'s sub-issues"',
    );
  });

  it("labelDefs includes PRD done label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai finished all sub-issues for this PRD"',
    );
  });

  it("labelDefs includes PRD stuck label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is stuck processing this PRD"',
    );
  });

  it("labelDefs uses shared state colors across families", () => {
    expect(ralphaiSrc).toContain('const IN_PROGRESS_COLOR = "fbca04"');
    expect(ralphaiSrc).toContain('const DONE_COLOR = "0e8a16"');
    expect(ralphaiSrc).toContain('const STUCK_COLOR = "d93f0b"');
  });

  // ---------------------------------------------------------------------------
  // Source-level: LabelNames uses 3 families with DerivedLabels
  // ---------------------------------------------------------------------------

  it("LabelNames interface has standalone, subissue, and prd families", () => {
    expect(ralphaiSrc).toContain("standalone: DerivedLabels");
    expect(ralphaiSrc).toContain("subissue: DerivedLabels");
    expect(ralphaiSrc).toContain("prd: DerivedLabels");
  });

  it("labelDefs references names.standalone, names.subissue, and names.prd", () => {
    expect(ralphaiSrc).toContain("names.standalone.intake");
    expect(ralphaiSrc).toContain("names.standalone.inProgress");
    expect(ralphaiSrc).toContain("names.standalone.done");
    expect(ralphaiSrc).toContain("names.standalone.stuck");
    expect(ralphaiSrc).toContain("names.subissue.intake");
    expect(ralphaiSrc).toContain("names.subissue.inProgress");
    expect(ralphaiSrc).toContain("names.subissue.done");
    expect(ralphaiSrc).toContain("names.subissue.stuck");
    expect(ralphaiSrc).toContain("names.prd.intake");
    expect(ralphaiSrc).toContain("names.prd.inProgress");
    expect(ralphaiSrc).toContain("names.prd.done");
    expect(ralphaiSrc).toContain("names.prd.stuck");
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
  // Source-level: scaffold builds LabelNames from deriveLabels for all 3 families
  // ---------------------------------------------------------------------------

  it("scaffold builds initLabelNames using deriveLabels for all 3 base config values", () => {
    expect(ralphaiSrc).toContain(
      "deriveLabels(configObj.standaloneLabel as string)",
    );
    expect(ralphaiSrc).toContain(
      "deriveLabels(configObj.subissueLabel as string)",
    );
    expect(ralphaiSrc).toContain("deriveLabels(configObj.prdLabel as string)");
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
  // Source-level: success message lists all labels dynamically
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
    expect(ralphaiSrc).toContain("deriveLabels(config.subissueLabel.value)");
    expect(ralphaiSrc).toContain("deriveLabels(config.prdLabel.value)");
  });

  it("runRalphaiRunner creates all 12 labels in a single ensureGitHubLabels call", () => {
    // After the refactor, run should call ensureGitHubLabels once (not twice)
    // with all 3 families in one LabelNames object
    const runBlock = ralphaiSrc.slice(
      ralphaiSrc.indexOf("// Best-effort: ensure all issue-tracking labels"),
      ralphaiSrc.indexOf("// --- Pre-flight: interactive dirty-state check"),
    );
    // Should have standalone, subissue, and prd in the same call
    expect(runBlock).toContain(
      "standalone: deriveLabels(config.standaloneLabel.value)",
    );
    expect(runBlock).toContain(
      "subissue: deriveLabels(config.subissueLabel.value)",
    );
    expect(runBlock).toContain("prd: deriveLabels(config.prdLabel.value)");
  });

  it("run-start label ensure is skipped in dry-run mode", () => {
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
