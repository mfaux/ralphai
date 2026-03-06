# ralphai

Put your AI coding agent on autopilot.

Ralphai takes plan files from a backlog and drives any CLI-based coding agent to implement them, with branch isolation, feedback loops, and stuck detection built in. You write the plans (or have your agent write them). Ralphai does the rest.

## Why Ralphai?

AI coding agents get worse the longer they run. Every model can only "see" a limited amount of text at once (its context window). As the conversation grows, the model quietly drops or summarizes older messages. It forgets what it already tried, repeats mistakes, or contradicts earlier work. [More on this →](docs/HOW-RALPHAI-WORKS.md#context-rot)

Ralphai avoids this by starting each iteration with a **fresh session**: just the plan, current repo state, and build/test/lint results. No conversation history to lose, no drift.

- **No context rot** — iteration 50 is as sharp as iteration 1
- **Grounded feedback** — real build errors every cycle, not stale memory
- **Stuck detection** — stops burning tokens when progress stalls
- **Unattended** — write plans, walk away

## Get Started

In your project directory:

```bash
npx ralphai init
```

Ralphai scaffolds a `.ralphai/` directory into your project, detects your package manager and build scripts, and you're ready to go.

> Use `npx ralphai init --yes` to skip prompts and accept defaults.

After init completes:

1. **Commit the `.ralphai/` folder to git.** The shell scripts and config are
   designed to be shared — your `package.json` now has a `"ralphai"` script that
   points to `.ralphai/ralphai.sh`, so the folder must be tracked for the script
   to work.

2. **Review the `package.json` change.** Init adds a `"ralphai"` script to your
   `package.json`:
   ```json
   "scripts": {
     "ralphai": ".ralphai/ralphai.sh"
   }
   ```
   This lets you (and your team) run ralphai with your package manager
   (e.g. `pnpm ralphai`, `npm run ralphai`) instead of invoking the shell script
   directly.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in `.ralphai/pipeline/backlog/`. Point it at `.ralphai/PLANNING.md` for structure and examples, or roll your own format. Ralphai just needs markdown files with clear acceptance criteria.

```
Create a plan in the ralphai backlog for adding dark mode support.
Use PLANNING.md as a guide.
```

### 2. Run

```bash
npx ralphai run
```

If you've committed the `.ralphai/` folder (see above), you can also use the package script — e.g. `pnpm ralphai`, `npm run ralphai`, or `yarn ralphai`.

Ralphai picks a plan from the backlog, creates a `ralphai/*` branch, hands the plan to your agent, and loops: build, test, lint after every iteration. When a plan is done, it pushes the branch and opens a pull request. Defaults to 5 iterations per plan (e.g. `npx ralphai run -- 3` for 3). If a plan isn't finished, it stays in `pipeline/in-progress/` on the branch — just run again to resume.

### 3. Steer

Plans flow through three directories: `backlog/ → in-progress/ → out/`. Not ready for Ralphai to pick something up? Park it in `wip/` — Ralphai ignores that folder.

```
pipeline/backlog/       ← queued, ralphai picks from here
pipeline/in-progress/   ← ralphai is working on it
pipeline/out/           ← done, archived
pipeline/wip/           ← parked, ralphai ignores
```

### 4. Pause and resume

Stop mid-run any time. Work stays in `in-progress/` on the `ralphai/*` branch. Resume with `npx ralphai run` (auto-detects in-progress work). Preview what Ralphai would do without touching anything: `./.ralphai/ralphai.sh --dry-run`.

### 5. Close the learnings loop

Ralphai logs mistakes to `.ralphai/LEARNINGS.md` (gitignored) during runs. After a run, review those entries and promote durable lessons to `LEARNINGS.md` (tracked) or `AGENTS.md`. [How the learnings system works →](docs/HOW-RALPHAI-WORKS.md#learnings-system)

## How `ralphai` Works

- **Branch isolation** — every plan runs on a `ralphai/<plan-name>` branch, never on main
- **Feedback loops** — build, test, and lint run after each iteration (auto-detected or configured)
- **Stuck detection** — if N iterations produce no commits, Ralphai aborts (default: 3)
- **Auto-PR** — creates a branch and opens a PR via `gh` by default; use `--direct` to commit on your current branch instead
- **Plan dependencies** — plans can declare `depends-on` for ordering across a backlog
- **GitHub Issues** — Ralphai can pull labeled issues when the backlog is empty

See [How ralphai Works](docs/HOW-RALPHAI-WORKS.md) for the full picture.

## Docs

After `ralphai init`, the good stuff lives in `.ralphai/`:

- [`.ralphai/README.md`](.ralphai/README.md) — full operational docs (lifecycle, scripts, config)
- [`.ralphai/PLANNING.md`](.ralphai/PLANNING.md) — guide for writing plan files (give this to your agent)
- `LEARNINGS.md` (repo root) — curated long-term findings; compacted/promoted from `.ralphai/LEARNINGS.md`

## Supported Agents

Works with any CLI agent that accepts a prompt argument:

<details>
<summary>Agent commands</summary>

| Agent       | Command                          |
| ----------- | -------------------------------- |
| OpenCode    | `opencode run --agent build`     |
| Claude Code | `claude -p`                      |
| Codex       | `codex exec`                     |
| Gemini CLI  | `gemini -p`                      |
| Aider       | `aider --message`                |
| Goose       | `goose run -t`                   |
| Kiro        | `kiro-cli chat --no-interactive` |
| Amp         | `amp -x`                         |

</details>

## CLI Reference

<details>
<summary>Commands and options</summary>

```
ralphai <command> [options]

Commands:
  init        Set up Ralphai in your project
  run         Start the Ralphai task runner
  update      Refresh template files (preserves config & state)
  uninstall   Remove Ralphai from your project

Options:
  --help, -h     Show help
  --version, -v  Show version

Init:
  --yes, -y              Skip prompts, use defaults
  --force                Re-scaffold from scratch
  --agent-command=CMD    Set the agent command

Run:
  Runs with sensible defaults (5 iterations per plan). Use -- to override
  (e.g. -- 5 for 5 iterations, -- --dry-run for preview).
  In initialized repos, ./.ralphai/ralphai.sh is also available for direct invocation.
```

</details>

## Configuration

Settings resolve in this order: **CLI flags > env vars > `.ralphai/ralphai.config` > defaults**.

<details>
<summary>Environment variables</summary>

| Env Var                           | Config Key             |
| --------------------------------- | ---------------------- |
| `RALPHAI_AGENT_COMMAND`           | `agentCommand`         |
| `RALPHAI_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPHAI_BASE_BRANCH`             | `baseBranch`           |
| `RALPHAI_MODE`                    | `mode`                 |
| `RALPHAI_PROMPT_MODE`             | `promptMode`           |
| `RALPHAI_MAX_STUCK`               | `maxStuck`             |
| `RALPHAI_ITERATION_TIMEOUT`       | `iterationTimeout`     |
| `RALPHAI_ISSUE_SOURCE`            | `issueSource`          |
| `RALPHAI_ISSUE_LABEL`             | `issueLabel`           |
| `RALPHAI_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPHAI_ISSUE_REPO`              | `issueRepo`            |
| `RALPHAI_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPHAI_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

</details>

## Acknowledgements

- [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley — the technique behind the loop
- [Vercel CLI](https://github.com/vercel/vercel) — CLI DX inspiration

## License

MIT
