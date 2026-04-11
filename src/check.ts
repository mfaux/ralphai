/**
 * check command — verify whether ralphai is configured for a repo.
 *
 * Output contract: single line of plain text to stdout (no ANSI codes).
 * Exit 0 on success, exit 1 on failure.
 */

import { existsSync } from "fs";
import {
  getConfigFilePath,
  parseConfigFile,
  ConfigError,
  DEFAULTS,
} from "./config.ts";
import type { RalphaiConfig } from "./config.ts";
import { RESET, DIM, TEXT } from "./utils.ts";

// ---------------------------------------------------------------------------
// Capability map
// ---------------------------------------------------------------------------

/** Supported capability names. */
export const SUPPORTED_CAPABILITIES = ["issues"] as const;
export type CapabilityName = (typeof SUPPORTED_CAPABILITIES)[number];

interface CapabilityResult {
  pass: boolean;
  message: string;
}

type CapabilityCheck = (values: Partial<RalphaiConfig>) => CapabilityResult;

const CAPABILITY_MAP: Record<CapabilityName, CapabilityCheck> = {
  issues(values) {
    const issueSource = values.issue?.source ?? DEFAULTS.issue.source;
    if (issueSource === "github") {
      return { pass: true, message: "issues: github" };
    }
    return {
      pass: false,
      message: `configured, but missing capability: issues (issue.source is "${issueSource}")`,
    };
  },
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function runCheck(cwd: string, capabilities: string[] = []): void {
  const configPath = getConfigFilePath(cwd);

  // Case 1: no config file
  if (!existsSync(configPath)) {
    console.log("not configured — run ralphai init");
    process.exit(1);
  }

  // Case 2: config exists — validate it
  let values: Partial<RalphaiConfig>;
  try {
    const parsed = parseConfigFile(configPath);

    // parseConfigFile returns null when the file doesn't exist, but we
    // already checked that above, so parsed should never be null here.
    if (!parsed) {
      console.log("not configured — run ralphai init");
      process.exit(1);
      return; // unreachable but helps TypeScript narrow
    }

    values = parsed.values;
  } catch (err) {
    // Case 3: malformed JSON or invalid values
    if (err instanceof ConfigError) {
      console.log(`invalid config — ${err.message}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`invalid config — ${msg}`);
    }
    process.exit(1);
    return; // unreachable but helps TypeScript narrow
  }

  // No capabilities requested — simple config check
  if (capabilities.length === 0) {
    console.log("configured");
    return;
  }

  // Validate all capability names first
  for (const name of capabilities) {
    if (!SUPPORTED_CAPABILITIES.includes(name as CapabilityName)) {
      const supported = SUPPORTED_CAPABILITIES.join(", ");
      console.log(`unknown capability: "${name}" (supported: ${supported})`);
      process.exit(1);
    }
  }

  // Check all capabilities — all must pass
  const passMessages: string[] = [];
  for (const name of capabilities) {
    const check = CAPABILITY_MAP[name as CapabilityName];
    const result = check(values);
    if (!result.pass) {
      console.log(result.message);
      process.exit(1);
    }
    passMessages.push(result.message);
  }

  // All passed
  console.log(`configured (${passMessages.join(", ")})`);
}
