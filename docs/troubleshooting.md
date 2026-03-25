# Troubleshooting

Common issues and how to resolve them.

## "My plan is stuck"

Ralphai aborts when it detects 3 consecutive iterations with no new commits (configurable via `maxStuck`). The plan stays in `pipeline/in-progress/<slug>/` so you can resume after fixing the issue.

**Steps:**

1. Check `LEARNINGS.md` (in `~/.ralphai/repos/<id>/`) for repeated errors — if the agent logged the same mistake multiple times, the plan likely needs adjustment.
2. Open the progress file in `pipeline/in-progress/<slug>/progress.md` to see what the agent attempted and where it got stuck.
3. Edit the plan file in `pipeline/in-progress/<slug>/<slug>.md` — simplify the current step, add hints, or break it into smaller subtasks.
4. Resume: `ralphai run --resume`

The `--resume` flag auto-commits any dirty working tree state and continues from where the agent left off, preserving the existing progress file.

## "Agent keeps making the same mistake"

Add the mistake to `LEARNINGS.md` (in `~/.ralphai/repos/<id>/`) with a clear description of what went wrong, why, and how to avoid it. Ralphai includes this file in every prompt, so the agent will see it in the next iteration.

```markdown
### 2025-01-15 — Describe the mistake briefly

**What went wrong:** The agent used `console.warn` for messages that tests needed to capture.

**Root cause:** `execFileSync` only returns stdout; stderr is discarded on success.

**Fix / Prevention:** Use `console.log` with a styled prefix for messages that need to appear in test output.
```

## "Build/test didn't run"

The agent is instructed to run feedback commands each iteration, but the commands themselves come from your configuration.

**Check:**

1. Verify `feedbackCommands` in `config.json` lists the right commands:
   ```json
   {
     "feedbackCommands": ["pnpm build", "pnpm test", "pnpm type-check"]
   }
   ```
2. Run each command manually to confirm it works — if a command fails outside of ralphai, it will fail inside too.
3. Run `ralphai doctor` to validate your setup. It checks each feedback command and reports pass/fail.

If `feedbackCommands` is empty, `ralphai init` auto-detects commands based on your project ecosystem. For Node.js, it reads `package.json` scripts (looks for `build`, `test`, `type-check`, `typecheck`, `lint`, `format:check`). For .NET, it suggests `dotnet build` and `dotnet test`. Other ecosystems (Go, Rust, Python, Java/Kotlin) get similar defaults.

## "Wrong agent was used"

The agent CLI is configured via `agentCommand` with this precedence:

1. `--agent-command=<cmd>` CLI flag (highest priority)
2. `RALPHAI_AGENT_COMMAND` environment variable
3. `agentCommand` in `config.json`

**Check:**

- Run `ralphai run --show-config` to see the resolved value.
- Verify the first token of the command is in your `PATH` — `ralphai doctor` checks this.
- If unset, ralphai exits with: `ERROR: agentCommand is required.`

## "Plan failed on first iteration"

**Check:**

1. Run `ralphai status` to see pipeline state and any reported problems (orphaned receipts, missing worktrees).
2. Ensure the plan follows the Ralphai plan format — it needs a title, description, and implementation tasks. Install the planning skill (`npx skills add mfaux/ralphai -g`) for format guidance.
3. Verify the agent CLI is installed and working: run your `agentCommand` manually (e.g., `claude --version` or `opencode --version`).
4. Run `ralphai doctor` for a full health check of your setup.

## "ralphai run says a plan is already running in a worktree"

This is expected. `ralphai run` starts from the main repo, then hands work off to a managed worktree. If a plan is already active, Ralphai blocks conflicting starts from the main checkout and tells you which worktree owns the run.

**Options:**

- Run `ralphai status` to see the active plan and worktree state
- Resume from the main repo with `ralphai run` or `ralphai run --plan=<file>`
- Clean up abandoned finished worktrees with `ralphai worktree clean`
- Inspect `~/.ralphai/repos/<id>/pipeline/in-progress/<slug>/receipt.txt` for the exact worktree path and branch

## "Working tree is dirty" after init

Running `ralphai run` immediately after `ralphai init` may report a dirty working tree because init modifies `.gitignore` and optionally creates `AGENTS.md`. In an interactive terminal, Ralphai will prompt you to continue anyway.

**Options:**

- **Accept the prompt** when Ralphai asks "Continue anyway?"
- **Commit the init files first:** `git add .gitignore AGENTS.md && git commit -m "chore: configure ralphai"`
- **Skip the check explicitly:** `ralphai run --allow-dirty`

## "Not inside a git repository"

Commands that operate on repo state, such as `run`, `worktree`, and `init`, require a git repository. If you run them outside one, Ralphai exits with:

```
ERROR: <command> must be run inside a git repository.
```

**Options:**

- `cd` into your repo first, then run the command
- Use `ralphai repos` to see all known repos and their paths
- Use `--repo=<name-or-path>` with read-only commands (`status`, `doctor`, `backlog-dir`, etc.) to inspect a repo from anywhere
