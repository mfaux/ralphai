/**
 * App -- master layout for the dashboard.
 *
 * Two layout modes:
 *
 * 1. **Default** (no detail or narrow terminal):
 *    RepoBar -> FilterBar (conditional) -> PlanList (full width) -> StatusBar
 *
 * 2. **Split pane** (detail open, termCols >= 80):
 *    RepoBar (full width) -> [PlanList (~30%) | DetailOverlay (~70%)] -> StatusBar
 *    RepoBar stays visible; plan list narrows but remains interactive.
 *
 * Falls back to a full-screen overlay for detail when termCols < 80.
 *
 * Overlays: ActionMenu, ConfirmDialog, HelpOverlay, RepoSelector.
 * State management lives in app-state.ts, keyboard routing in keyboard.ts.
 * This file is responsible only for layout and rendering.
 */

import React from "react";
import { Box, Text, useApp, useStdout } from "ink";
import { useAppState, CHROME_ROWS } from "./app-state.ts";
import { useKeyboardRouting } from "./keyboard.ts";
import { RepoBar } from "./RepoBar.tsx";
import { RepoSelector } from "./RepoSelector.tsx";
import { PlanList } from "./PlanList.tsx";
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

  const state = useAppState(termRows, termCols);
  useKeyboardRouting(state, exit);

  const {
    focus,
    repos,
    selectedRepo,
    selectedRepoIdx,
    displayPlans,
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
    isSplitMode,
    splitListWidth,
    splitDetailWidth,
    splitContentHeight,
  } = state;

  const dropdownOpen = overlay.kind === "repoSelect";

  // Plan list gets all vertical space not used by chrome
  const filterRows = filterActive || filterQuery ? 1 : 0;
  const planListHeight = Math.max(4, termRows - CHROME_ROWS - filterRows);

  return (
    <Box flexDirection="column" height={termRows}>
      {/* Repo bar (persistent, always visible) */}
      <RepoBar
        repos={repos}
        selectedRepo={selectedRepo}
        dropdownOpen={dropdownOpen}
        active={focus === "repo"}
        width={termCols}
      />

      {/* Filter bar (conditional) */}
      {(filterActive || filterQuery) && (
        <FilterBar query={filterQuery} resultCount={displayPlans.length} />
      )}

      {/* Main content area: split pane or full-width list */}
      {isSplitMode && selectedPlan ? (
        <Box flexDirection="row">
          <PlanList
            plans={displayPlans}
            cursor={planCursor}
            active={focus === "list"}
            width={splitListWidth}
            height={planListHeight}
          />
          <DetailOverlay
            plan={selectedPlan}
            tab={activeTab}
            scrollOffset={scrollOffset}
            planContent={planContent}
            progressContent={progressContent}
            outputData={outputData}
            contentHeight={splitContentHeight}
            followTail={followTail}
            width={splitDetailWidth}
            height={planListHeight}
            active={focus === "detail"}
          />
        </Box>
      ) : (
        <PlanList
          plans={displayPlans}
          cursor={planCursor}
          active={focus === "list"}
          width={termCols}
          height={planListHeight}
        />
      )}

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
        planCount={plans.length}
        selectedPlan={selectedPlan}
        hasActiveRunners={plans.some((p) => p.state === "in-progress")}
        splitOpen={isSplitMode}
        activeTab={activeTab}
      />

      {/* --- Overlays --- */}

      {/* Detail overlay (full-screen fallback for narrow terminals) */}
      {showDetail && !isSplitMode && selectedPlan && (
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
      {showDetail && !isSplitMode && selectedPlan && (
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

      {/* Repo selector dropdown (anchored below RepoBar) */}
      {dropdownOpen && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          flexDirection="column"
        >
          {/* Opaque backdrop to prevent bleed-through from content below */}
          {Array.from({ length: termRows }, (_, i) => (
            <Text key={i}>{" ".repeat(termCols)}</Text>
          ))}
        </Box>
      )}
      {dropdownOpen && (
        <Box position="absolute" marginTop={3} marginLeft={1}>
          <RepoSelector
            repos={repos}
            cursor={overlay.cursor}
            selectedIndex={selectedRepoIdx}
          />
        </Box>
      )}

      {/* Action menu / confirm / help overlays (centered) */}
      {(overlay.kind === "menu" ||
        overlay.kind === "confirm" ||
        overlay.kind === "help") && (
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
