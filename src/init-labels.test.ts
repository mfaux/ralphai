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
  // Source-level: labelDefs includes all four labels
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

  it("labelDefs includes the PRD label entry using names.prd with color 1d76db", () => {
    expect(ralphaiSrc).toContain("name: names.prd");
    expect(ralphaiSrc).toContain(
      'description: "Ralphai PRD — groups sub-issues for drain runs"',
    );
    expect(ralphaiSrc).toContain('color: "1d76db"');
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
  // Source-level: scaffold builds LabelNames from config object
  // ---------------------------------------------------------------------------

  it("scaffold builds initLabelNames from config values", () => {
    expect(ralphaiSrc).toContain("intake: configObj.issueLabel as string");
    expect(ralphaiSrc).toContain(
      "inProgress: configObj.issueInProgressLabel as string",
    );
    expect(ralphaiSrc).toContain("done: configObj.issueDoneLabel as string");
    expect(ralphaiSrc).toContain("prd: configObj.issuePrdLabel as string");
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
    // Verify the ensure call uses config values for all four labels
    expect(ralphaiSrc).toContain("intake: config.issueLabel.value");
    expect(ralphaiSrc).toContain(
      "inProgress: config.issueInProgressLabel.value",
    );
    expect(ralphaiSrc).toContain("done: config.issueDoneLabel.value");
    expect(ralphaiSrc).toContain("prd: config.issuePrdLabel.value");
  });

  it("run-start label ensure is skipped in dry-run mode", () => {
    // The ensure block is inside `if (!isDryRun && config.issueSource.value === "github")`
    expect(ralphaiSrc).toContain(
      '!isDryRun && config.issueSource.value === "github"',
    );
  });

  // ---------------------------------------------------------------------------
  // Source-level: init config includes issueDoneLabel
  // ---------------------------------------------------------------------------

  it("scaffold config includes issueDoneLabel and issuePrdLabel", () => {
    expect(ralphaiSrc).toContain(
      "answers.issueDoneLabel ?? DEFAULTS.issueDoneLabel",
    );
    expect(ralphaiSrc).toContain(
      "answers.issuePrdLabel ?? DEFAULTS.issuePrdLabel",
    );
  });

  // ---------------------------------------------------------------------------
  // init --yes (issueSource=none) does not show label info
  // ---------------------------------------------------------------------------

  it("init --yes with default issueSource=none does not mention labels", () => {
    const result = runCli(["init", "--yes"], ctx.dir, testEnv());
    const output = stripLogo(result.stdout || result.stderr);
    expect(output).not.toContain("GitHub labels");
    expect(output).not.toContain("ralphai-prd label");
  });
});
