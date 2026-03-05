# Learnings

## Testing child process output capture

`spawnSync` with `stdio: "inherit"` sends output directly to the parent's file descriptors, bypassing any pipe that a grandparent test harness sets up via `execFileSync`. Use `stdio: ["inherit", "pipe", "pipe"]` and manually write `result.stdout`/`result.stderr` to `process.stdout`/`process.stderr` when the CLI output needs to be capturable by tests.

## Windows CI has no bash

Tests that spawn `.ralph/ralph.sh` (or any bash script) must be skipped on Windows. Use `describe.skipIf(process.platform === "win32")` — same pattern as the existing executable-permission tests.
