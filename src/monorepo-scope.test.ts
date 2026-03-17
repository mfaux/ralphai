import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { useTempGitDir } from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB_DIR = join(__dirname, "..", "runner", "lib");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runBash(script: string, cwd?: string): string {
  const scriptFile = join(
    tmpdir(),
    `ralphai-scope-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
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
// extract_scope() — bash frontmatter parser
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")("extract_scope (bash)", () => {
  const ctx = useTempGitDir();

  function extractScope(planContent: string): string {
    const planFile = join(ctx.dir, "plan.md");
    writeFileSync(planFile, planContent);
    return runBash(`
source ${JSON.stringify(join(LIB_DIR, "plans.sh"))}
extract_scope ${JSON.stringify(planFile)}
`).trim();
  }

  it("returns scope value from frontmatter", () => {
    expect(extractScope("---\nscope: packages/web\n---\n\n# Plan\n")).toBe(
      "packages/web",
    );
  });

  it("returns scope with nested path", () => {
    expect(extractScope("---\nscope: apps/api\n---\n\n# Plan\n")).toBe(
      "apps/api",
    );
  });

  it("returns empty string when no scope", () => {
    expect(extractScope("---\nsource: github\n---\n\n# Plan\n")).toBe("");
  });

  it("returns empty string when no frontmatter", () => {
    expect(extractScope("# Plan: No Frontmatter\n")).toBe("");
  });

  it("works alongside depends-on and source fields", () => {
    expect(
      extractScope(
        "---\nsource: github\nscope: packages/shared\ndepends-on: [setup.md]\n---\n\n# Plan\n",
      ),
    ).toBe("packages/shared");
  });

  it("trims trailing whitespace from scope value", () => {
    expect(extractScope("---\nscope: packages/web   \n---\n\n# Plan\n")).toBe(
      "packages/web",
    );
  });
});

// ---------------------------------------------------------------------------
// workspaces config key — accepted without unknown-key warning
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "workspaces config key (bash)",
  () => {
    const ctx = useTempGitDir();

    it("does not warn about unknown keys for workspaces", () => {
      const configContent = JSON.stringify(
        {
          agentCommand: "echo test",
          feedbackCommands: ["echo build"],
          workspaces: {
            "packages/web": {
              feedbackCommands: ["pnpm --filter web build"],
            },
          },
        },
        null,
        2,
      );
      const configFile = join(ctx.dir, "ralphai.json");
      writeFileSync(configFile, configContent);

      // Source defaults + config, pass config path as positional arg
      const output = runBash(`
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}
source ${JSON.stringify(join(LIB_DIR, "config.sh"))}
load_config ${JSON.stringify(configFile)}
echo "WORKSPACES=\$CONFIG_WORKSPACES"
`);
      expect(output).not.toContain("unknown config key");
      expect(output).toContain("packages/web");
    });

    it("rejects non-object workspaces value", () => {
      const configFile = join(ctx.dir, "ralphai.json");
      writeFileSync(
        configFile,
        JSON.stringify({
          agentCommand: "echo test",
          workspaces: "not-an-object",
        }),
      );

      let exitedWithError = false;
      try {
        runBash(`
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}
source ${JSON.stringify(join(LIB_DIR, "config.sh"))}
load_config ${JSON.stringify(configFile)}
`);
      } catch (err: any) {
        exitedWithError = true;
        const output = (err.stderr || "") + (err.stdout || "");
        expect(output).toContain("'workspaces' must be an object");
      }
      expect(exitedWithError).toBe(true);
    });
  },
);

// ---------------------------------------------------------------------------
// resolve_scoped_feedback() — scoped command derivation
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")(
  "resolve_scoped_feedback (bash)",
  () => {
    const ctx = useTempGitDir();

    function resolveFeedback(opts: {
      scope: string;
      feedbackCommands: string;
      lockfile?: string;
      packageName?: string;
      workspacesJson?: string;
    }): string {
      // Create package.json in the scoped directory
      const scopeDir = join(ctx.dir, opts.scope);
      mkdirSync(scopeDir, { recursive: true });
      writeFileSync(
        join(scopeDir, "package.json"),
        JSON.stringify({ name: opts.packageName ?? "@org/web" }),
      );

      // Create lockfile at repo root
      if (opts.lockfile) {
        writeFileSync(join(ctx.dir, opts.lockfile), "");
      }

      const wsLine = opts.workspacesJson
        ? `CONFIG_WORKSPACES='${opts.workspacesJson}'`
        : `CONFIG_WORKSPACES=""`;

      // Define stubs BEFORE sourcing prompt.sh since it calls detect_agent_type at source time
      return runBash(
        `
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}

# Stubs needed by prompt.sh at source time
DETECTED_AGENT_TYPE="claude"
AGENT_COMMAND="claude -p"
detect_agent_type() { DETECTED_AGENT_TYPE="claude"; }

source ${JSON.stringify(join(LIB_DIR, "prompt.sh"))}
source ${JSON.stringify(join(LIB_DIR, "scope.sh"))}

PLAN_SCOPE="${opts.scope}"
FEEDBACK_COMMANDS="${opts.feedbackCommands}"
${wsLine}

resolve_scoped_feedback
echo "\$FEEDBACK_COMMANDS"
`,
        ctx.dir,
      ).trim();
    }

    it("pnpm: rewrites 'pnpm build' to 'pnpm --filter <name> build'", () => {
      const result = resolveFeedback({
        scope: "packages/web",
        feedbackCommands: "pnpm build",
        lockfile: "pnpm-lock.yaml",
        packageName: "@org/web",
      });
      expect(result).toBe("pnpm --filter @org/web build");
    });

    it("pnpm: rewrites 'pnpm run test' to 'pnpm --filter <name> test'", () => {
      const result = resolveFeedback({
        scope: "packages/web",
        feedbackCommands: "pnpm run test",
        lockfile: "pnpm-lock.yaml",
        packageName: "@org/web",
      });
      expect(result).toContain("--filter @org/web");
      expect(result).toContain("test");
    });

    it("yarn: rewrites 'yarn build' to 'yarn workspace <name> build'", () => {
      const result = resolveFeedback({
        scope: "packages/web",
        feedbackCommands: "yarn build",
        lockfile: "yarn.lock",
        packageName: "@org/web",
      });
      expect(result).toBe("yarn workspace @org/web build");
    });

    it("npm: rewrites 'npm run build' to 'npm -w <name> run build'", () => {
      const result = resolveFeedback({
        scope: "packages/web",
        feedbackCommands: "npm run build",
        lockfile: "package-lock.json",
        packageName: "@org/web",
      });
      expect(result).toBe("npm -w @org/web run build");
    });

    it("bun: rewrites 'bun build' to 'bun --filter <name> build'", () => {
      const result = resolveFeedback({
        scope: "packages/web",
        feedbackCommands: "bun build",
        lockfile: "bun.lockb",
        packageName: "@org/web",
      });
      expect(result).toBe("bun --filter @org/web build");
    });

    it("passes through non-PM commands unchanged", () => {
      const result = resolveFeedback({
        scope: "packages/web",
        feedbackCommands: "make test",
        lockfile: "pnpm-lock.yaml",
        packageName: "@org/web",
      });
      expect(result).toBe("make test");
    });

    it("uses workspace override when CONFIG_WORKSPACES matches scope", () => {
      const ws = JSON.stringify({
        "packages/web": {
          feedbackCommands: [
            "pnpm --filter web build",
            "pnpm --filter web test",
          ],
        },
      });
      const result = resolveFeedback({
        scope: "packages/web",
        feedbackCommands: "pnpm build",
        lockfile: "pnpm-lock.yaml",
        packageName: "@org/web",
        workspacesJson: ws,
      });
      // Should use the override, not derive from the root commands
      expect(result).toContain("pnpm --filter web build");
    });

    it("no-op when PLAN_SCOPE is empty", () => {
      const scopeDir = join(ctx.dir, "packages/web");
      mkdirSync(scopeDir, { recursive: true });
      writeFileSync(
        join(scopeDir, "package.json"),
        JSON.stringify({ name: "@org/web" }),
      );

      const result = runBash(
        `
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}

DETECTED_AGENT_TYPE="claude"
AGENT_COMMAND="claude -p"
detect_agent_type() { DETECTED_AGENT_TYPE="claude"; }

source ${JSON.stringify(join(LIB_DIR, "prompt.sh"))}
source ${JSON.stringify(join(LIB_DIR, "scope.sh"))}

PLAN_SCOPE=""
FEEDBACK_COMMANDS="pnpm build"
CONFIG_WORKSPACES=""

resolve_scoped_feedback
echo "\$FEEDBACK_COMMANDS"
`,
        ctx.dir,
      ).trim();
      expect(result).toBe("pnpm build");
    });
  },
);

// ---------------------------------------------------------------------------
// build_scope_hint() — agent prompt hint
// ---------------------------------------------------------------------------

describe.skipIf(process.platform === "win32")("build_scope_hint (bash)", () => {
  it("sets SCOPE_HINT when PLAN_SCOPE is set", () => {
    const result = runBash(`
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}

DETECTED_AGENT_TYPE="claude"
AGENT_COMMAND="claude -p"
detect_agent_type() { DETECTED_AGENT_TYPE="claude"; }

source ${JSON.stringify(join(LIB_DIR, "prompt.sh"))}
source ${JSON.stringify(join(LIB_DIR, "scope.sh"))}

PLAN_SCOPE="packages/web"
build_scope_hint
echo "\$SCOPE_HINT"
`);
    expect(result).toContain("packages/web");
    expect(result).toContain("scope");
  });

  it("SCOPE_HINT is empty when PLAN_SCOPE is empty", () => {
    const result = runBash(`
source ${JSON.stringify(join(LIB_DIR, "defaults.sh"))}

DETECTED_AGENT_TYPE="claude"
AGENT_COMMAND="claude -p"
detect_agent_type() { DETECTED_AGENT_TYPE="claude"; }

source ${JSON.stringify(join(LIB_DIR, "prompt.sh"))}
source ${JSON.stringify(join(LIB_DIR, "scope.sh"))}

PLAN_SCOPE=""
build_scope_hint
echo "HINT_START\${SCOPE_HINT}HINT_END"
`).trim();
    expect(result).toBe("HINT_STARTHINT_END");
  });
});
