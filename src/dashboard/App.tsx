/**
 * App — master layout for the dashboard (Option B: list + overlay).
 *
 * Single-column layout:
 *   RepoBar (1 row) -> FilterBar (conditional) -> PlanList (fills space)
 *   -> WorktreeStrip (1 row) -> StatusBar (1 row)
 *
 * Overlays: DetailOverlay, ActionMenu, ConfirmDialog, HelpOverlay.
 *
 * State management lives in app-state.ts, keyboard routing in keyboard.ts.
 * This file is responsible only for layout and rendering.
 */

import React from "react";
import { Box, Text, useApp, useStdout } from "ink";
import { useAppState, CHROME_ROWS } from "./app-state.ts";
import { useKeyboardRouting } from "./keyboard.ts";
import { RepoBar } from "./RepoBar.tsx";
import { PlanList } from "./PlanList.tsx";
import { WorktreeStrip } from "./WorktreeStrip.tsx";
import { DetailOverlay } from "./DetailOverlay.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { ActionMenu } from "./ActionMenu.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FilterBar } from "./FilterBar.tsx";
import { HelpOverlay } from "./HelpOverlay.tsx";

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const termCols = stdout?.columns ?? 80;
  const termRows = stdout?.rows ?? 24;

  const state = useAppState(termRows);
  useKeyboardRouting(state, exit);

  const {
    focus,
    repos,
    selectedRepo,
    selectedRepoIdx,
    displayPlans,
    worktrees,
    selectedPlan,
    planCursor,
    showDetail,
    activeTab,
    scrollOffset,
    followTail,
    planContent,
    progressContent,
    outputData,
    contentHeight,
    overlay,
    toast,
    filterQuery,
    filterActive,
    plans,
  } = state;

  // Plan list gets all vertical space not used by chrome
  const filterRows = filterActive || filterQuery ? 1 : 0;
  const planListHeight = Math.max(4, termRows - CHROME_ROWS - filterRows);

  return (
    <Box flexDirection="column" height={termRows}>
      {/* Repo tab bar */}
      <RepoBar repos={repos} selectedIndex={selectedRepoIdx} width={termCols} />

      {/* Filter bar (conditional) */}
      {(filterActive || filterQuery) && (
        <FilterBar query={filterQuery} resultCount={displayPlans.length} />
      )}

      {/* Full-width plan list */}
      <PlanList
        plans={displayPlans}
        cursor={planCursor}
        active={focus === "list"}
        width={termCols}
        height={planListHeight}
        repoName={selectedRepo?.id}
      />

      {/* Compact worktree strip */}
      <WorktreeStrip worktrees={worktrees} width={termCols} />

      {/* Status bar */}
      <StatusBar
        focus={
          overlay.kind !== "none"
            ? overlay.kind === "help"
              ? "help"
              : "menu"
            : focus
        }
        toast={toast}
        repoName={selectedRepo?.id ?? null}
        planCount={plans.length}
        selectedPlan={selectedPlan}
        hasActiveRunners={plans.some((p) => p.state === "in-progress")}
      />

      {/* --- Overlays --- */}

      {/* Detail overlay (full-screen, shown on Enter) */}
      {showDetail && selectedPlan && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          flexDirection="column"
        >
          {/* Opaque backdrop */}
          {Array.from({ length: termRows }, (_, i) => (
            <Text key={i}>{" ".repeat(termCols)}</Text>
          ))}
        </Box>
      )}
      {showDetail && selectedPlan && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          alignItems="center"
          justifyContent="center"
        >
          <DetailOverlay
            plan={selectedPlan}
            tab={activeTab}
            scrollOffset={scrollOffset}
            planContent={planContent}
            progressContent={progressContent}
            outputData={outputData}
            contentHeight={contentHeight}
            followTail={followTail}
            width={Math.min(termCols, termCols - 2)}
            height={termRows - 2}
          />
        </Box>
      )}

      {/* Action menu / confirm / help overlays */}
      {overlay.kind !== "none" && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          flexDirection="column"
        >
          {Array.from({ length: termRows }, (_, i) => (
            <Text key={i}>{" ".repeat(termCols)}</Text>
          ))}
        </Box>
      )}

      {overlay.kind === "menu" && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          alignItems="center"
          justifyContent="center"
        >
          <ActionMenu
            items={overlay.items}
            cursor={overlay.cursor}
            title={overlay.title}
          />
        </Box>
      )}

      {overlay.kind === "confirm" && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          alignItems="center"
          justifyContent="center"
        >
          <ConfirmDialog action={overlay.action} slug={overlay.slug} />
        </Box>
      )}

      {overlay.kind === "help" && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          alignItems="center"
          justifyContent="center"
        >
          <HelpOverlay />
        </Box>
      )}
    </Box>
  );
}
