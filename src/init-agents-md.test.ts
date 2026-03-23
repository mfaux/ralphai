import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  runCli,
  runCliOutput,
  stripLogo,
  useTempGitDir,
} from "./test-utils.ts";

describe("init AGENTS.md integration", () => {
  const ctx = useTempGitDir();

  it("creates AGENTS.md when it does not exist", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const agentsMd = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain("# Agent Instructions");
    expect(agentsMd).toContain("## Ralphai");
    expect(agentsMd).toContain("autonomous task execution");
    // Should NOT reference repo-local paths
    expect(agentsMd).not.toContain(".ralphai/pipeline/backlog/");
    expect(agentsMd).not.toContain(".ralphai/PLANNING.md");
  });

  it("appends Ralphai section to existing AGENTS.md", () => {
    writeFileSync(
      join(ctx.dir, "AGENTS.md"),
      "# Agent Instructions\n\nExisting content here.\n",
    );

    runCliOutput(["init", "--yes"], ctx.dir);

    const agentsMd = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    // Original content is preserved
    expect(agentsMd).toContain("Existing content here.");
    // Ralphai section is appended
    expect(agentsMd).toContain("## Ralphai");
    expect(agentsMd).toContain("autonomous task execution");
  });

  it("does not duplicate Ralphai section if already present", () => {
    writeFileSync(
      join(ctx.dir, "AGENTS.md"),
      "# Agent Instructions\n\n## Ralphai\n\nAlready configured.\n",
    );

    runCliOutput(["init", "--yes"], ctx.dir);

    const agentsMd = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    // Should still have exactly one ## Ralphai heading
    const matches = agentsMd.match(/^## Ralphai\b/gm);
    expect(matches).toHaveLength(1);
    // Original content preserved
    expect(agentsMd).toContain("Already configured.");
  });

  it("shows AGENTS.md as created in output when file is new", () => {
    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("AGENTS.md");
    expect(output).toContain("created");
  });

  it("shows AGENTS.md as updated in output when appending", () => {
    writeFileSync(
      join(ctx.dir, "AGENTS.md"),
      "# Agent Instructions\n\nExisting.\n",
    );

    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("AGENTS.md");
    expect(output).toContain("updated");
  });

  it("does not mention AGENTS.md in output when section already exists", () => {
    writeFileSync(
      join(ctx.dir, "AGENTS.md"),
      "# Agent Instructions\n\n## Ralphai\n\nAlready there.\n",
    );

    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    // Should not show AGENTS.md in the Created: list
    expect(output).not.toMatch(/AGENTS\.md\s+.*(?:created|updated)/);
  });

  it("is idempotent: reinit with --force does not duplicate section", () => {
    // First init creates AGENTS.md
    runCliOutput(["init", "--yes"], ctx.dir);

    const afterFirst = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    expect(afterFirst).toContain("## Ralphai");

    // Second init with --force should not duplicate
    runCliOutput(["init", "--yes", "--force"], ctx.dir);

    const afterSecond = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    const matches = afterSecond.match(/^## Ralphai\b/gm);
    expect(matches).toHaveLength(1);
  });

  it("created AGENTS.md contains the expected snippet content", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const agentsMd = readFileSync(join(ctx.dir, "AGENTS.md"), "utf-8");
    expect(agentsMd).toContain(
      "This project uses [Ralphai](https://github.com/mfaux/ralphai) for autonomous task execution.",
    );
    // Should NOT reference repo-local paths
    expect(agentsMd).not.toContain(".ralphai/pipeline/backlog/");
    expect(agentsMd).not.toContain(".ralphai/PLANNING.md");
  });
});
