import { describe, it, expect, beforeEach } from "vitest";
import {
  existsSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execSync, execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { runCli, runCliOutput, useTempGitDir } from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("runner config", () => {
  const ctx = useTempGitDir();

  // -------------------------------------------------------------------------
  // Agent type detection
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains detect_agent_type function", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    // detect_agent_type is defined in validate.sh (shared helpers)
    const validate = readFileSync(join(templateLib, "validate.sh"), "utf-8");
    expect(validate).toContain("detect_agent_type()");
    expect(validate).toContain("DETECTED_AGENT_TYPE=");

    // prompt.sh calls detect_agent_type (defined in validate.sh, sourced earlier)
    const prompt = readFileSync(join(templateLib, "prompt.sh"), "utf-8");
    expect(prompt).toContain("detect_agent_type");
  });

  describe.skipIf(process.platform === "win32")(
    "detect_agent_type mapping",
    () => {
      /** Helper: source ralphai.sh's detect_agent_type and return the result */
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
  // Prompt formatting tests (format_file_ref + resolve_prompt_mode)
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains format_file_ref and resolve_prompt_mode functions", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const prompt = readFileSync(join(templateLib, "prompt.sh"), "utf-8");
    expect(prompt).toContain("format_file_ref()");
    expect(prompt).toContain("resolve_prompt_mode()");
    expect(prompt).toContain("RESOLVED_PROMPT_MODE=");
    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain('DEFAULT_PROMPT_MODE="auto"');
  });

  describe.skipIf(process.platform === "win32")(
    "format_file_ref and resolve_prompt_mode",
    () => {
      /**
       * Helper: run the resolve_prompt_mode + format_file_ref functions in bash
       * with a given PROMPT_MODE, DETECTED_AGENT_TYPE, and filepath.
       * Writes the script to a temp file to avoid newline escaping issues with bash -c.
       */
      function formatRef(opts: {
        promptMode: string;
        agentType: string;
        filepath: string;
        fileContent?: string;
      }): string {
        const setupFile =
          opts.fileContent !== undefined
            ? `printf '%s' ${JSON.stringify(opts.fileContent)} > ${JSON.stringify(opts.filepath)}`
            : "";
        const cleanupFile =
          opts.fileContent !== undefined
            ? `rm -f ${JSON.stringify(opts.filepath)}`
            : "";

        const script = `#!/bin/bash
PROMPT_MODE=${JSON.stringify(opts.promptMode)}
DETECTED_AGENT_TYPE=${JSON.stringify(opts.agentType)}
RESOLVED_PROMPT_MODE=""
resolve_prompt_mode() {
  if [[ "$PROMPT_MODE" == "at-path" || "$PROMPT_MODE" == "inline" ]]; then
    RESOLVED_PROMPT_MODE="$PROMPT_MODE"
    return
  fi
  case "$DETECTED_AGENT_TYPE" in
    claude|opencode) RESOLVED_PROMPT_MODE="at-path" ;;
    *)               RESOLVED_PROMPT_MODE="at-path" ;;
  esac
}
format_file_ref() {
  local filepath="$1"
  if [[ "$RESOLVED_PROMPT_MODE" == "inline" ]]; then
    if [[ -f "$filepath" ]]; then
      printf '<file path="%s">\\n%s\\n</file>' "$filepath" "$(cat "$filepath")"
    else
      printf '@%s' "$filepath"
    fi
  else
    printf '@%s' "$filepath"
  fi
}
resolve_prompt_mode
${setupFile}
format_file_ref ${JSON.stringify(opts.filepath)}
${cleanupFile}
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-test-script-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
        );
        try {
          writeFileSync(scriptFile, script);
          const result = execSync(`bash ${JSON.stringify(scriptFile)}`, {
            encoding: "utf-8",
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

      it("at-path mode returns @filepath", () => {
        const result = formatRef({
          promptMode: "at-path",
          agentType: "claude",
          filepath: "plan.md",
        });
        expect(result).toBe("@plan.md");
      });

      it("auto mode with claude agent returns @filepath", () => {
        const result = formatRef({
          promptMode: "auto",
          agentType: "claude",
          filepath: ".ralphai/pipeline/in-progress/prd-foo.md",
        });
        expect(result).toBe("@.ralphai/pipeline/in-progress/prd-foo.md");
      });

      it("auto mode with opencode agent returns @filepath", () => {
        const result = formatRef({
          promptMode: "auto",
          agentType: "opencode",
          filepath: "LEARNINGS.md",
        });
        expect(result).toBe("@LEARNINGS.md");
      });

      it("auto mode with unknown agent returns @filepath (conservative default)", () => {
        const result = formatRef({
          promptMode: "auto",
          agentType: "unknown",
          filepath: "plan.md",
        });
        expect(result).toBe("@plan.md");
      });

      it("inline mode embeds file contents with <file> wrapper", () => {
        const tmpFile = join(tmpdir(), `ralphai-fmt-test-${Date.now()}.md`);
        try {
          writeFileSync(tmpFile, "# Test Plan\nDo stuff.");
          const result = formatRef({
            promptMode: "inline",
            agentType: "claude",
            filepath: tmpFile,
          });
          expect(result).toContain(`<file path="${tmpFile}">`);
          expect(result).toContain("# Test Plan");
          expect(result).toContain("Do stuff.");
          expect(result).toContain("</file>");
        } finally {
          try {
            rmSync(tmpFile);
          } catch {
            /* ignore */
          }
        }
      });

      it("inline mode falls back to @filepath for non-existent files", () => {
        const result = formatRef({
          promptMode: "inline",
          agentType: "claude",
          filepath: "/tmp/ralphai-nonexistent-file-12345.md",
        });
        expect(result).toBe("@/tmp/ralphai-nonexistent-file-12345.md");
      });

      it("resolve_prompt_mode caches explicit at-path regardless of agent", () => {
        const result = formatRef({
          promptMode: "at-path",
          agentType: "aider",
          filepath: "foo.md",
        });
        expect(result).toBe("@foo.md");
      });

      it("resolve_prompt_mode caches explicit inline regardless of agent", () => {
        const tmpFile = join(tmpdir(), `ralphai-fmt-inline-${Date.now()}.md`);
        try {
          writeFileSync(tmpFile, "content here");
          const result = formatRef({
            promptMode: "inline",
            agentType: "opencode",
            filepath: tmpFile,
          });
          expect(result).toContain('<file path="');
          expect(result).toContain("content here");
        } finally {
          try {
            rmSync(tmpFile);
          } catch {
            /* ignore */
          }
        }
      });
    },
  );

  // -------------------------------------------------------------------------
  // promptMode config key tests (config file, env var, CLI flag)
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains promptMode config infrastructure", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Config file loader reads promptMode from JSON
    expect(config).toContain('"promptMode"');
    expect(config).toContain("CONFIG_PROMPT_MODE=");
    // Env var override
    expect(config).toContain("RALPHAI_PROMPT_MODE");

    const cli = readFileSync(join(templateLib, "cli.sh"), "utf-8");
    // CLI flag
    expect(cli).toContain("--prompt-mode=");
    expect(cli).toContain("CLI_PROMPT_MODE=");
  });

  describe.skipIf(process.platform === "win32")(
    "promptMode config precedence",
    () => {
      /**
       * Helper: create a minimal bash script that sources the config loading
       * functions from ralphai.sh and tests PROMPT_MODE resolution.
       * We inline the relevant functions to avoid needing a full git repo.
       */
      function resolvePromptMode(opts: {
        configValue?: string;
        envValue?: string;
        cliValue?: string;
      }): string {
        const configContent = opts.configValue
          ? `promptMode=${opts.configValue}`
          : "";
        const envExport = opts.envValue
          ? `export RALPHAI_PROMPT_MODE=${JSON.stringify(opts.envValue)}`
          : "";
        const cliFlag = opts.cliValue ? `--prompt-mode=${opts.cliValue}` : "";

        // Build a script that simulates the config loading pipeline
        const script = `#!/bin/bash
set -e

# Defaults
DEFAULT_PROMPT_MODE="auto"
PROMPT_MODE="$DEFAULT_PROMPT_MODE"
CLI_PROMPT_MODE=""

# Simulate load_config
CONFIG_PROMPT_MODE=""
config_content=${JSON.stringify(configContent)}
if [[ -n "$config_content" ]]; then
  key="\${config_content%%=*}"
  value="\${config_content#*=}"
  if [[ "$key" == "promptMode" ]]; then
    if [[ "$value" != "auto" && "$value" != "at-path" && "$value" != "inline" ]]; then
      echo "ERROR: 'promptMode' must be 'auto', 'at-path', or 'inline', got '$value'"
      exit 1
    fi
    CONFIG_PROMPT_MODE="$value"
  fi
fi

# Simulate apply_config
if [[ -n "\${CONFIG_PROMPT_MODE:-}" ]]; then
  PROMPT_MODE="$CONFIG_PROMPT_MODE"
fi

# Simulate apply_env_overrides
${envExport}
if [[ -n "\${RALPHAI_PROMPT_MODE:-}" ]]; then
  if [[ "$RALPHAI_PROMPT_MODE" != "auto" && "$RALPHAI_PROMPT_MODE" != "at-path" && "$RALPHAI_PROMPT_MODE" != "inline" ]]; then
    echo "ERROR: RALPHAI_PROMPT_MODE must be 'auto', 'at-path', or 'inline', got '$RALPHAI_PROMPT_MODE'"
    exit 1
  fi
  PROMPT_MODE="$RALPHAI_PROMPT_MODE"
fi

# Simulate CLI flag parsing
for arg in ${cliFlag}; do
  case "$arg" in
    --prompt-mode=*)
      CLI_PROMPT_MODE="\${arg#--prompt-mode=}"
      if [[ "$CLI_PROMPT_MODE" != "auto" && "$CLI_PROMPT_MODE" != "at-path" && "$CLI_PROMPT_MODE" != "inline" ]]; then
        echo "ERROR: --prompt-mode must be 'auto', 'at-path', or 'inline', got '$CLI_PROMPT_MODE'"
        exit 1
      fi
      ;;
  esac
done

# Simulate CLI override merge
if [[ -n "$CLI_PROMPT_MODE" ]]; then
  PROMPT_MODE="$CLI_PROMPT_MODE"
fi

echo "$PROMPT_MODE"
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-pm-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
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

      it("defaults to auto when no overrides", () => {
        expect(resolvePromptMode({})).toBe("auto");
      });

      it("config file sets promptMode", () => {
        expect(resolvePromptMode({ configValue: "inline" })).toBe("inline");
      });

      it("env var overrides config file", () => {
        expect(
          resolvePromptMode({
            configValue: "inline",
            envValue: "at-path",
          }),
        ).toBe("at-path");
      });

      it("CLI flag overrides env var", () => {
        expect(
          resolvePromptMode({
            envValue: "at-path",
            cliValue: "inline",
          }),
        ).toBe("inline");
      });

      it("CLI flag overrides config and env", () => {
        expect(
          resolvePromptMode({
            configValue: "inline",
            envValue: "at-path",
            cliValue: "auto",
          }),
        ).toBe("auto");
      });

      it("rejects invalid config value", () => {
        expect(() => resolvePromptMode({ configValue: "bad" })).toThrow();
      });

      it("rejects invalid env var value", () => {
        expect(() => resolvePromptMode({ envValue: "bad" })).toThrow();
      });

      it("rejects invalid CLI flag value", () => {
        expect(() => resolvePromptMode({ cliValue: "bad" })).toThrow();
      });
    },
  );

  // -------------------------------------------------------------------------
  // --continuous config infrastructure tests
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh contains continuous config infrastructure", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain('DEFAULT_CONTINUOUS="false"');
    expect(defaults).toContain('CONTINUOUS="$DEFAULT_CONTINUOUS"');
    expect(defaults).toContain('CLI_CONTINUOUS=""');

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Config file loader reads continuous from JSON
    expect(config).toContain('"continuous"');
    expect(config).toContain("CONFIG_CONTINUOUS=");
    // Env var override
    expect(config).toContain("RALPHAI_CONTINUOUS");

    const cli = readFileSync(join(templateLib, "cli.sh"), "utf-8");
    // CLI flag
    expect(cli).toContain("--continuous)");
    expect(cli).toContain('CLI_CONTINUOUS="true"');
    // Help text
    expect(cli).toContain(
      "Keep processing backlog plans after the first completes",
    );
    // Supported keys list
    expect(cli).toContain("continuous,");
    // Show-config output (now in show_config.sh)
    const showConfig = readFileSync(
      join(templateLib, "show_config.sh"),
      "utf-8",
    );
    expect(showConfig).toContain("continuous         =");
  });

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

  it("scaffolded ralphai.sh contains autoCommit config infrastructure", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");

    const defaults = readFileSync(join(templateLib, "defaults.sh"), "utf-8");
    expect(defaults).toContain('DEFAULT_AUTO_COMMIT="false"');
    expect(defaults).toContain('AUTO_COMMIT="$DEFAULT_AUTO_COMMIT"');
    expect(defaults).toContain('CLI_AUTO_COMMIT=""');

    const config = readFileSync(join(templateLib, "config.sh"), "utf-8");
    // Config file loader reads autoCommit from JSON
    expect(config).toContain('"autoCommit"');
    expect(config).toContain("CONFIG_AUTO_COMMIT=");
    // Env var override
    expect(config).toContain("RALPHAI_AUTO_COMMIT");

    const cli = readFileSync(join(templateLib, "cli.sh"), "utf-8");
    // CLI flags
    expect(cli).toContain("--auto-commit)");
    expect(cli).toContain("--no-auto-commit)");
    expect(cli).toContain('CLI_AUTO_COMMIT="true"');
    expect(cli).toContain('CLI_AUTO_COMMIT="false"');
    // Help text
    expect(cli).toContain("Enable auto-commit of agent changes");
    expect(cli).toContain("Disable auto-commit");
    // Supported keys list
    expect(cli).toContain("autoCommit");
    // Show-config output (now in show_config.sh)
    const showConfig = readFileSync(
      join(templateLib, "show_config.sh"),
      "utf-8",
    );
    expect(showConfig).toContain("autoCommit         =");
  });

  it("scaffolded ralphai.sh gates per-turn auto-commit on AUTO_COMMIT and MODE", () => {
    const templateDir = join(__dirname, "..", "runner");
    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");

    // Patch mode with autoCommit=false skips auto-commit
    expect(ralphaiSh).toContain(
      'AUTO_COMMIT" == "false" && "$MODE" == "patch"',
    );
    expect(ralphaiSh).toContain("autoCommit=false, skipping recovery commit");
  });

  it("scaffolded git.sh gates resume recovery on AUTO_COMMIT and MODE", () => {
    const templateLib = join(__dirname, "..", "runner", "lib");
    const gitSh = readFileSync(join(templateLib, "git.sh"), "utf-8");

    // Resume with autoCommit=false in patch mode skips recovery commit
    expect(gitSh).toContain('AUTO_COMMIT" == "false" && "$MODE" == "patch"');
    expect(gitSh).toContain("autoCommit=false, skipping recovery commit");
  });

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
  // Workflow mode tests (branch / pr / patch)
  // -------------------------------------------------------------------------

  it("init --yes generates config with mode=branch as the default", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const config = JSON.parse(
      readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
    );
    expect(config.mode).toBe("branch");
  });

  it("scaffolded cli.sh has --branch, --pr, and --patch CLI flags", () => {
    const cli = readFileSync(
      join(__dirname, "..", "runner", "lib", "cli.sh"),
      "utf-8",
    );
    expect(cli).toContain("--branch)");
    expect(cli).toContain("--pr)");
    expect(cli).toContain("--patch)");
    // --direct should no longer exist
    expect(cli).not.toContain("--direct)");
  });

  it("scaffolded defaults.sh sets DEFAULT_MODE to branch", () => {
    const defaults = readFileSync(
      join(__dirname, "..", "runner", "lib", "defaults.sh"),
      "utf-8",
    );
    expect(defaults).toContain('DEFAULT_MODE="branch"');
    // Old default should not exist
    expect(defaults).not.toContain('DEFAULT_MODE="direct"');
  });

  it("scaffolded config.sh validates mode as branch|pr|patch in config file", () => {
    const config = readFileSync(
      join(__dirname, "..", "runner", "lib", "config.sh"),
      "utf-8",
    );
    expect(config).toContain(
      'validate_enum "$value" "$config_path: \'mode\'" "branch" "pr" "patch"',
    );
  });

  it("scaffolded config.sh validates RALPHAI_MODE env var as branch|pr|patch", () => {
    const config = readFileSync(
      join(__dirname, "..", "runner", "lib", "config.sh"),
      "utf-8",
    );
    expect(config).toContain(
      'validate_enum "$RALPHAI_MODE" "RALPHAI_MODE" "branch" "pr" "patch"',
    );
  });

  it("init --yes sets autoCommit=false by default (non-patch mode)", () => {
    runCliOutput(["init", "--yes"], ctx.dir);

    const config = JSON.parse(
      readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
    );
    // Default mode is "branch" so auto-commit question is never asked
    expect(config.mode).toBe("branch");
    expect(config.autoCommit).toBe(false);
  });

  it("scaffolded ralphai.sh auto-commit guard uses patch mode", () => {
    const ralphaiSh = readFileSync(
      join(__dirname, "..", "runner", "ralphai.sh"),
      "utf-8",
    );
    // Auto-commit skip guard should check for patch mode
    expect(ralphaiSh).toContain('"patch"');
    // Should not reference "direct" mode anywhere
    expect(ralphaiSh).not.toMatch(/\bdirect\b.*mode/i);
  });

  describe.skipIf(process.platform === "win32")(
    "mode config precedence",
    () => {
      /**
       * Helper: simulates the config loading pipeline for MODE
       * and returns the resolved value.
       */
      function resolveMode(opts: {
        configValue?: string;
        envValue?: string;
        cliFlag?: string;
      }): string {
        const configContent = opts.configValue
          ? `mode=${opts.configValue}`
          : "";
        const envExport = opts.envValue
          ? `export RALPHAI_MODE=${JSON.stringify(opts.envValue)}`
          : "";
        let cliArg = "";
        if (opts.cliFlag === "branch") cliArg = "--branch";
        else if (opts.cliFlag === "pr") cliArg = "--pr";
        else if (opts.cliFlag === "patch") cliArg = "--patch";

        const script = `#!/bin/bash
set -e

# Defaults
DEFAULT_MODE="branch"
MODE="$DEFAULT_MODE"
CLI_MODE=""

# Simulate load_config
CONFIG_MODE=""
config_content=${JSON.stringify(configContent)}
if [[ -n "$config_content" ]]; then
  key="\${config_content%%=*}"
  value="\${config_content#*=}"
  if [[ "$key" == "mode" ]]; then
    if [[ "$value" != "branch" && "$value" != "pr" && "$value" != "patch" ]]; then
      echo "ERROR: 'mode' must be 'branch', 'pr', or 'patch', got '$value'"
      exit 1
    fi
    CONFIG_MODE="$value"
  fi
fi

# Simulate apply_config
if [[ -n "\${CONFIG_MODE:-}" ]]; then
  MODE="$CONFIG_MODE"
fi

# Simulate apply_env_overrides
${envExport}
if [[ -n "\${RALPHAI_MODE:-}" ]]; then
  if [[ "$RALPHAI_MODE" != "branch" && "$RALPHAI_MODE" != "pr" && "$RALPHAI_MODE" != "patch" ]]; then
    echo "ERROR: RALPHAI_MODE must be 'branch', 'pr', or 'patch', got '$RALPHAI_MODE'"
    exit 1
  fi
  MODE="$RALPHAI_MODE"
fi

# Simulate CLI flag parsing
for arg in ${cliArg}; do
  case "$arg" in
    --branch)
      CLI_MODE="branch"
      ;;
    --pr)
      CLI_MODE="pr"
      ;;
    --patch)
      CLI_MODE="patch"
      ;;
  esac
done

# Simulate CLI override merge
if [[ -n "$CLI_MODE" ]]; then
  MODE="$CLI_MODE"
fi

echo "$MODE"
`;

        const scriptFile = join(
          tmpdir(),
          `ralphai-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
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

      it("defaults to branch when no overrides", () => {
        expect(resolveMode({})).toBe("branch");
      });

      it("config file sets mode to pr", () => {
        expect(resolveMode({ configValue: "pr" })).toBe("pr");
      });

      it("config file sets mode to patch", () => {
        expect(resolveMode({ configValue: "patch" })).toBe("patch");
      });

      it("config file sets mode to branch", () => {
        expect(resolveMode({ configValue: "branch" })).toBe("branch");
      });

      it("env var overrides config file", () => {
        expect(
          resolveMode({
            configValue: "branch",
            envValue: "pr",
          }),
        ).toBe("pr");
      });

      it("env var sets mode when no config", () => {
        expect(resolveMode({ envValue: "patch" })).toBe("patch");
      });

      it("--branch CLI flag overrides env var", () => {
        expect(
          resolveMode({
            envValue: "pr",
            cliFlag: "branch",
          }),
        ).toBe("branch");
      });

      it("--pr CLI flag overrides env var", () => {
        expect(
          resolveMode({
            envValue: "branch",
            cliFlag: "pr",
          }),
        ).toBe("pr");
      });

      it("--patch CLI flag overrides env var", () => {
        expect(
          resolveMode({
            envValue: "pr",
            cliFlag: "patch",
          }),
        ).toBe("patch");
      });

      it("CLI flag overrides config and env", () => {
        expect(
          resolveMode({
            configValue: "branch",
            envValue: "pr",
            cliFlag: "patch",
          }),
        ).toBe("patch");
      });

      it("rejects invalid config value", () => {
        expect(() => resolveMode({ configValue: "direct" })).toThrow();
      });

      it("rejects invalid env var value", () => {
        expect(() => resolveMode({ envValue: "direct" })).toThrow();
      });
    },
  );

  describe.skipIf(process.platform === "win32")(
    "mode --show-config display",
    () => {
      let stubScript: string;

      beforeEach(() => {
        runCliOutput(["init", "--yes"], ctx.dir);
        stubScript = join(ctx.dir, "stub-runner.sh");
        writeFileSync(stubScript, '#!/bin/bash\necho "ARGS:$*"\n');
        chmodSync(stubScript, 0o755);
      });

      it("--show-config displays mode=branch as default", () => {
        const result = runCli(["run", "--show-config"], ctx.dir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("mode               = branch");
      });

      it("--show-config shows mode=pr when set in config", () => {
        const configPath = join(ctx.dir, "ralphai.json");
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        config.mode = "pr";
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        const result = runCli(["run", "--show-config"], ctx.dir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("mode               = pr");
      });

      it("--show-config shows mode=patch when set in config", () => {
        const configPath = join(ctx.dir, "ralphai.json");
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        config.mode = "patch";
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        const result = runCli(["run", "--show-config"], ctx.dir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("mode               = patch");
      });

      it("RALPHAI_MODE env var overrides config mode in --show-config", () => {
        const result = runCli(["run", "--show-config"], ctx.dir, {
          RALPHAI_MODE: "patch",
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("mode               = patch");
        expect(result.stdout).toContain("env (RALPHAI_MODE=patch)");
      });

      it("--branch CLI flag overrides mode in --show-config", () => {
        const configPath = join(ctx.dir, "ralphai.json");
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        config.mode = "pr";
        writeFileSync(configPath, JSON.stringify(config, null, 2));

        const result = runCli(["run", "--branch", "--show-config"], ctx.dir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("mode               = branch");
        expect(result.stdout).toContain("cli (--branch)");
      });

      it("--patch CLI flag overrides mode in --show-config", () => {
        const result = runCli(["run", "--patch", "--show-config"], ctx.dir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("mode               = patch");
        expect(result.stdout).toContain("cli (--patch)");
      });

      it("RALPHAI_MODE rejects invalid value", () => {
        const result = runCli(["run", "--show-config"], ctx.dir, {
          RALPHAI_MODE: "direct",
        });
        const combined = result.stdout + result.stderr;
        expect(result.exitCode).not.toBe(0);
        expect(combined).toContain(
          "RALPHAI_MODE must be 'branch', 'pr', or 'patch'",
        );
      });
    },
  );

  // -------------------------------------------------------------------------
  // Prompt construction wiring tests (format_file_ref used in prompt)
  // -------------------------------------------------------------------------

  it("scaffolded ralphai.sh wires format_file_ref into prompt construction and detect_plan", () => {
    const templateDir = join(__dirname, "..", "runner");
    const templateLib = join(templateDir, "lib");

    const plans = readFileSync(join(templateLib, "plans.sh"), "utf-8");
    const prompt = readFileSync(join(templateLib, "prompt.sh"), "utf-8");
    const ralphaiSh = readFileSync(join(templateDir, "ralphai.sh"), "utf-8");
    // detect_plan: FILE_REFS uses format_file_ref
    expect(plans).toContain('FILE_REFS="$FILE_REFS $(format_file_ref "$f")"');
    // detect_plan: dry-run chosen
    expect(plans).toContain('FILE_REFS=" $(format_file_ref "$chosen")"');
    // detect_plan: normal chosen
    expect(plans).toContain('FILE_REFS=" $(format_file_ref "$dest")"');
    // LEARNINGS_REF uses format_file_ref
    expect(prompt).toContain(
      'LEARNINGS_REF=" $(format_file_ref "$RALPHAI_LEARNINGS_FILE")"',
    );
    // Prompt construction uses format_file_ref for progress file
    expect(ralphaiSh).toContain(
      '$(format_file_ref "${PROGRESS_FILE}")${LEARNINGS_REF}',
    );
    // Should NOT have any hardcoded @$var or @${VAR} file references in
    // prompt construction or detect_plan FILE_REFS assignments
    expect(plans).not.toMatch(/FILE_REFS=.*@\$/);
    expect(prompt).not.toContain('LEARNINGS_REF=" @');
  });

  // -------------------------------------------------------------------------
  // Run default turn tests
  // -------------------------------------------------------------------------

  describe.skipIf(process.platform === "win32")("run default turns", () => {
    let stubScript: string;

    beforeEach(() => {
      // Scaffold ralphai (creates .ralphai/ directory)
      runCliOutput(["init", "--yes"], ctx.dir);
      // Create a stub script that echoes args (used via RALPHAI_RUNNER_SCRIPT env var)
      stubScript = join(ctx.dir, "stub-runner.sh");
      writeFileSync(stubScript, '#!/bin/bash\necho "ARGS:$*"\n');
      chmodSync(stubScript, 0o755);
    });

    it("run without args lets the runner apply its default turn count", () => {
      const result = runCli(["run"], ctx.dir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:");
      expect(result.stdout).not.toContain("ARGS:5");
    });

    it("run -- --turns=5 passes explicit turn count to ralphai.sh", () => {
      const result = runCli(["run", "--", "--turns=5"], ctx.dir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=5");
    });

    it("run -- --dry-run passes flags to ralphai.sh", () => {
      const result = runCli(["run", "--", "--dry-run"], ctx.dir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--dry-run");
    });

    it("run -- --turns=5 --resume passes multiple args to ralphai.sh", () => {
      const result = runCli(["run", "--", "--turns=5", "--resume"], ctx.dir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=5 --resume");
    });

    it("run --turns=3 passes turn count without -- separator", () => {
      const result = runCli(["run", "--turns=3"], ctx.dir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=3");
    });

    it("run --dry-run passes flags without -- separator", () => {
      const result = runCli(["run", "--dry-run"], ctx.dir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--dry-run");
    });

    it("run --turns=3 --resume passes multiple args without -- separator", () => {
      const result = runCli(["run", "--turns=3", "--resume"], ctx.dir, {
        RALPHAI_RUNNER_SCRIPT: stubScript,
      });
      expect(result.stdout).toContain("ARGS:--turns=3 --resume");
    });

    it("run 3 is rejected by the bundled runner", () => {
      const result = runCli(["run", "3"], ctx.dir);
      const combined = result.stdout + result.stderr;
      expect(result.exitCode).not.toBe(0);
      expect(combined).toContain("Unrecognized argument: 3");
    });

    it("run --show-config shows turns from config file", () => {
      // Modify ralphai.json to set turns: 3
      const configPath = join(ctx.dir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 3;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--show-config"], ctx.dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = 3");
      expect(result.stdout).toContain("(config (ralphai.json))");
    });

    it("RALPHAI_TURNS env var overrides config file turns", () => {
      const configPath = join(ctx.dir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 3;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--show-config"], ctx.dir, {
        RALPHAI_TURNS: "10",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = 10");
      expect(result.stdout).toContain("(env (RALPHAI_TURNS=10))");
    });

    it("CLI --turns overrides both config and env var", () => {
      const configPath = join(ctx.dir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 3;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--turns=7", "--show-config"], ctx.dir, {
        RALPHAI_TURNS: "10",
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = 7");
      expect(result.stdout).toContain("(cli (--turns=7))");
    });

    it("turns: 0 in config displays as unlimited", () => {
      const configPath = join(ctx.dir, "ralphai.json");
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.turns = 0;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const result = runCli(["run", "--show-config"], ctx.dir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("turns              = unlimited");
      expect(result.stdout).toContain("(config (ralphai.json))");
    });

    it("built CLI can locate the bundled runner script", () => {
      const repoRoot = join(__dirname, "..");
      const distCli = join(repoRoot, "dist", "cli.mjs");

      // Read the baseBranch that init --yes wrote to ralphai.json so
      // the branch we create matches what the runner will validate.
      const cfg = JSON.parse(
        readFileSync(join(ctx.dir, "ralphai.json"), "utf-8"),
      );
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

      execSync("pnpm build", {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Remove sample plan so the backlog is empty for this test
      const samplePlan = join(
        ctx.dir,
        ".ralphai",
        "pipeline",
        "backlog",
        "hello-ralphai.md",
      );
      if (existsSync(samplePlan)) rmSync(samplePlan);

      const output = execFileSync(
        "node",
        [distCli, "run", "--dry-run", "--pr"],
        {
          cwd: ctx.dir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            RALPHAI_NO_UPDATE_CHECK: "1",
            RALPHAI_AGENT_COMMAND: "echo test-agent",
          },
        },
      );

      expect(output).toContain("No runnable work found.");
    });
  });
});
