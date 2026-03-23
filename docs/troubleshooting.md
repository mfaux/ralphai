# Troubleshooting

Common issues and how to resolve them.

## "My plan is stuck"

Ralphai aborts when it detects 3 consecutive turns with no new commits (configurable via `maxStuck`). The plan stays in `pipeline/in-progress/<slug>/` so you can resume after fixing the issue.

**Steps:**

1. Check `.ralphai/LEARNINGS.md` for repeated errors — if the agent logged the same mistake multiple times, the plan likely needs adjustment.
2. Open the progress file in `pipeline/in-progress/<slug>/progress.md` to see what the agent attempted and where it got stuck.
3. Edit the plan file in `pipeline/in-progress/<slug>/<slug>.md` — simplify the stuck task, add hints, or break it into smaller steps.
4. Resume: `ralphai run --resume`

The `--resume` flag auto-commits any dirty working tree state and continues from where the agent left off, preserving the existing progress file.

## "Agent keeps making the same mistake"

Add the mistake to `.ralphai/LEARNINGS.md` with a clear description of what went wrong, why, and how to avoid it. Ralphai includes this file in every prompt, so the agent will see it on the next turn.

```markdown
### 2025-01-15 — Describe the mistake briefly

**What went wrong:** The agent used `console.warn` for messages that tests needed to capture.

**Root cause:** `execFileSync` only returns stdout; stderr is discarded on success.

**Fix / Prevention:** Use `console.log` with a styled prefix for messages that need to appear in test output.
```

## "Build/test didn't run"

The agent is instructed to run feedback commands each turn, but the commands themselves come from your configuration.

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

## "Plan failed on first turn"

**Check:**

1. Run `ralphai status` to see pipeline state and any reported problems (orphaned receipts, missing worktrees).
2. Ensure the plan follows the format described in `.ralphai/PLANNING.md` — it needs a title, description, and implementation tasks.
3. Verify the agent CLI is installed and working: run your `agentCommand` manually (e.g., `claude --version` or `opencode --version`).
4. Run `ralphai doctor` for a full health check of your setup.

## "ralphai refuses to run on main"

This is by design. Ralphai creates feature branches (`ralphai/<slug>`) to isolate changes from your main branch.

**Options:**

- Switch to a feature branch: `git checkout -b my-feature`
- Let ralphai create one: `ralphai run` (in `branch` or `pr` mode, it auto-creates `ralphai/<slug>`)
- Use a worktree for parallel runs: `ralphai worktree`

The `--resume` flag also refuses to run on the base branch. Switch to the `ralphai/*` branch first.

## "Working tree is dirty" after init

Running `ralphai run` immediately after `ralphai init` may report a dirty working tree because init modifies `.gitignore` and optionally creates `AGENTS.md`. In an interactive terminal, Ralphai will prompt you to continue anyway.

**Options:**

- **Accept the prompt** when Ralphai asks "Continue anyway?"
- **Commit the init files first:** `git add .gitignore AGENTS.md && git commit -m "chore: configure ralphai"`
- **Skip the check explicitly:** `ralphai run --allow-dirty`
