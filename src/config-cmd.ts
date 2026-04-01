/**
 * config command — unified entry point for querying configuration.
 *
 * Consolidates the former `backlog-dir`, `check`, and `run --show-config`
 * surfaces into a single subcommand:
 *
 *   ralphai config              Print fully resolved configuration
 *   ralphai config <key>        Print a specific config value
 *   ralphai config --check <c>  Validate a capability
 */

import { existsSync } from "fs";
import {
  resolveConfig,
  parseCLIArgs,
  ConfigError,
  getConfigFilePath,
} from "./config.ts";
import { formatShowConfig } from "./show-config.ts";
import { runCheck, showCheckHelp, SUPPORTED_CAPABILITIES } from "./check.ts";
import { getRepoPipelineDirs } from "./global-state.ts";
import { RESET, DIM, TEXT } from "./utils.ts";

// ---------------------------------------------------------------------------
// Supported config keys for `ralphai config <key>`
// ---------------------------------------------------------------------------

/** Keys that can be queried with `ralphai config <key>`. */
const QUERYABLE_KEYS = ["backlog-dir"] as const;
type QueryableKey = (typeof QUERYABLE_KEYS)[number];

function isQueryableKey(key: string): key is QueryableKey {
  return (QUERYABLE_KEYS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ConfigCommandOptions {
  cwd: string;
  key?: string;
  check?: string[];
}

export function runConfigCommand(options: ConfigCommandOptions): void {
  const { cwd, key, check } = options;

  // --check mode: delegate to existing check logic
  if (check && check.length > 0) {
    runCheck(cwd, check);
    return;
  }

  // Key query mode: `ralphai config <key>`
  if (key) {
    if (!isQueryableKey(key)) {
      console.error(`Unknown config key: "${key}"`);
      console.error(
        `${DIM}Supported keys: ${QUERYABLE_KEYS.join(", ")}${RESET}`,
      );
      process.exit(1);
    }

    // All key queries require an initialized repo
    const configPath = getConfigFilePath(cwd);
    if (!existsSync(configPath)) {
      console.error(
        `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
      );
      process.exit(1);
    }

    switch (key) {
      case "backlog-dir": {
        const { backlogDir } = getRepoPipelineDirs(cwd);
        console.log(backlogDir);
        return;
      }
    }

    return;
  }

  // Bare `ralphai config`: print fully resolved configuration
  const configPath = getConfigFilePath(cwd);
  if (!existsSync(configPath)) {
    console.error(
      `Ralphai is not set up. Run ${TEXT}ralphai init${RESET} first.`,
    );
    process.exit(1);
  }

  try {
    const result = resolveConfig({
      cwd,
      envVars: process.env as Record<string, string | undefined>,
      cliArgs: [],
    });

    for (const w of result.warnings) {
      console.error(w);
    }

    const text = formatShowConfig({
      config: result.config,
      configFilePath: result.configFilePath,
      configFileExists: existsSync(result.configFilePath),
      envVars: process.env as Record<string, string | undefined>,
      rawFlags: {},
      workspaces: result.config.workspaces.value,
    });
    console.log(text);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function showConfigCommandHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai config [<key>] [options]`);
  console.log();
  console.log(
    `${DIM}Query the resolved configuration for the current repo.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Commands:${RESET}`);
  console.log(
    `  ${TEXT}ralphai config${RESET}              ${DIM}Print fully resolved configuration${RESET}`,
  );
  console.log(
    `  ${TEXT}ralphai config backlog-dir${RESET}  ${DIM}Print the backlog directory path${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--check=<capability>${RESET}  ${DIM}Validate a capability (repeatable)${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Supported capabilities:${RESET}`);
  for (const cap of SUPPORTED_CAPABILITIES) {
    console.log(`  ${TEXT}${cap}${RESET}`);
  }
}
