import { describe, it, expect, beforeEach } from "bun:test";
import { existsSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { runCli, useTempGitDir } from "./test-utils.ts";
import { getConfigFilePath } from "./config.ts";
import { getRepoPipelineDirs } from "./global-state.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("runner config", () => {
  const ctx = useTempGitDir();

  /** Per-test RALPHAI_HOME so config goes to a temp dir, not ~/.ralphai. */
  function testEnv() {
    return { RALPHAI_HOME: join(ctx.dir, ".ralphai-home") };
  }

  /** Resolve the global config file path for this test's cwd. */
  function configPath() {
    return getConfigFilePath(ctx.dir, testEnv());
  }

  // -------------------------------------------------------------------------
  // Agent type detection
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")(
    "detect_agent_type mapping",
    () => {
      /** Helper: inline bash detect_agent_type logic for testing */
      function detectAgent(agentCommand: string): string {
        // Extract just the function and call it with a given AGENT_COMMAND
        const result = execSync(
          `bash -c 'AGENT_COMMAND=${JSON.stringify(agentCommand)}; detect_agent_type() { local cmd; cmd=$(echo "$AGENT_COMMAND" | tr "[:upper:]" "[:lower:]"); case "$cmd" in *claude*) DETECTED_AGENT_TYPE="claude" ;; *opencode*) DETECTED_AGENT_TYPE="opencode" ;; *codex*) DETECTED_AGENT_TYPE="codex" ;; *gemini*) DETECTED_AGENT_TYPE="gemini" ;; *aider*) DETECTED_AGENT_TYPE="aider" ;; *goose*) DETECTED_AGENT_TYPE="goose" ;; *kiro*) DETECTED_AGENT_TYPE="kiro" ;; *amp*) DETECTED_AGENT_TYPE="amp" ;; *) DETECTED_AGENT_TYPE="unknown" ;; esac; }; detect_agent_type; echo "$DETECTED_AGENT_TYPE"'`,
          { encoding: "utf-8" },
        ).trim();
        return result;
      }

      it("detects claude from command string", () => {
        expect(detectAgent("claude -p")).toBe("claude");
      });

      it("detects claude from wrapped command", () => {
        expect(detectAgent("npx claude -p")).toBe("claude");
      });

      it("detects opencode", () => {
        expect(detectAgent("opencode run --agent build")).toBe("opencode");
      });

      it("detects opencode from full path", () => {
        expect(detectAgent("/usr/local/bin/opencode run")).toBe("opencode");
      });

      it("detects codex", () => {
        expect(detectAgent("codex exec")).toBe("codex");
      });

      it("detects gemini", () => {
        expect(detectAgent("gemini")).toBe("gemini");
      });

      it("detects aider", () => {
        expect(detectAgent("aider --yes")).toBe("aider");
      });

      it("detects goose", () => {
        expect(detectAgent("goose run")).toBe("goose");
      });

      it("detects kiro", () => {
        expect(detectAgent("kiro")).toBe("kiro");
      });

      it("detects amp", () => {
        expect(detectAgent("amp run")).toBe("amp");
      });

      it("returns unknown for unrecognized commands", () => {
        expect(detectAgent("my-custom-agent")).toBe("unknown");
      });

      it("handles case-insensitive matching", () => {
        expect(detectAgent("Claude -p")).toBe("claude");
        expect(detectAgent("OPENCODE run")).toBe("opencode");
      });
    },
  );

  // -------------------------------------------------------------------------
  // --continuous config infrastructure tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")(
    "continuous config precedence",
    () => {
      /**
       * Helper: simulates the config loading pipeline for CONTINUOUS
       * and returns the resolved value.
       */
      function resolveContinuous(opts: {
        configValue?: string;
        envValue?: string;
        cliFlag?: boolean;
      }): string {
        const configContent = opts.configValue
          ? `continuous=${opts.configValue}`
          : "";
        const envExport = opts.envValue
          ? `export RALPHAI_CONTINUOUS=${JSON.stringify(opts.envValue)}`
          : "";
        const cliArg = opts.cliFlag ? "--continuous" : "";

        const script = `#!/bin/bash
set -e

# Defaults
DEFAULT_CONTINUOUS="false"
CONTINUOUS="$DEFAULT_CONTINUOUS"
CLI_CONTINUOUS=""

# Simulate load_config
CONFIG_CONTINUOUS=""
config_content=${JSON.stringify(configContent)}
if [[ -n "$config_content" ]]; then
  key="\${config_content%%=*}"
  value="\${config_content#*=}"
  if [[ "$key" == "continuous" ]]; then
    if [[ "$value" != "true" && "$value" != "false" ]]; then
      echo "ERROR: 'continuous' must be 'true' or 'false', got '$value'"
      exit 1
    fi
    CONFIG_CONTINUOUS="$value"
  fi
fi

# Simulate apply_config
if [[ -n "\${CONFIG_CONTINUOUS:-}" ]]; then
  CONTINUOUS="$CONFIG_CONTINUOUS"
fi

# Simulate apply_env_overrides
${envExport}
if [[ -n "\${RALPHAI_CONTINUOUS:-}" ]]; then
  if [[ "$RALPHAI_CONTINUOUS" != "true" && "$RALPHAI_CONTINUOUS" != "false" ]]; then
    echo "ERROR: RALPHAI_CONTINUOUS must be 'true' or 'false', got '$RALPHAI_CONTINUOUS'"
    exit 1
  fi
  CONTINUOUS="$RALPHAI_CONTINUOUS"
fi

# Simulate CLI flag parsing
for arg in ${cliArg}; do
  case "$arg" in
    --continuous)
      CLI_CONTINUOUS="true"
      ;;
  esac
done

# Simulate CLI override merge
if [[ -n "$CLI_CONTINUOUS" ]]; then
  CONTINUOUS="$CLI_CONTINUOUS"
fi

echo "$CONTINUOUS"
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-cont-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
          });
          return result.trim();
        } finally {
          try {
            rmSync(scriptFile);
          } catch {
            /* ignore */
          }
        }
      }

      it("defaults to false when no overrides", () => {
        expect(resolveContinuous({})).toBe("false");
      });

      it("config file sets continuous", () => {
        expect(resolveContinuous({ configValue: "true" })).toBe("true");
      });

      it("env var overrides config file", () => {
        expect(
          resolveContinuous({
            configValue: "true",
            envValue: "false",
          }),
        ).toBe("false");
      });

      it("CLI flag overrides env var", () => {
        expect(
          resolveContinuous({
            envValue: "false",
            cliFlag: true,
          }),
        ).toBe("true");
      });

      it("CLI flag overrides config and env", () => {
        expect(
          resolveContinuous({
            configValue: "false",
            envValue: "false",
            cliFlag: true,
          }),
        ).toBe("true");
      });

      it("rejects invalid config value", () => {
        expect(() => resolveContinuous({ configValue: "bad" })).toThrow();
      });

      it("rejects invalid env var value", () => {
        expect(() => resolveContinuous({ envValue: "bad" })).toThrow();
      });
    },
  );

  // -------------------------------------------------------------------------
  // --auto-commit config infrastructure tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")(
    "autoCommit config precedence",
    () => {
      /**
       * Helper: simulates the config loading pipeline for AUTO_COMMIT
       * and returns the resolved value.
       */
      function resolveAutoCommit(opts: {
        configValue?: string;
        envValue?: string;
        cliFlag?: "auto-commit" | "no-auto-commit";
      }): string {
        const configContent = opts.configValue
          ? `autoCommit=${opts.configValue}`
          : "";
        const envExport = opts.envValue
          ? `export RALPHAI_AUTO_COMMIT=${JSON.stringify(opts.envValue)}`
          : "";
        let cliArg = "";
        if (opts.cliFlag === "auto-commit") cliArg = "--auto-commit";
        else if (opts.cliFlag === "no-auto-commit") cliArg = "--no-auto-commit";

        const script = `#!/bin/bash
set -e

# Defaults
DEFAULT_AUTO_COMMIT="false"
AUTO_COMMIT="$DEFAULT_AUTO_COMMIT"
CLI_AUTO_COMMIT=""

# Simulate load_config
CONFIG_AUTO_COMMIT=""
config_content=${JSON.stringify(configContent)}
if [[ -n "$config_content" ]]; then
  key="\${config_content%%=*}"
  value="\${config_content#*=}"
  if [[ "$key" == "autoCommit" ]]; then
    if [[ "$value" != "true" && "$value" != "false" ]]; then
      echo "ERROR: 'autoCommit' must be true or false, got '$value'"
      exit 1
    fi
    CONFIG_AUTO_COMMIT="$value"
  fi
fi

# Simulate apply_config
if [[ -n "\${CONFIG_AUTO_COMMIT:-}" ]]; then
  AUTO_COMMIT="$CONFIG_AUTO_COMMIT"
fi

# Simulate apply_env_overrides
${envExport}
if [[ -n "\${RALPHAI_AUTO_COMMIT:-}" ]]; then
  if [[ "$RALPHAI_AUTO_COMMIT" != "true" && "$RALPHAI_AUTO_COMMIT" != "false" ]]; then
    echo "ERROR: RALPHAI_AUTO_COMMIT must be 'true' or 'false', got '$RALPHAI_AUTO_COMMIT'"
    exit 1
  fi
  AUTO_COMMIT="$RALPHAI_AUTO_COMMIT"
fi

# Simulate CLI flag parsing
for arg in ${cliArg}; do
  case "$arg" in
    --auto-commit)
      CLI_AUTO_COMMIT="true"
      ;;
    --no-auto-commit)
      CLI_AUTO_COMMIT="false"
      ;;
  esac
done

# Simulate CLI override merge
if [[ -n "$CLI_AUTO_COMMIT" ]]; then
  AUTO_COMMIT="$CLI_AUTO_COMMIT"
fi

echo "$AUTO_COMMIT"
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-ac-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
          });
          return result.trim();
        } finally {
          try {
            rmSync(scriptFile);
          } catch {
            /* ignore */
          }
        }
      }

      it("defaults to false when no overrides", () => {
        expect(resolveAutoCommit({})).toBe("false");
      });

      it("config file sets autoCommit to true", () => {
        expect(resolveAutoCommit({ configValue: "true" })).toBe("true");
      });

      it("config file sets autoCommit to false", () => {
        expect(resolveAutoCommit({ configValue: "false" })).toBe("false");
      });

      it("env var overrides config file", () => {
        expect(
          resolveAutoCommit({
            configValue: "true",
            envValue: "false",
          }),
        ).toBe("false");
      });

      it("env var sets autoCommit when no config", () => {
        expect(resolveAutoCommit({ envValue: "true" })).toBe("true");
      });

      it("--auto-commit CLI flag overrides env var", () => {
        expect(
          resolveAutoCommit({
            envValue: "false",
            cliFlag: "auto-commit",
          }),
        ).toBe("true");
      });

      it("--no-auto-commit CLI flag overrides env var", () => {
        expect(
          resolveAutoCommit({
            envValue: "true",
            cliFlag: "no-auto-commit",
          }),
        ).toBe("false");
      });

      it("CLI flag overrides config and env", () => {
        expect(
          resolveAutoCommit({
            configValue: "false",
            envValue: "false",
            cliFlag: "auto-commit",
          }),
        ).toBe("true");
      });

      it("rejects invalid config value", () => {
        expect(() => resolveAutoCommit({ configValue: "bad" })).toThrow();
      });

      it("rejects invalid env var value", () => {
        expect(() => resolveAutoCommit({ envValue: "bad" })).toThrow();
      });
    },
  );

  // -------------------------------------------------------------------------
  // Init defaults
  // -------------------------------------------------------------------------

  it("init --yes sets autoCommit=false by default", () => {
    runCli(["init", "--yes"], ctx.dir, testEnv());

    const config = JSON.parse(readFileSync(configPath(), "utf-8"));
    expect(config.mode).toBeUndefined();
    expect(config.autoCommit).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Run config tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("run config", () => {
    beforeEach(() => {
      // Scaffold ralphai (creates .ralphai/ directory)
      runCli(["init", "--yes"], ctx.dir, testEnv());
    });

    it("run --show-config shows default values", () => {
      const result = runCli(["run", "--show-config"], ctx.dir, testEnv());
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("iterationTimeout   = off");
      expect(result.stdout).toContain("(default)");
    });

    it("run --dry-run produces preview output", () => {
      const result = runCli(["run", "--dry-run"], ctx.dir, {
        ...testEnv(),
        RALPHAI_AGENT_COMMAND: "echo mock",
        RALPHAI_NO_UPDATE_CHECK: "1",
      });
      expect(result.exitCode).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("dry-run");
    });

    it("run --help shows usage information", () => {
      const result = runCli(["run", "--help"], ctx.dir, testEnv());
      expect(result.exitCode).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("--dry-run");
      expect(combined).toContain("--once");
    });

    it("run 3 is treated as an issue target (requires GitHub)", () => {
      const result = runCli(["run", "3"], ctx.dir, testEnv());
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      // Issue target requires GitHub repo detection — fails in test env
      expect(combined).toMatch(/GitHub repo|gh CLI/i);
    });

    it("built CLI runs the TS runner directly (no shell subprocess)", () => {
      const repoRoot = join(__dirname, "..");
      const distCli = join(repoRoot, "dist", "cli.mjs");

      // Read the baseBranch that init --yes wrote to global config so
      // the branch we create matches what the runner will validate.
      const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
      const branch = cfg.baseBranch || "main";
      execSync(`git checkout -b ${branch}`, {
        cwd: ctx.dir,
        stdio: "ignore",
      });
      execSync("git config user.name 'Test User'", {
        cwd: ctx.dir,
        stdio: "ignore",
      });
      execSync("git config user.email 'test@example.com'", {
        cwd: ctx.dir,
        stdio: "ignore",
      });
      execSync("git commit --allow-empty -m init", {
        cwd: ctx.dir,
        stdio: "ignore",
      });

      execSync("bun run build", {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Remove sample plan so the backlog is empty for this test
      const { backlogDir } = getRepoPipelineDirs(ctx.dir, testEnv());
      const samplePlanFile = join(backlogDir, "hello-world.md");
      if (existsSync(samplePlanFile)) rmSync(samplePlanFile, { force: true });

      const output = execFileSync("node", [distCli, "run", "--dry-run"], {
        cwd: ctx.dir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...testEnv(),
          RALPHAI_NO_UPDATE_CHECK: "1",
          RALPHAI_AGENT_COMMAND: "echo test-agent",
        },
      });

      expect(output).toContain("No runnable work found.");
    });
  });
});
