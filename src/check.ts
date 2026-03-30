/**
 * check command — verify whether ralphai is configured for a repo.
 *
 * Output contract: single line of plain text to stdout (no ANSI codes).
 * Exit 0 on success, exit 1 on failure.
 */

import { existsSync } from "fs";
import { getConfigFilePath, parseConfigFile, ConfigError } from "./config.ts";
import { RESET, DIM, TEXT } from "./utils.ts";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function runCheck(cwd: string): void {
  const configPath = getConfigFilePath(cwd);

  // Case 1: no config file
  if (!existsSync(configPath)) {
    console.log("not configured — run ralphai init");
    process.exit(1);
  }

  // Case 2: config exists — validate it
  try {
    const parsed = parseConfigFile(configPath);

    // parseConfigFile returns null when the file doesn't exist, but we
    // already checked that above, so parsed should never be null here.
    if (!parsed) {
      console.log("not configured — run ralphai init");
      process.exit(1);
    }

    // Valid config
    console.log("configured");
  } catch (err) {
    // Case 3: malformed JSON or invalid values
    if (err instanceof ConfigError) {
      console.log(`invalid config — ${err.message}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`invalid config — ${msg}`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

export function showCheckHelp(): void {
  console.log(`${TEXT}Usage:${RESET} ralphai check [options]`);
  console.log();
  console.log(
    `${DIM}Verify whether ralphai is configured for the current repo.${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Output:${RESET}`);
  console.log(
    `  ${TEXT}configured${RESET}                 ${DIM}Config exists and is valid (exit 0)${RESET}`,
  );
  console.log(
    `  ${TEXT}not configured${RESET}             ${DIM}No config file found (exit 1)${RESET}`,
  );
  console.log(
    `  ${TEXT}invalid config — <detail>${RESET}  ${DIM}Config exists but is malformed (exit 1)${RESET}`,
  );
  console.log();
  console.log(`${TEXT}Options:${RESET}`);
  console.log(
    `  ${TEXT}--repo=<name>${RESET}   ${DIM}Check config for a different repo${RESET}`,
  );
}
