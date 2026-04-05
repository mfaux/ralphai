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
  // Source-level: labelDefs produces 6 labels (3 family + 3 shared state)
  // ---------------------------------------------------------------------------

  it("labelDefs includes standalone family label with color 7057ff", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai picks up this standalone issue"',
    );
    expect(ralphaiSrc).toContain('const STANDALONE_INTAKE_COLOR = "7057ff"');
  });

  it("labelDefs includes subissue family label with color c5def5", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai picks up this PRD sub-issue"',
    );
    expect(ralphaiSrc).toContain('const SUBISSUE_INTAKE_COLOR = "c5def5"');
  });

  it("labelDefs includes PRD family label with color 1d76db", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai PRD — groups sub-issues for drain runs"',
    );
    expect(ralphaiSrc).toContain('const PRD_INTAKE_COLOR = "1d76db"');
  });

  it("labelDefs includes shared in-progress state label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is working on this issue"',
    );
  });

  it("labelDefs includes shared done state label", () => {
    expect(ralphaiSrc).toContain('description: "Ralphai finished this issue"');
  });

  it("labelDefs includes shared stuck state label", () => {
    expect(ralphaiSrc).toContain(
      'description: "Ralphai is stuck on this issue"',
    );
  });

  it("labelDefs uses shared state colors", () => {
    expect(ralphaiSrc).toContain('const IN_PROGRESS_COLOR = "fbca04"');
    expect(ralphaiSrc).toContain('const DONE_COLOR = "0e8a16"');
    expect(ralphaiSrc).toContain('const STUCK_COLOR = "d93f0b"');
  });

  // ---------------------------------------------------------------------------
  // Source-level: LabelNames uses 3 plain string families
  // ---------------------------------------------------------------------------

  it("LabelNames interface has standalone, subissue, and prd as strings", () => {
    expect(ralphaiSrc).toContain("standalone: string");
    expect(ralphaiSrc).toContain("subissue: string");
    expect(ralphaiSrc).toContain("prd: string");
  });

  it("labelDefs references names.standalone, names.subissue, and names.prd", () => {
    expect(ralphaiSrc).toContain("names.standalone");
    expect(ralphaiSrc).toContain("names.subissue");
    expect(ralphaiSrc).toContain("names.prd");
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

  it("ensureGitHubLabels accepts LabelNames and dryRun parameters", () => {
    expect(ralphaiSrc).toContain("function ensureGitHubLabels(");
    expect(ralphaiSrc).toContain("names: LabelNames,");
    expect(ralphaiSrc).toContain("dryRun = false,");
  });

  it("scaffold passes configured label names to ensureGitHubLabels", () => {
    expect(ralphaiSrc).toContain(
      "labelResult = ensureGitHubLabels(cwd, initLabelNames);",
    );
  });

  // ---------------------------------------------------------------------------
  // Source-level: scaffold builds LabelNames from plain config values
  // ---------------------------------------------------------------------------

  it("scaffold builds initLabelNames using config values directly", () => {
    expect(ralphaiSrc).toContain(
      "standalone: configObj.standaloneLabel as string",
    );
    expect(ralphaiSrc).toContain("subissue: configObj.subissueLabel as string");
    expect(ralphaiSrc).toContain("prd: configObj.prdLabel as string");
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
  // Source-level: success message lists 6 labels
  // ---------------------------------------------------------------------------

  it("success message shows family and shared state label summary", () => {
    expect(ralphaiSrc).toContain(
      "Created 6 labels (3 family + 3 shared state):",
    );
    expect(ralphaiSrc).toContain("Family label for standalone issues");
    expect(ralphaiSrc).toContain("Family label for PRD sub-issues");
    expect(ralphaiSrc).toContain("Family label for PRD parent issues");
    expect(ralphaiSrc).toContain("Shared state: in-progress, done, stuck");
  });

  // ---------------------------------------------------------------------------
  // Source-level: best-effort label ensure at run start
  // ---------------------------------------------------------------------------

  it("runRalphaiRunner ensures labels when issueSource is github", () => {
    expect(ralphaiSrc).toContain('config.issueSource.value === "github"');
    // Verify the ensure call uses plain config values for 3 families
    expect(ralphaiSrc).toContain("standalone: config.standaloneLabel.value");
    expect(ralphaiSrc).toContain("subissue: config.subissueLabel.value");
    expect(ralphaiSrc).toContain("prd: config.prdLabel.value");
  });

  it("runRalphaiRunner creates all 6 labels in a single ensureGitHubLabels call", () => {
    // run should call ensureGitHubLabels once with all 3 families
    const runBlock = ralphaiSrc.slice(
      ralphaiSrc.indexOf("// Best-effort: ensure all issue-tracking labels"),
      ralphaiSrc.indexOf("// --- Pre-flight: interactive dirty-state check"),
    );
    // Should have standalone, subissue, and prd in the same call
    expect(runBlock).toContain("standalone: config.standaloneLabel.value");
    expect(runBlock).toContain("subissue: config.subissueLabel.value");
    expect(runBlock).toContain("prd: config.prdLabel.value");
  });

  it("run-start label ensure is skipped in dry-run mode", () => {
    expect(ralphaiSrc).toContain(
      '!isDryRun && config.issueSource.value === "github"',
    );
  });

  // ---------------------------------------------------------------------------
  // Source-level: init config uses 3 base label keys
  // ---------------------------------------------------------------------------

  it("scaffold config uses DEFAULTS directly for label values", () => {
    expect(ralphaiSrc).toContain("standaloneLabel: DEFAULTS.standaloneLabel");
    expect(ralphaiSrc).toContain("subissueLabel: DEFAULTS.subissueLabel");
    expect(ralphaiSrc).toContain("prdLabel: DEFAULTS.prdLabel");
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
