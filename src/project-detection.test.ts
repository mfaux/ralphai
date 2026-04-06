import { describe, it, expect } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";
import { useTempDir } from "./test-utils.ts";
import {
  detectPackageManager,
  detectProject,
  detectNodeProject,
  detectDotnetProject,
  detectGoProject,
  detectRustProject,
  detectPythonProject,
  detectJavaProject,
  detectFeedbackCommands,
  detectPrFeedbackCommands,
  hasNodeSubstance,
} from "./project-detection.ts";

describe("detectPackageManager", () => {
  const ctx = useTempDir();

  it("detects pnpm from pnpm-lock.yaml", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toEqual({ manager: "pnpm", runPrefix: "pnpm" });
  });

  it("detects npm from package-lock.json", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toEqual({ manager: "npm", runPrefix: "npm run" });
  });

  it("detects yarn from yarn.lock", () => {
    writeFileSync(join(ctx.dir, "yarn.lock"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toEqual({ manager: "yarn", runPrefix: "yarn" });
  });

  it("detects bun from bun.lockb", () => {
    writeFileSync(join(ctx.dir, "bun.lockb"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toEqual({ manager: "bun", runPrefix: "bun run" });
  });

  it("detects deno from deno.json", () => {
    writeFileSync(
      join(ctx.dir, "deno.json"),
      JSON.stringify({ tasks: { build: "deno compile" } }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toEqual({ manager: "deno", runPrefix: "deno task" });
  });

  it("falls back to packageManager field", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", packageManager: "pnpm@9.0.0" }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toEqual({ manager: "pnpm", runPrefix: "pnpm" });
  });

  it("defaults to npm when package.json has no packageManager field", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toEqual({ manager: "npm", runPrefix: "npm run" });
  });

  it("returns null for empty directory", () => {
    const pm = detectPackageManager(ctx.dir);
    expect(pm).toBeNull();
  });

  it("lock file takes priority over packageManager field", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", packageManager: "yarn@4.0.0" }),
    );
    const pm = detectPackageManager(ctx.dir);
    expect(pm?.manager).toBe("pnpm");
  });
});

describe("detectProject", () => {
  const ctx = useTempDir();

  it("returns DetectedProject for a pnpm project", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
    expect(project!.label).toBe("pnpm");
    expect(project!.runPrefix).toBe("pnpm");
    expect(project!.manager).toBe("pnpm");
    expect(project!.feedbackCommands).toEqual(["pnpm build", "pnpm test"]);
  });

  it("returns DetectedProject for an npm project", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "jest" },
      }),
    );

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
    expect(project!.label).toBe("npm");
    expect(project!.runPrefix).toBe("npm run");
    expect(project!.feedbackCommands).toEqual(["npm run build", "npm test"]);
  });

  it("returns null for an empty directory", () => {
    const project = detectProject(ctx.dir);
    expect(project).toBeNull();
  });

  it("returns DetectedProject for deno", () => {
    writeFileSync(
      join(ctx.dir, "deno.json"),
      JSON.stringify({ tasks: { build: "deno compile", lint: "deno lint" } }),
    );

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
    expect(project!.label).toBe("deno");
    expect(project!.runPrefix).toBe("deno task");
    expect(project!.feedbackCommands).toEqual([
      "deno task build",
      "deno task lint",
      "deno test",
    ]);
  });

  it("uses bun run test for bun projects with a test script", () => {
    writeFileSync(join(ctx.dir, "bun.lockb"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: {
          build: "tsc",
          test: "bun scripts/test.ts",
          lint: "eslint .",
        },
      }),
    );

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
    expect(project!.label).toBe("bun");
    expect(project!.runPrefix).toBe("bun run");
    expect(project!.feedbackCommands).toEqual([
      "bun run build",
      "bun run test",
      "bun run lint",
    ]);
  });
});

describe("detectNodeProject", () => {
  const ctx = useTempDir();

  it("returns null when no JS signals present", () => {
    const project = detectNodeProject(ctx.dir);
    expect(project).toBeNull();
  });

  it("includes empty feedbackCommands when scripts have no matches", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { start: "node index.js" },
      }),
    );

    const project = detectNodeProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.feedbackCommands).toEqual([]);
  });

  it("returns null for bare package.json with no lock file, scripts, or workspaces", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ dependencies: {} }),
    );

    const project = detectNodeProject(ctx.dir);
    expect(project).toBeNull();
  });

  it("detects node when package.json has scripts but no lock file", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc" },
      }),
    );

    const project = detectNodeProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
  });

  it("detects node when package.json has workspaces but no lock file", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        workspaces: ["packages/*"],
      }),
    );

    const project = detectNodeProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
  });

  it("detects node when lock file exists but package.json has no scripts", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test" }),
    );

    const project = detectNodeProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
  });
});

describe("hasNodeSubstance", () => {
  const ctx = useTempDir();

  it("returns false for empty directory", () => {
    expect(hasNodeSubstance(ctx.dir)).toBe(false);
  });

  it("returns false for bare package.json with no lock file or scripts", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ dependencies: {} }),
    );
    expect(hasNodeSubstance(ctx.dir)).toBe(false);
  });

  it("returns true when package-lock.json exists", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns true when yarn.lock exists", () => {
    writeFileSync(join(ctx.dir, "yarn.lock"), "");
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns true when pnpm-lock.yaml exists", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "");
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns true when bun.lockb exists", () => {
    writeFileSync(join(ctx.dir, "bun.lockb"), "");
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns true when pnpm-workspace.yaml exists", () => {
    writeFileSync(join(ctx.dir, "pnpm-workspace.yaml"), "packages:\n");
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns true when deno.json exists", () => {
    writeFileSync(join(ctx.dir, "deno.json"), "{}");
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns true when package.json has scripts", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", scripts: { build: "tsc" } }),
    );
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns true when package.json has workspaces", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", workspaces: ["packages/*"] }),
    );
    expect(hasNodeSubstance(ctx.dir)).toBe(true);
  });

  it("returns false when package.json has empty scripts object", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ name: "test", scripts: {} }),
    );
    expect(hasNodeSubstance(ctx.dir)).toBe(false);
  });
});

describe("detectFeedbackCommands", () => {
  const ctx = useTempDir();

  it("returns empty string for non-JS project", () => {
    expect(detectFeedbackCommands(ctx.dir)).toBe("");
  });

  it("detects pnpm feedback commands", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest", lint: "eslint ." },
      }),
    );
    expect(detectFeedbackCommands(ctx.dir)).toBe(
      "pnpm build,pnpm test,pnpm lint",
    );
  });
});

describe("detectDotnetProject", () => {
  const ctx = useTempDir();

  it("detects dotnet solution from .sln file", () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");

    const project = detectDotnetProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("dotnet");
    expect(project!.label).toContain("solution");
    expect(project!.runPrefix).toBe("dotnet");
    expect(project!.feedbackCommands).toEqual(["dotnet build", "dotnet test"]);
  });

  it("detects dotnet project from .csproj file (no .sln)", () => {
    writeFileSync(join(ctx.dir, "MyApp.csproj"), "");

    const project = detectDotnetProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("dotnet");
    expect(project!.label).toContain("project");
    expect(project!.runPrefix).toBe("dotnet");
    expect(project!.feedbackCommands).toEqual(["dotnet build", "dotnet test"]);
  });

  it("returns null for empty directory", () => {
    expect(detectDotnetProject(ctx.dir)).toBeNull();
  });
});

describe("detectProject priority", () => {
  const ctx = useTempDir();

  it("node wins over dotnet when both are present", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );
    writeFileSync(join(ctx.dir, "MyApp.csproj"), "");

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
  });

  it("detects dotnet via detectProject when no JS signals", () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("dotnet");
    expect(project!.label).toBe("dotnet (solution)");
  });

  it("dotnet wins over bare package.json with no substance (ace-like repo)", () => {
    // Simulate a .NET-primary repo with a stub package.json used only for tooling
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({ dependencies: {} }),
    );
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("dotnet");
    expect(project!.feedbackCommands).toEqual(["dotnet build", "dotnet test"]);
  });

  it("node still wins when package.json has scripts alongside .sln", () => {
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("node");
    // Dotnet feedback should be merged as additional ecosystem
    expect(project!.feedbackCommands).toContain("dotnet build");
  });
});

describe("detectGoProject", () => {
  const ctx = useTempDir();

  it("detects Go from go.mod", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/mymod\n");

    const project = detectGoProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("go");
    expect(project!.label).toBe("go module");
    expect(project!.runPrefix).toBe("go");
    expect(project!.feedbackCommands).toEqual([
      "go build ./...",
      "go test ./...",
    ]);
  });

  it("returns null without go.mod", () => {
    expect(detectGoProject(ctx.dir)).toBeNull();
  });
});

describe("detectRustProject", () => {
  const ctx = useTempDir();

  it("detects Rust from Cargo.toml", () => {
    writeFileSync(join(ctx.dir, "Cargo.toml"), '[package]\nname = "myapp"\n');

    const project = detectRustProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("rust");
    expect(project!.label).toBe("cargo");
    expect(project!.runPrefix).toBe("cargo");
    expect(project!.feedbackCommands).toEqual(["cargo build", "cargo test"]);
  });

  it("returns null without Cargo.toml", () => {
    expect(detectRustProject(ctx.dir)).toBeNull();
  });
});

describe("detectPythonProject", () => {
  const ctx = useTempDir();

  it("detects Python from pyproject.toml with pytest", () => {
    writeFileSync(
      join(ctx.dir, "pyproject.toml"),
      '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n',
    );

    const project = detectPythonProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("python");
    expect(project!.label).toBe("python (pyproject)");
    expect(project!.runPrefix).toBe("python");
    expect(project!.feedbackCommands).toEqual(["python -m pytest"]);
  });

  it("detects Python from pyproject.toml without pytest (empty feedback)", () => {
    writeFileSync(
      join(ctx.dir, "pyproject.toml"),
      '[project]\nname = "myapp"\n',
    );

    const project = detectPythonProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("python");
    expect(project!.feedbackCommands).toEqual([]);
  });

  it("detects Python from setup.py", () => {
    writeFileSync(join(ctx.dir, "setup.py"), "from setuptools import setup\n");

    const project = detectPythonProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.label).toBe("python (setup.py)");
    expect(project!.feedbackCommands).toEqual([]);
  });

  it("detects Python from requirements.txt", () => {
    writeFileSync(join(ctx.dir, "requirements.txt"), "flask\n");

    const project = detectPythonProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.label).toBe("python (requirements.txt)");
    expect(project!.feedbackCommands).toEqual([]);
  });

  it("returns null without Python signals", () => {
    expect(detectPythonProject(ctx.dir)).toBeNull();
  });
});

describe("detectJavaProject", () => {
  const ctx = useTempDir();

  it("detects Maven from pom.xml", () => {
    writeFileSync(join(ctx.dir, "pom.xml"), "<project></project>\n");

    const project = detectJavaProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("java");
    expect(project!.label).toBe("maven");
    expect(project!.runPrefix).toBe("mvn");
    expect(project!.feedbackCommands).toEqual(["mvn test"]);
  });

  it("detects Gradle from build.gradle", () => {
    writeFileSync(join(ctx.dir, "build.gradle"), "apply plugin: 'java'\n");

    const project = detectJavaProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("java");
    expect(project!.label).toBe("gradle");
    expect(project!.runPrefix).toBe("gradle");
    expect(project!.feedbackCommands).toEqual(["gradle test"]);
  });

  it("detects Gradle from build.gradle.kts", () => {
    writeFileSync(join(ctx.dir, "build.gradle.kts"), "plugins { java }\n");

    const project = detectJavaProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.label).toBe("gradle");
  });

  it("prefers Maven over Gradle when both present", () => {
    writeFileSync(join(ctx.dir, "pom.xml"), "<project></project>\n");
    writeFileSync(join(ctx.dir, "build.gradle"), "apply plugin: 'java'\n");

    const project = detectJavaProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.label).toBe("maven");
  });

  it("returns null without Java/Kotlin signals", () => {
    expect(detectJavaProject(ctx.dir)).toBeNull();
  });
});

describe("detectProject full priority", () => {
  const ctx = useTempDir();

  it("returns null for empty directory", () => {
    expect(detectProject(ctx.dir)).toBeNull();
  });

  it("detects Go via detectProject", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/mymod\n");
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("go");
  });

  it("detects Rust via detectProject", () => {
    writeFileSync(join(ctx.dir, "Cargo.toml"), '[package]\nname = "myapp"\n');
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("rust");
  });

  it("detects Python via detectProject", () => {
    writeFileSync(join(ctx.dir, "requirements.txt"), "flask\n");
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("python");
  });

  it("detects Java via detectProject", () => {
    writeFileSync(join(ctx.dir, "pom.xml"), "<project></project>\n");
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.ecosystem).toBe("java");
  });
});

// ---------------------------------------------------------------------------
// PR feedback command detection
// ---------------------------------------------------------------------------

describe("detectPrFeedbackCommands", () => {
  const ctx = useTempDir();

  it("returns empty string for non-JS project", () => {
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("");
  });

  it("detects test:e2e script", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", "test:e2e": "playwright test" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("pnpm test:e2e");
  });

  it("detects e2e script", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { e2e: "cypress run" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("pnpm e2e");
  });

  it("detects test:integration script", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { "test:integration": "jest --config jest.integration.js" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("pnpm test:integration");
  });

  it("detects playwright script", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { playwright: "playwright test" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("pnpm playwright");
  });

  it("detects cypress script", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { cypress: "cypress open" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("pnpm cypress");
  });

  it("detects cypress:run script", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { "cypress:run": "cypress run" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("pnpm cypress:run");
  });

  it("detects multiple E2E scripts", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: {
          "test:e2e": "playwright test",
          "test:integration": "jest --integration",
        },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe(
      "pnpm test:e2e,pnpm test:integration",
    );
  });

  it("returns empty string when no E2E scripts present", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("");
  });

  it("uses correct run prefix for npm projects", () => {
    writeFileSync(join(ctx.dir, "package-lock.json"), "{}");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { "test:e2e": "playwright test" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("npm run test:e2e");
  });

  it("uses correct run prefix for bun projects", () => {
    writeFileSync(join(ctx.dir, "bun.lockb"), "");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { "test:e2e": "playwright test" },
      }),
    );
    expect(detectPrFeedbackCommands(ctx.dir)).toBe("bun run test:e2e");
  });
});

describe("detectProject prFeedbackCommands", () => {
  const ctx = useTempDir();

  it("includes prFeedbackCommands for Node project with E2E scripts", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: {
          build: "tsc",
          test: "vitest",
          "test:e2e": "playwright test",
        },
      }),
    );

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.feedbackCommands).toEqual(["pnpm build", "pnpm test"]);
    expect(project!.prFeedbackCommands).toEqual(["pnpm test:e2e"]);
  });

  it("returns empty prFeedbackCommands when no E2E scripts", () => {
    writeFileSync(join(ctx.dir, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeFileSync(
      join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test",
        scripts: { build: "tsc", test: "vitest" },
      }),
    );

    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.prFeedbackCommands).toEqual([]);
  });

  it("returns empty prFeedbackCommands for Go projects", () => {
    writeFileSync(join(ctx.dir, "go.mod"), "module example.com/mymod\n");
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.prFeedbackCommands).toEqual([]);
  });

  it("returns empty prFeedbackCommands for Rust projects", () => {
    writeFileSync(join(ctx.dir, "Cargo.toml"), '[package]\nname = "myapp"\n');
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.prFeedbackCommands).toEqual([]);
  });

  it("returns empty prFeedbackCommands for dotnet projects", () => {
    writeFileSync(join(ctx.dir, "MyApp.sln"), "");
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.prFeedbackCommands).toEqual([]);
  });

  it("returns empty prFeedbackCommands for Python projects", () => {
    writeFileSync(join(ctx.dir, "requirements.txt"), "flask\n");
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.prFeedbackCommands).toEqual([]);
  });

  it("returns empty prFeedbackCommands for Java projects", () => {
    writeFileSync(join(ctx.dir, "pom.xml"), "<project></project>\n");
    const project = detectProject(ctx.dir);
    expect(project).not.toBeNull();
    expect(project!.prFeedbackCommands).toEqual([]);
  });
});
