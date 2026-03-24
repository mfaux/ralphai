/**
 * App — master layout for the lazygit-style dashboard.
 *
 * Three stacked panels on the left (Repos, Pipeline, Worktrees), a tabbed
 * detail pane on the right, and a status bar at the bottom. Overlays for
 * actions, confirmation, filter, and help.
 *
 * State management lives in app-state.ts, keyboard routing in keyboard.ts.
 * This file is responsible only for layout and rendering.
 */

import React from "react";
import { Box, Text, useApp, useStdout } from "ink";
import { useAppState, CHROME_ROWS } from "./app-state.ts";
import { useKeyboardRouting } from "./keyboard.ts";
import { ReposPanel } from "./ReposPanel.tsx";
import { PipelinePanel } from "./PipelinePanel.tsx";
import { WorktreesPanel } from "./WorktreesPanel.tsx";
import { DetailPane } from "./DetailPane.tsx";
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
    panelNav,
    activePanel,
    focus,
    repos,
    selectedRepo,
    displayPlans,
    worktrees,
    selectedPlan,
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

  const { getCursor } = panelNav;

  // --- Left panel width ---
  const leftWidth = Math.max(
    20,
    Math.min(Math.floor(termCols * 0.3), Math.floor(termCols * 0.4)),
  );

  // --- Left panels share vertical space. Pipeline gets most room. ---
  const availableRows = termRows - CHROME_ROWS;
  const reposHeight = Math.max(
    2,
    Math.min(repos.length + 1, Math.floor(availableRows * 0.2)),
  );
  const worktreesHeight = Math.max(
    2,
    Math.min(worktrees.length + 1, Math.floor(availableRows * 0.2)),
  );
  const pipelineHeight = Math.max(
    4,
    availableRows - reposHeight - worktreesHeight,
  );

  return (
    <Box flexDirection="column" height={termRows}>
      <Box flexDirection="row" flexGrow={1}>
        {/* Left column: three stacked panels */}
        <Box flexDirection="column" width={leftWidth}>
          <ReposPanel
            repos={repos}
            cursor={getCursor("repos")}
            active={focus === "panel" && activePanel === "repos"}
            width={leftWidth}
            height={reposHeight}
            collapsed={
              focus === "panel" && activePanel !== "repos" && repos.length > 3
            }
          />
          {(filterActive || filterQuery) && (
            <FilterBar query={filterQuery} resultCount={displayPlans.length} />
          )}
          <PipelinePanel
            plans={displayPlans}
            cursor={getCursor("pipeline")}
            active={focus === "panel" && activePanel === "pipeline"}
            width={leftWidth}
            height={pipelineHeight}
            repoName={selectedRepo?.id}
            collapsed={
              focus === "panel" &&
              activePanel !== "pipeline" &&
              displayPlans.length > 5
            }
          />
          <WorktreesPanel
            worktrees={worktrees}
            cursor={getCursor("worktrees")}
            active={focus === "panel" && activePanel === "worktrees"}
            width={leftWidth}
            height={worktreesHeight}
            collapsed={
              focus === "panel" &&
              activePanel !== "worktrees" &&
              worktrees.length > 3
            }
          />
        </Box>

        {/* Right column: detail pane */}
        <DetailPane
          plan={selectedPlan}
          tab={activeTab}
          focused={focus === "detail"}
          scrollOffset={scrollOffset}
          planContent={planContent}
          progressContent={progressContent}
          outputData={outputData}
          contentHeight={contentHeight}
          followTail={followTail}
        />
      </Box>

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
      />

      {/* Overlays — rendered inside a full-screen backdrop to prevent
          text bleed-through from the panels behind. */}
      {overlay.kind !== "none" && (
        <Box
          position="absolute"
          width={termCols}
          height={termRows}
          flexDirection="column"
        >
          {/* Opaque backdrop: fill every row with spaces */}
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
