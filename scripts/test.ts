/**
 * Test runner that isolates files using mock.module() on built-in Node modules.
 *
 * bun's mock.module() leaks mocks across test files in the same process.
 * Files listed in ISOLATED are run in their own `bun test` invocation first,
 * then the rest of the suite runs without them.
 *
 * Remove this workaround if bun adds per-file mock isolation.
 */
import { execSync } from "child_process";
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

// Files that call mock.module() on built-in Node modules (child_process, fs).
// These must run in separate processes to prevent mock leaks.
const ISOLATED = [
  "src/fetch-prd-issue.test.ts",
  "src/interactive/github-issues.test.ts",
  "src/issue-blockers.test.ts",
  "src/label-lifecycle.test.ts",
  "src/parent-prd-discovery.test.ts",
  "src/pr-lifecycle-stdin.test.ts",
  "src/pr-lifecycle-subissue.test.ts",
  "src/prd-done-detection.test.ts",
  "src/prd-discovery.test.ts",
  "src/pull-issue-by-number.test.ts",
  "src/pull-prd-sub-issue.test.ts",
  "src/reset-labels.test.ts",
  "src/runner-github-drain.test.ts",
];

// Inherently slow tests (E2E runner loops, real process spawning, real sockets).
// Excluded when --fast is passed to keep the feedback loop under ~60s.
const SLOW = [
  "src/auto-detect-drain.test.ts",
  "src/stop.test.ts",
  "src/ipc-server.test.ts",
  "src/ipc-robustness.test.ts",
];

const fast = process.argv.includes("--fast");

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.name.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

const root = join(import.meta.dirname, "..");
const allTests = findTestFiles(join(root, "src")).map((f) =>
  relative(root, f).split("\\").join("/"),
);

const excluded = fast ? new Set([...ISOLATED, ...SLOW]) : new Set(ISOLATED);
const isolatedTests = ISOLATED.filter((f) => !fast || !SLOW.includes(f));
const mainTests = allTests.filter((f) => !excluded.has(f));

if (fast) {
  console.log(`--fast: skipping ${SLOW.length} slow test files`);
}

const TIMEOUT = "60000";

let failed = false;

// 1. Run isolated files one-by-one
for (const file of isolatedTests) {
  console.log(`\n--- isolated: ${file} ---`);
  try {
    execSync(`bun test --timeout ${TIMEOUT} ${file}`, {
      cwd: root,
      stdio: "inherit",
    });
  } catch {
    failed = true;
  }
}

// 2. Run the rest of the suite
console.log(`\n--- main suite (${mainTests.length} files) ---`);
try {
  execSync(`bun test --timeout ${TIMEOUT} ${mainTests.join(" ")}`, {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  failed = true;
}

if (failed) {
  process.exit(1);
}
