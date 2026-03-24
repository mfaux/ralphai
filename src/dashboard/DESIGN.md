# Dashboard Design Decisions

Architecture and rationale for the interactive dashboard (`src/dashboard/`).

## Layout: Lazygit-Style Multi-Panel

The dashboard uses a **three-panel left column** (Repos, Pipeline, Worktrees) with a **tabbed detail pane** on the right, inspired by lazygit's split-panel approach.

**Why not the original two-screen design?** The prior architecture (RepoList screen -> PlanWorkspace screen) had three usability problems:

1. **Flash on navigation.** Selecting a repo briefly showed "No plans in pipeline" before data loaded. The `useAutoRefresh` hook did not re-invoke its loader when dependencies changed.
2. **Actions were display-only.** The old dashboard showed command strings as toast messages but could not actually execute plans.
3. **No path to see progress.** Users had to leave the dashboard to check plan output.

The multi-panel layout keeps all context visible at once and allows drill-down without screen transitions.

The Pipeline panel header includes the selected repo name (e.g., `2 Pipeline (ralphai) ───`) so users always know which repo's plans they're viewing, even when the Repos panel is collapsed.

## Keyboard-Only Input

Ink 6.x has no mouse support (no `useMouse`, no mouse event parsing, no plugins). The dashboard is keyboard-only by design, not by limitation, though the limitation made the decision easy.

Key routing uses a **single `useInput` handler** (`keyboard.ts`) that dispatches based on `FocusTarget`:

- **panel** — arrow keys navigate items, Tab cycles panels, Enter opens action menu
- **detail** — arrow keys scroll, left/right switch tabs, `f` toggles follow-tail
- **menu** — arrow keys select, Enter triggers, Esc dismisses
- **filter** — typing appends to query, Esc closes

### Why arrow keys don't cross panel boundaries

Arrow keys navigate **within** the focused panel. They do not overflow into the next panel when the cursor hits the top or bottom. Reasons:

1. **Matches the lazygit model.** The reference UI uses Tab/number keys for panel switching and arrow keys for in-panel movement. Users of this style expect hard boundaries.
2. **Edge behavior is ambiguous.** If down-arrow at the bottom of Repos jumps to Pipeline, where should up-arrow at the top of Pipeline land? The last Repos item? The previously selected one? Both answers are surprising in some scenario.
3. **Each panel has independent cursor state.** Cursors are tracked per-panel in `cursorByPanel`. Overflow would conflate "moving within my list" with "switching context."
4. **Fast alternatives already exist.** Tab cycles in order, Shift+Tab goes backward, and 1/2/3 jump directly. Overflow would save one keystroke at best while adding cognitive load.

Left/right arrow overflow **does** make sense and is implemented: right-arrow or `l` moves from panel focus to the detail pane, and Esc goes back. This maps naturally to the spatial layout (left panels, right detail).

## File Organization: App Split

`App.tsx` was initially 664 lines after the rewrite. It was split into three files to respect the ~300-line source file limit:

- **`App.tsx`** — Layout and rendering only (189 lines). No state, no side effects.
- **`app-state.ts`** — `useAppState` hook (309 lines). All state management, data loading, action dispatch, overlay state machine.
- **`keyboard.ts`** — `useKeyboardRouting` hook (281 lines). Single `useInput` handler with focus-based routing.

The split follows the principle of **one responsibility per file**: rendering, state, and input handling are independent concerns that change for different reasons.

## Detached Process Spawning

`actions.ts` spawns runners as **detached, unref'd child processes** so the dashboard stays responsive and can exit without killing active runs. This matches how ralphai's CLI already works, where `ralphai worktree` spawns an agent in a worktree and returns immediately.

`resolveCliBin()` finds the CLI entry point in priority order: built dist (`dist/cli.mjs`), source (`src/cli.ts` with `--experimental-strip-types`), then `ralphai` in PATH.

## Worktree Removal

The `removeWorktree` function mirrors `cleanWorktrees()` in `ralphai.ts`:

1. `git worktree prune` to clean stale entries
2. `git worktree remove --force` because worktrees may have uncommitted agent work
3. `git branch -D` because ralphai branches are typically unmerged

The action menu only offers removal for **idle** worktrees (no active in-progress plan). Active worktrees are protected in the UI layer.

## Confirm Dialog for Destructive Actions

Reset, purge, and worktree removal all route through `ConfirmDialog` before executing. The overlay state machine enforces this: `handleAction` sets `overlay.kind = "confirm"`, and the actual side effect only runs in `handleConfirm` when the user presses `y`.

## Auto-Refresh and the Flash Bug Fix

`useAutoRefresh` polls data every 3 seconds. The original implementation did not re-invoke the loader when its identity changed (e.g., when the user selected a different repo), causing stale data to display briefly before the next poll. The fix adds a `useEffect` that calls `setData(loader())` immediately when the `loader` reference changes.

Four data sources use `useAutoRefresh`: repos, plans, progress content, and output content. Progress and output must poll because their files change continuously while a plan is in-progress, but the plan's slug and state (the only stable identifiers) stay the same. Using `useMemo` for these would show stale content until the plan completed. Plan file content uses `useMemo` since it rarely changes after creation.

## Filter System

The `/` key opens an inline filter bar above the Pipeline panel. Filters support three modes:

- **Plain text** — matches against the plan slug (case-insensitive)
- **`state:` prefix** — filters by plan state (`active`, `queued`, `done`, or literal values like `in-progress`)
- **`scope:` prefix** — filters by plan scope

Multiple prefixes combine with AND semantics. `filterPlans` is a pure function, tested in `hooks.test.ts`.

## Testing Strategy

The dashboard separates pure logic from React rendering. Tests focus on the **pure functions** where bugs actually occur:

- **`hooks.test.ts`** — `filterPlans` (15 tests covering text, state, scope, and combined filters)
- **`format.test.ts`** — `truncateSlug` (7 tests for edge cases)
- **`actions.test.ts`** — `removeWorktree`, `resetPlan`, `purgePlan`, `spawnRunner`, `spawnWorktreeRunner` (mocked filesystem and child_process)
- **`action-menu.test.ts`** — `buildMenuItems` (context-sensitive menu construction for all panel/state combinations)
- **`detail-pane.test.ts`** — `defaultTabForState` (tab selection per plan state)

No component render tests. The presentational components (`ReposPanel`, `PipelinePanel`, etc.) are thin wrappers that map data to styled text. Testing them would mean testing Ink's rendering, which is both fragile and low-value. `ink-testing-library` is intentionally not installed.

## Render Options

The launcher (`index.ts`) passes `patchConsole: false` to Ink's `render()`. The dashboard does not use `console.log`, and patching adds overhead that can interfere with spawned child processes. `waitUntilExit()` ensures a clean `process.exit(0)` after the app unmounts.

## Adaptive Layout

Left panel width: `Math.max(20, Math.min(floor(cols * 0.3), floor(cols * 0.4)))`. The three left panels share vertical space dynamically: repos and worktrees each take up to 20% of available rows (capped by item count), and pipeline gets the remainder. Panels collapse to a single header line when unfocused and have many items, keeping the layout compact.
