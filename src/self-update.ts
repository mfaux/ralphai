import { spawnSync, spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { compareVersions } from "./utils.ts";
import { RESET, BOLD, DIM, TEXT } from "./utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstallerPackageManager = "pnpm" | "npm" | "yarn" | "bun";

interface UpdateCheckCache {
  lastCheck: number;
  latestVersion: string;
}

// ---------------------------------------------------------------------------
// Package manager detection (based on the CLI binary's install path)
// ---------------------------------------------------------------------------

/**
 * Detect which package manager installed this CLI by inspecting the resolved
 * path of the running binary.
 *
 * On Unix, global installs create symlinks that we resolve with realpathSync.
 * On Windows, npm creates .cmd shims, so we use import.meta.url instead
 * (which always resolves to the actual JS file regardless of the shim).
 *
 * Path patterns:
 *   pnpm:  .../.pnpm/ralphai@x.y.z/node_modules/ralphai/...
 *   bun:   .../.bun/install/global/node_modules/ralphai/...
 *   yarn:  .../yarn/global/node_modules/ralphai/...
 *   npm:   fallback (no distinctive pattern)
 */
export function detectInstallerPM(
  resolvedPath?: string,
): InstallerPackageManager {
  const pathToCheck = resolvedPath ?? getResolvedBinaryPath();

  // Normalize to handle both / and \ (Windows)
  if (/[/\\]\.pnpm[/\\]/.test(pathToCheck)) return "pnpm";
  if (/[/\\]\.bun[/\\]/.test(pathToCheck)) return "bun";
  if (/[/\\]yarn[/\\]global[/\\]/.test(pathToCheck)) return "yarn";

  // Only check BUN_INSTALL env var when no explicit path was provided
  // (i.e. we're detecting from the real binary path, not a test path)
  if (!resolvedPath && process.env.BUN_INSTALL) return "bun";

  return "npm";
}

/**
 * Get the resolved real path of the currently running CLI binary.
 * Uses import.meta.url which works cross-platform (including through
 * Windows .cmd shims).
 */
function getResolvedBinaryPath(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    // Follow symlinks to the real file
    return realpathSync(currentFile);
  } catch {
    // Fallback: return the unresolved path
    return fileURLToPath(import.meta.url);
  }
}

// ---------------------------------------------------------------------------
// Build the update command
// ---------------------------------------------------------------------------

export function buildUpdateCommand(
  pm: InstallerPackageManager,
  packageName: string,
  tag: string,
): string {
  const spec = `${packageName}@${tag}`;

  switch (pm) {
    case "pnpm":
      return `pnpm add -g ${spec}`;
    case "npm":
      return `npm install -g ${spec}`;
    case "yarn":
      return `yarn global add ${spec}`;
    case "bun":
      return `bun add -g ${spec}`;
  }
}

// ---------------------------------------------------------------------------
// Run self-update
// ---------------------------------------------------------------------------

export function runSelfUpdate(options: {
  packageName: string;
  tag?: string;
  currentVersion?: string;
}): void {
  const pm = detectInstallerPM();
  const tag = options.tag ?? "latest";
  const command = buildUpdateCommand(pm, options.packageName, tag);

  console.log(`${TEXT}Updating ${options.packageName} using ${pm}...${RESET}`);
  console.log(`${DIM}$ ${command}${RESET}`);
  console.log();

  // Split command into executable and args.
  // Use shell: true so that .cmd shims resolve on Windows.
  const result = spawnSync(command, {
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  });

  // Forward captured output to the parent process
  if (result.stdout && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    console.error(
      `\n${TEXT}Error:${RESET} Failed to run update command: ${result.error.message}`,
    );
    if (pm === "npm" && result.error.message.includes("EACCES")) {
      console.error(`${DIM}Try running with sudo: sudo ${command}${RESET}`);
    }
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(
      `\n${TEXT}Error:${RESET} Update command exited with code ${result.status}.`,
    );
    if (pm === "npm") {
      console.error(
        `${DIM}If you see a permission error, try: sudo ${command}${RESET}`,
      );
    }
    process.exit(1);
  }

  console.log(`\n${TEXT}${options.packageName} updated successfully.${RESET}`);
}

// ---------------------------------------------------------------------------
// Update check cache
// ---------------------------------------------------------------------------

/**
 * Get the cache directory for ralphai, following XDG conventions.
 * Creates the directory if it doesn't exist.
 */
export function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const dir = join(base, "ralphai");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const CACHE_FILE_NAME = "update-check.json";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Read the update check cache and return version info if an update is
 * available. Returns null if no update, cache is missing, or cache is
 * unreadable.
 */
export function checkForUpdate(
  packageName: string,
  currentVersion: string,
  cacheDir?: string,
): { latest: string; current: string } | null {
  try {
    const dir = cacheDir ?? getCacheDir();
    const cacheFile = join(dir, CACHE_FILE_NAME);

    if (!existsSync(cacheFile)) return null;

    const raw = readFileSync(cacheFile, "utf-8");
    const cache: UpdateCheckCache = JSON.parse(raw);

    if (!cache.latestVersion || typeof cache.latestVersion !== "string") {
      return null;
    }

    if (compareVersions(cache.latestVersion, currentVersion) > 0) {
      return { latest: cache.latestVersion, current: currentVersion };
    }

    return null;
  } catch {
    // Corrupt or missing cache — silently ignore
    return null;
  }
}

/**
 * Spawn a detached background process that fetches the latest version
 * from the npm registry and writes it to the cache file.
 *
 * This adds zero latency to the CLI — the check runs in a separate
 * process that outlives the parent.
 */
export function spawnUpdateCheck(packageName: string, cacheDir?: string): void {
  try {
    const dir = cacheDir ?? getCacheDir();
    const cacheFile = join(dir, CACHE_FILE_NAME);

    // Check if we should run (throttle to once per CHECK_INTERVAL_MS)
    if (existsSync(cacheFile)) {
      try {
        const raw = readFileSync(cacheFile, "utf-8");
        const cache: UpdateCheckCache = JSON.parse(raw);
        if (Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
          return; // Too recent, skip
        }
      } catch {
        // Corrupt cache — proceed with check
      }
    }

    // Ensure cache directory exists
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Build the inline script for the background process.
    // Uses global fetch (available in Node 18+).
    const script = `
      const https = require('https');
      const fs = require('fs');
      const url = 'https://registry.npmjs.org/${packageName}/latest';
      const req = https.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const pkg = JSON.parse(data);
            if (pkg.version) {
              fs.writeFileSync(
                ${JSON.stringify(cacheFile)},
                JSON.stringify({ lastCheck: Date.now(), latestVersion: pkg.version })
              );
            }
          } catch {}
        });
      });
      req.on('error', () => {});
      req.end();
    `;

    const child = spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true, // Prevent console window flash on Windows
    });

    // Let the parent process exit without waiting for the child
    child.unref();
  } catch {
    // Silently ignore any errors — update check is best-effort
  }
}
