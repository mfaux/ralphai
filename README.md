# ralphai

Put your AI coding agent on autopilot.

Ralph takes plan files from a backlog and drives any CLI-based coding agent to implement them — with branch isolation, feedback loops, and stuck detection baked in. You write the plans (or have your agent write them). Ralph does the rest.

## Why Ralph?

AI coding agents get worse the longer they run. Every model can only "see" a limited amount of text at once (its context window). As the conversation grows, the model quietly drops or summarizes older messages — so it forgets what it already tried, repeats mistakes, or contradicts earlier work. [More on this →](docs/HOW-IT-WORKS.md#context-rot)

Ralph avoids this by starting each iteration with a **fresh session** — just the plan, current repo state, and build/test/lint results. No conversation history to lose, no drift.

- **No context rot** — iteration 50 is as sharp as iteration 1
- **Grounded feedback** — real build errors every cycle, not stale memory
- **Stuck detection** — stops burning tokens when progress stalls
- **Unattended** — write plans, walk away

## Get Started

```bash
npx ralphai init
```

That's it. Ralph scaffolds a `.ralph/` directory into your project, detects your package manager and build scripts, and you're ready to go.

> Use `npx ralphai init --yes` to skip prompts and accept defaults.

## Workflow

### 1. Write plans

Ask your coding agent to create plan files in `.ralph/backlog/`. Point it at `.ralph/WRITING-PLANS.md` for structure and examples, or roll your own format — Ralph just needs markdown files with clear acceptance criteria.

```
Create a plan in .ralph/backlog/ for adding dark mode support.
Use .ralph/WRITING-PLANS.md as a guide.
```

### 2. Get ralph cooking

```bash
npx ralphai run
```

Ralph uses sensible defaults out of the box. In initialized repos, you can also invoke `./.ralph/ralph.sh` directly, passing args like iteration count (`10`) or flags (`--resume`, `--dry-run`).

Ralph picks the best plan from the backlog, creates a `ralph/*` branch, hands the plan to your agent, and loops — build, test, lint after every iteration. When a plan is done, it archives the work, merges or opens a PR, and moves on to the next one.

### 3. Steer

Not ready for Ralph to pick something up? Keep it in `.ralph/drafts/`. Ralph never looks there. Move it to `backlog/` when you're ready.

```
drafts/     ← parked, ralph ignores these
backlog/    ← queued, ralph picks from here
in-progress/← ralph is working on it
out/        ← done, archived
```

### 4. Take a break

If you need to stop mid-run, just kill it. Your work stays in `in-progress/` on the `ralph/*` branch. Pick up where you left off:

```bash
npx ralphai run
```

Ralph auto-resumes from where you left off. You can also pass `--resume` explicitly to `./.ralph/ralph.sh`.

### 5. Preview before committing

Not sure what Ralph will do? Dry-run it:

```bash
./.ralph/ralph.sh --dry-run
```

Shows which plan would be picked, whether it would resume or start fresh, and what the merge target is — without touching anything.

### 6. Close the learnings loop

Ralph’s virtuous cycle includes a two-tier learnings flow:

- `.ralph/LEARNINGS.md` (gitignored) — Ralph logs mistakes and lessons during runs.
- `LEARNINGS.md` (repo root, tracked) — you curate durable learnings Ralph should always consider.

After runs, weigh in on findings: review `.ralph/LEARNINGS.md`, compact duplicate/noisy entries into concise takeaways, and promote durable patterns:

- **Agent instructions (e.g. `AGENTS.md`)** for immediate repo-specific behavior guidance
- **Skills / reusable docs** for stable patterns worth reusing across tasks or repos

Keep this lightweight: summarize what matters, drop one-off noise, and preserve only lessons with lasting value.

## How `ralphai` Works

- **Branch isolation** — every plan runs on a `ralph/<plan-name>` branch, never on main
- **Feedback loops** — build, test, and lint run after each iteration (auto-detected or configured)
- **Stuck detection** — if N iterations produce no commits, Ralph aborts (default: 3)
- **Auto-PR** — protected branches get a PR via `gh`; unprotected branches merge directly
- **Plan dependencies** — plans can declare `depends-on` for ordering across a backlog
- **GitHub Issues** — Ralph can pull labeled issues when the backlog is empty

## Supported Agents

Works with any CLI agent that accepts a prompt argument:

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

## Docs

After `ralphai init`, the good stuff lives in `.ralph/`:

- [`.ralph/README.md`](.ralph/README.md) — full operational docs (lifecycle, scripts, config)
- [`.ralph/WRITING-PLANS.md`](.ralph/WRITING-PLANS.md) — guide for writing plan files (give this to your agent)
- `LEARNINGS.md` (repo root) — curated long-term findings; compacted/promoted from `.ralph/LEARNINGS.md`

## CLI Reference

```
ralphai <command> [options]

Commands:
  init        Set up Ralph in your project
  run         Start the Ralph task runner
  update      Refresh template files (preserves config & state)
  uninstall   Remove Ralph from your project

Options:
  --help, -h     Show help
  --version, -v  Show version

Init:
  --yes, -y              Skip prompts, use defaults
  --force                Re-scaffold from scratch
  --agent-command=CMD    Set the agent command

Run:
  Runs with sensible defaults (10 iterations per plan). Use -- to override
  (e.g. -- 5 for 5 iterations, -- --dry-run for preview).
  In initialized repos, ./.ralph/ralph.sh is also available for direct invocation.
```

## Configuration

Settings resolve in this order: **CLI flags > env vars > `.ralph/ralph.config` > defaults**.

<details>
<summary>Environment variables</summary>

| Env Var                         | Config Key             |
| ------------------------------- | ---------------------- |
| `RALPH_AGENT_COMMAND`           | `agentCommand`         |
| `RALPH_FEEDBACK_COMMANDS`       | `feedbackCommands`     |
| `RALPH_BASE_BRANCH`             | `baseBranch`           |
| `RALPH_MERGE_TARGET`            | `mergeTarget`          |
| `RALPH_PROTECTED_BRANCHES`      | `protectedBranches`    |
| `RALPH_MAX_STUCK`               | `maxStuck`             |
| `RALPH_ITERATION_TIMEOUT`       | `iterationTimeout`     |
| `RALPH_ISSUE_SOURCE`            | `issueSource`          |
| `RALPH_ISSUE_LABEL`             | `issueLabel`           |
| `RALPH_ISSUE_IN_PROGRESS_LABEL` | `issueInProgressLabel` |
| `RALPH_ISSUE_REPO`              | `issueRepo`            |
| `RALPH_ISSUE_CLOSE_ON_COMPLETE` | `issueCloseOnComplete` |
| `RALPH_ISSUE_COMMENT_PROGRESS`  | `issueCommentProgress` |

</details>

## Acknowledgements

Inspired by [Ralph](https://ghuntley.com/ralph/) by Geoffrey Huntley.

## License

MIT
