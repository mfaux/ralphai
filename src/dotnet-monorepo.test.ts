import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import {
  useTempDir,
  useTempGitDir,
  runCliOutput,
  stripLogo,
} from "./test-utils.ts";
import {
  parseSolutionProjects,
  detectDotnetProject,
  detectWorkspaces,
  detectProject,
  deriveDotnetScopedFeedback,
} from "./project-detection.ts";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = join(__dirname, "..", "runner", "lib");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal .sln content with Project entries using backslash paths (Windows-style, as VS generates). */
function slnContent(projects: { name: string; path: string }[]): string {
  const lines = [
    "Microsoft Visual Studio Solution File, Format Version 12.00",
    "# Visual Studio Version 17",
  ];
  for (const p of projects) {
    // Use a fixed GUID for the project type (C# project)
    lines.push(
      `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${p.name}", "${p.path}", "{00000000-0000-0000-0000-000000000000}"`,
    );
    lines.push("EndProject");
  }
  lines.push("Global");
  lines.push("EndGlobal");
  return lines.join("\n");
}

function runBash(script: string, cwd?: string): string {
  const scriptFile = join(
    tmpdir(),
    `ralphai-dotnet-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
  );
  try {
    writeFileSync(scriptFile, script);
    const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
      encoding: "utf-8",
      cwd,
    });
    return result;
  } finally {
    try {
      rmSync(scriptFile);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// parseSolutionProjects()
// ---------------------------------------------------------------------------

describe("parseSolutionProjects", () => {
  it("extracts projects from .sln content with backslash paths", () => {
    const content = slnContent([
      { name: "MyApp", path: "src\\MyApp\\MyApp.csproj" },
      { name: "MyApp.Tests", path: "tests\\MyApp.Tests\\MyApp.Tests.csproj" },
    ]);

    const projects = parseSolutionProjects(content);
    expect(projects).toEqual([
      { name: "MyApp", path: "src/MyApp" },
      { name: "MyApp.Tests", path: "tests/MyApp.Tests" },
    ]);
  });

  it("extracts projects from .sln content with forward slash paths", () => {
    const content = slnContent([{ name: "Api", path: "src/Api/Api.csproj" }]);

    const projects = parseSolutionProjects(content);
    expect(projects).toEqual([{ name: "Api", path: "src/Api" }]);
  });

  it("handles root-level .csproj (no subdirectory)", () => {
    const content = slnContent([
      { name: "SimpleApp", path: "SimpleApp.csproj" },
    ]);

    const projects = parseSolutionProjects(content);
    expect(projects).toEqual([{ name: "SimpleApp", path: "." }]);
  });

  it("skips solution folder entries (no .csproj extension)", () => {
    const lines = [
      "Microsoft Visual Studio Solution File, Format Version 12.00",
      // Solution folder (uses a different GUID type)
      'Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "src", "src", "{11111111-1111-1111-1111-111111111111}"',
      "EndProject",
      // Actual project
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "src\\Api\\Api.csproj", "{22222222-2222-2222-2222-222222222222}"',
      "EndProject",
    ].join("\n");

    const projects = parseSolutionProjects(lines);
    expect(projects).toEqual([{ name: "Api", path: "src/Api" }]);
  });

  it("deduplicates projects in the same directory", () => {
    // Unusual but possible: two project entries pointing to same dir
    const content = slnContent([
      { name: "Lib", path: "src\\Lib\\Lib.csproj" },
      { name: "Lib2", path: "src\\Lib\\Lib2.csproj" },
    ]);

    const projects = parseSolutionProjects(content);
    // Same directory, first one wins
    expect(projects).toHaveLength(1);
    expect(projects[0]!.path).toBe("src/Lib");
  });

  it("returns empty array for .sln with no projects", () => {
    const content = [
      "Microsoft Visual Studio Solution File, Format Version 12.00",
      "Global",
      "EndGlobal",
    ].join("\n");

    expect(parseSolutionProjects(content)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// detectDotnetProject() with .sln parsing
// ---------------------------------------------------------------------------

describe("detectDotnetProject with workspaces", () => {
  const ctx = useTempDir();

  it("populates workspaces from .sln with multiple projects", () => {
    const content = slnContent([
      { name: "Api", path: "src\\Api\\Api.csproj" },
      { name: "Domain", path: "src\\Domain\\Domain.csproj" },
      { name: "Api.Tests", path: "tests\\Api.Tests\\Api.Tests.csproj" },
    ]);
    writeFileSync(join(ctx.dir, "MySolution.sln"), content);

    const project = detectDotnetProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("dotnet");
    expect(project!.label).toBe("dotnet (solution)");
    expect(project!.workspaces).toEqual([
      { name: "Api", path: "src/Api" },
      { name: "Domain", path: "src/Domain" },
      { name: "Api.Tests", path: "tests/Api.Tests" },
    ]);
  });

  it("returns undefined workspaces when .sln has no .csproj entries", () => {
    const content = [
      "Microsoft Visual Studio Solution File, Format Version 12.00",
      "Global",
      "EndGlobal",
    ].join("\n");
    writeFileSync(join(ctx.dir, "Empty.sln"), content);

    const project = detectDotnetProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.workspaces).toBeUndefined();
  });

  it("still detects .csproj at root when no .sln present", () => {
    writeFileSync(join(ctx.dir, "MyApp.csproj"), "<Project></Project>");

    const project = detectDotnetProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.label).toBe("dotnet (project)");
    expect(project!.workspaces).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// detectWorkspaces() for .NET solutions
// ---------------------------------------------------------------------------

describe("detectWorkspaces for .NET", () => {
  const ctx = useTempDir();

  it("discovers workspaces from .sln file", () => {
    const content = slnContent([
      { name: "WebApi", path: "src\\WebApi\\WebApi.csproj" },
      { name: "Core", path: "src\\Core\\Core.csproj" },
    ]);
    writeFileSync(join(ctx.dir, "App.sln"), content);

    const workspaces = detectWorkspaces(ctx.dir);
    expect(workspaces).toEqual([
      { name: "WebApi", path: "src/WebApi" },
      { name: "Core", path: "src/Core" },
    ]);
  });

  it("returns empty when .sln has no projects", () => {
    const content = [
      "Microsoft Visual Studio Solution File, Format Version 12.00",
      "Global",
      "EndGlobal",
    ].join("\n");
    writeFileSync(join(ctx.dir, "Empty.sln"), content);

    expect(detectWorkspaces(ctx.dir)).toEqual([]);
  });

  it("prefers Node workspaces over .sln when both exist", () => {
    // Node workspace setup
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    );
    mkdirSync(join(ctx.dir, "packages", "web"), { recursive: true });
    writeFileSync(
      join(ctx.dir, "packages", "web", "package.json"),
      JSON.stringify({ name: "@org/web" }),
    );

    // .sln setup
    const slnText = slnContent([{ name: "Api", path: "src\\Api\\Api.csproj" }]);
    writeFileSync(join(ctx.dir, "App.sln"), slnText);

    const workspaces = detectWorkspaces(ctx.dir);
    // Node workspaces should win (checked first)
    expect(workspaces).toEqual([{ name: "@org/web", path: "packages/web" }]);
  });
});

// ---------------------------------------------------------------------------
// deriveDotnetScopedFeedback()
// ---------------------------------------------------------------------------

describe("deriveDotnetScopedFeedback", () => {
  it("appends project path to dotnet build and dotnet test", () => {
    const result = deriveDotnetScopedFeedback(
      ["dotnet build", "dotnet test"],
      "src/Api",
    );
    expect(result).toEqual(["dotnet build src/Api", "dotnet test src/Api"]);
  });

  it("passes non-dotnet commands through unchanged", () => {
    const result = deriveDotnetScopedFeedback(
      ["dotnet build", "make lint"],
      "src/Api",
    );
    expect(result).toEqual(["dotnet build src/Api", "make lint"]);
  });

  it("handles dotnet commands with extra arguments", () => {
    const result = deriveDotnetScopedFeedback(
      ["dotnet build --configuration Release"],
      "src/Api",
    );
    expect(result).toEqual(["dotnet build --configuration Release src/Api"]);
  });
});

// ---------------------------------------------------------------------------
// detectProject() — mixed repo scenarios
// ---------------------------------------------------------------------------

describe("detectProject mixed repos", () => {
  const ctx = useTempDir();

  it("merges dotnet feedback into node when both are present", () => {
    // Node setup
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );

    // .NET setup
    writeFileSync(join(ctx.dir, "MyApp.sln"), slnContent([]));

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    // Primary is still node
    expect(project!.ecosystem).toBe("node");
    // Feedback should include both node and dotnet commands
    expect(project!.feedbackCommands).toContain("pnpm build");
    expect(project!.feedbackCommands).toContain("pnpm test");
    expect(project!.feedbackCommands).toContain("dotnet build");
    expect(project!.feedbackCommands).toContain("dotnet test");
  });

  it("lists dotnet as additional ecosystem when node is primary", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
    );
    writeFileSync(join(ctx.dir, "MyApp.sln"), slnContent([]));

    const project = detectProject(ctx.dir);
    expect(project!.additionalEcosystems).toHaveLength(1);
    expect(project!.additionalEcosystems![0]!.ecosystem).toBe("dotnet");
  });

  it("does not set additionalEcosystems for single-ecosystem repos", () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), slnContent([]));

    const project = detectProject(ctx.dir);
    expect(project!.ecosystem).toBe("dotnet");
    expect(project!.additionalEcosystems).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bash: resolve_scoped_feedback for dotnet
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "resolve_scoped_feedback dotnet scoping (bash)",
  () => {
    const ctx = useTempGitDir();

    it("rewrites 'dotnet build' to 'dotnet build <scope>' for dotnet projects", () => {
      // Create a .sln at root
      writeFileSync(join(ctx.dir, "Foo.sln"), "");
      // Create scoped directory
      const scopeDir = join(ctx.dir, "src/MyProject");
      mkdirSync(scopeDir, { recursive: true });

      const result = runBash(
        `
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}

DETECTED_AGENT_TYPE="claude"
AGENT_COMMAND="claude -p"
detect_agent_type() { DETECTED_AGENT_TYPE="claude"; }

source ${JSON.stringify(join(LIB_DIR, "prompt.sh"))}
source ${JSON.stringify(join(LIB_DIR, "json.sh"))}
source ${JSON.stringify(join(LIB_DIR, "scope.sh"))}

PLAN_SCOPE="src/MyProject"
FEEDBACK_COMMANDS="dotnet build,dotnet test"
CONFIG_WORKSPACES=""

resolve_scoped_feedback
echo "\$FEEDBACK_COMMANDS"
`,
        ctx.dir,
      ).trim();

      expect(result).toBe(
        "dotnet build src/MyProject,dotnet test src/MyProject",
      );
    });

    it("uses workspace override for dotnet when CONFIG_WORKSPACES matches", () => {
      writeFileSync(join(ctx.dir, "Foo.sln"), "");
      const scopeDir = join(ctx.dir, "src/Api");
      mkdirSync(scopeDir, { recursive: true });

      const ws = JSON.stringify({
        "src/Api": {
          feedbackCommands: [
            "dotnet build src/Api",
            "dotnet test tests/Api.Tests",
          ],
        },
      });

      const result = runBash(
        `
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}

DETECTED_AGENT_TYPE="claude"
AGENT_COMMAND="claude -p"
detect_agent_type() { DETECTED_AGENT_TYPE="claude"; }

source ${JSON.stringify(join(LIB_DIR, "prompt.sh"))}
source ${JSON.stringify(join(LIB_DIR, "json.sh"))}
source ${JSON.stringify(join(LIB_DIR, "scope.sh"))}

PLAN_SCOPE="src/Api"
FEEDBACK_COMMANDS="dotnet build,dotnet test"
CONFIG_WORKSPACES='${ws}'

resolve_scoped_feedback
echo "\$FEEDBACK_COMMANDS"
`,
        ctx.dir,
      ).trim();

      expect(result).toBe("dotnet build src/Api,dotnet test tests/Api.Tests");
    });

    it("passes non-dotnet commands through unchanged in dotnet ecosystem", () => {
      writeFileSync(join(ctx.dir, "Foo.sln"), "");
      const scopeDir = join(ctx.dir, "src/MyProject");
      mkdirSync(scopeDir, { recursive: true });

      const result = runBash(
        `
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}

DETECTED_AGENT_TYPE="claude"
AGENT_COMMAND="claude -p"
detect_agent_type() { DETECTED_AGENT_TYPE="claude"; }

source ${JSON.stringify(join(LIB_DIR, "prompt.sh"))}
source ${JSON.stringify(join(LIB_DIR, "json.sh"))}
source ${JSON.stringify(join(LIB_DIR, "scope.sh"))}

PLAN_SCOPE="src/MyProject"
FEEDBACK_COMMANDS="dotnet build,make lint"
CONFIG_WORKSPACES=""

resolve_scoped_feedback
echo "\$FEEDBACK_COMMANDS"
`,
        ctx.dir,
      ).trim();

      expect(result).toBe("dotnet build src/MyProject,make lint");
    });
  },
);

// ---------------------------------------------------------------------------
// CLI init — dotnet monorepo
// ---------------------------------------------------------------------------

describe("init --yes dotnet monorepo", () => {
  const ctx = useTempGitDir();

  it("detects workspaces from .sln and shows workspace count", () => {
    const content = slnContent([
      { name: "Api", path: "src\\Api\\Api.csproj" },
      { name: "Domain", path: "src\\Domain\\Domain.csproj" },
    ]);
    writeFileSync(join(ctx.dir, "MySolution.sln"), content);

    const output = stripLogo(runCliOutput(["init", "--yes"], ctx.dir));

    expect(output).toContain("dotnet (solution)");
    expect(output).toContain("2 packages");
    expect(output).toContain("Api");
    expect(output).toContain("Domain");
  });

  it("init --yes with .NET + Node merges feedback commands", () => {
    // Node setup
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );
    // .NET setup
    writeFileSync(join(ctx.dir, "MyApp.sln"), slnContent([]));

    runCliOutput(["init", "--yes"], ctx.dir);

    const config = JSON.parse(
      readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
    );
    // Should contain both node and dotnet feedback commands
    expect(config.feedbackCommands).toContain("pnpm build");
    expect(config.feedbackCommands).toContain("pnpm test");
    expect(config.feedbackCommands).toContain("dotnet build");
    expect(config.feedbackCommands).toContain("dotnet test");
  });
});
