# Dashboard Design Decisions

Architecture and rationale for the interactive dashboard (`src/dashboard/`).

## Layout: Lazygit-Style Multi-Panel

The dashboard uses a **two-pane layout** (RepoBar + Pipeline) with a **tabbed detail overlay**, inspired by lazygit's split-panel approach.

**Why not the original two-screen design?** The prior architecture (RepoList screen -> PlanWorkspace screen) had three usability problems:

1. **Flash on navigation.** Selecting a repo briefly showed "No plans in pipeline" before data loaded. The `useAutoRefresh` hook did not re-invoke its loader when dependencies changed.
2. **Actions were display-only.** The old dashboard showed command strings as toast messages but could not actually execute plans.
3. **No path to see progress.** Users had to leave the dashboard to check plan output.

The multi-panel layout keeps all context visible at once and allows drill-down without screen transitions.

A persistent `RepoBar` at the top of the screen always shows the currently selected repo with a dropdown indicator (`▾`) and plan counts. When no repos are registered, it displays an empty-state hint: "No repos · run `ralphai add <path>` to get started." When the RepoBar is focused, `↑`/`↓` directly cycles through repos and `Enter` opens an inline `RepoSelector` dropdown anchored directly below the RepoBar, providing a natural dropdown feel. The dropdown shows all repos with cursor navigation, an active-repo marker, and per-repo plan counts.

## Keyboard-Only Input

Ink 6.x has no mouse support (no `useMouse`, no mouse event parsing, no plugins). The dashboard is keyboard-only by design, not by limitation, though the limitation made the decision easy.

Key routing uses a **single `useInput` handler** (`keyboard.ts`) that dispatches based on `FocusTarget`:

- **repo** — arrow keys cycle repos, Enter opens dropdown, number keys / Tab switch panes
- **list** — arrow keys navigate plans, Enter opens detail, `a` opens action menu
- **detail** — arrow keys scroll, left/right switch tabs, `l` toggles live-scroll
- **menu** — arrow keys select, Enter triggers, Esc dismisses
- **filter** — typing appends to query, Esc closes

## Pane Navigation

The dashboard uses a **lazygit-style pane model** where number keys and Tab provide fast focus switching between panes:

| Key         | Action                                    |
| ----------- | ----------------------------------------- |
| `1`         | Focus RepoBar                             |
| `2`         | Focus Pipeline                            |
| `3`         | Focus Detail (opens split if not already) |
| `Tab`       | Cycle focus to next pane                  |
| `Shift+Tab` | Cycle focus to previous pane              |

The `PANE_ORDER` array in `types.ts` defines the canonical order: `["repo", "list", "detail"]`. Number keys map directly to array indices. Tab/Shift+Tab wrap around using modular arithmetic. When the detail pane is not open, `cyclePane` filters it out so Tab skips directly between repo and list.

When **RepoBar is focused**, `↑`/`↓` directly cycle through registered repos without opening the dropdown, providing fast switching. `Enter` opens the full dropdown for an overview of all repos with plan counts.

When **Pipeline is focused**, `↑`/`↓` navigate the plan list and `Enter` opens the detail split (or action menu if detail is already open).

When **Detail is focused**, `↑`/`↓` scroll content, `←`/`→` switch tabs, and letter shortcuts (`s`/`p`/`g`/`o`) jump directly to a tab.

This replaces the prior `Space`-to-open-repo-selector approach with a more consistent, discoverable navigation model.

### Worktree Visibility

Worktree information is shown **inline on plan rows** rather than in a separate panel or strip. Plans that were run in a worktree display a `[worktree]` badge next to their slug in the Pipeline list. This applies to both in-progress plans (where the worktree is actively in use) and completed plans (where the worktree may still need cleanup).

**Why not a separate worktree strip or panel?** An earlier design used a `WorktreeStrip` component that rendered a compact single-line list of worktrees between the Pipeline and StatusBar. This had two problems: it was non-interactive (no cursor, no focus, no actions), and it silently clipped entries on narrow terminals. Showing worktree info on the plan row itself surfaces the information in context, next to the plan it belongs to, and the detail overlay already shows the full `worktreePath` for plans with worktrees.

### Why arrow keys don't cross panel boundaries

Arrow keys navigate **within** the focused panel. They do not overflow into the next panel when the cursor hits the top or bottom. Reasons:

1. **Matches the lazygit model.** The reference UI uses Tab/number keys for panel switching and arrow keys for in-panel movement. Users of this style expect hard boundaries.
2. **Edge behavior is ambiguous.** If down-arrow at the bottom of Repos jumps to Pipeline, where should up-arrow at the top of Pipeline land? The last Repos item? The previously selected one? Both answers are surprising in some scenario.
3. **Each panel has independent cursor state.** Cursors are tracked per-panel in `cursorByPanel`. Overflow would conflate "moving within my list" with "switching context."
4. **Fast alternatives already exist.** Tab cycles in order, Shift+Tab goes backward, and 1/2/3 jump directly. Overflow would save one keystroke at best while adding cognitive load.

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

## Split Pane Detail

When the user presses Enter on a plan (or `3` from any pane) and the terminal is at least 80 columns wide, the layout switches from a single full-width plan list to a side-by-side split:

```
┌─────────────── RepoBar (full width) ───────────────┐
├── 2 PlanList (~30%) ──┬── 3 Detail (~70%) ─────────┤
│ ACTIVE (2)            │ 3 feat/auth-flow  ✓ done   │
│ ➤ ◌ feat/auth-flow   │ Summary | Plan | ...       │
│   ◌ fix/null-check    │                            │
│ QUEUED (1)            │ State       ✓ done         │
│   ○ refactor/types    │ Scope       backend        │
│ DONE (3)              │ Branch      ralphai/...    │
│   ✓ feat/export       │                            │
├───────────────────────┴────────────────────────────┤
│ ↑↓ navigate · 3 detail · a actions · Esc close     │
└────────────────────────────────────────────────────┘
```

**Width allocation.** The plan list gets `Math.max(20, floor(termCols * 0.3))`, the detail pane gets the remainder. The plan list's `maxSlugLen` recalculates automatically from its narrower width, truncating slugs as needed. Scope and worktree badges hide below 40 columns (existing responsive guards).

**Focus model.** The detail pane is pane `3` in the `PANE_ORDER`, navigable via the `3` key, Tab, and Shift+Tab, just like the other panes. When the split opens (via Enter or `3`), focus stays on the plan list. Navigating plans with `↑`/`↓` updates the detail pane reactively. Pressing `3` or Tab moves focus to the detail pane for scrolling and tab switching. `2` or Shift+Tab returns focus to the list. `Esc` from the detail pane returns to the list; `Esc` from the list closes the split entirely. When the split is closed, Tab and `cyclePane` skip the detail pane automatically.

**Border highlighting.** Both panels use rounded borders. The focused panel gets a cyan border; the unfocused panel gets a dim gray border. This provides a clear visual indicator of which panel owns keyboard input.

**Narrow terminal fallback.** When `termCols < 80`, Enter opens the original full-screen overlay with an opaque backdrop, preserving usability on small screens. The `SPLIT_MIN_COLS` constant in `app-state.ts` controls the threshold.

**State model.** The split introduces a new valid combination: `focus === "list" && showDetail === true`. Previously these were mutually exclusive. `isSplitMode` is a derived boolean (`showDetail && termCols >= SPLIT_MIN_COLS`) that controls which layout path renders.
