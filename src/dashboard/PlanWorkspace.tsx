/**
 * PlanWorkspace — two-pane workspace for a selected repo.
 *
 * Left: PlanListPane (scrollable plan list grouped by state).
 * Right: PlanDetailPane (tabs: summary, plan, progress, output).
 *
 * Focus model:
 *   Tab toggles focus between list and detail pane.
 *   When list is focused: ↑↓ moves plan cursor.
 *   When detail is focused: ↑↓/j/k scrolls content.
 *   Quick-jump keys (s/p/g/o) switch detail tab from either focus.
 *   Action keys (r/w/x) only fire when list is focused.
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { RepoSummary } from "../global-state.ts";
import type { PlanInfo, PaneFocus, DetailTab } from "./types.ts";
import {
  loadPlanContent,
  loadProgressContent,
  loadOutputTail,
} from "./data.ts";
import { PlanListPane } from "./PlanListPane.tsx";
import { PlanDetailPane } from "./PlanDetailPane.tsx";

interface PlanWorkspaceProps {
  repo: RepoSummary;
  plans: PlanInfo[];
  onBack: () => void;
  onQuit: () => void;
}

/** Height reserved for chrome (header, tab bar, footer, borders). */
const CHROME_ROWS = 10;

export function PlanWorkspace({
  repo,
  plans,
  onBack,
  onQuit,
}: PlanWorkspaceProps) {
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<PaneFocus>("list");
  const [tab, setTab] = useState<DetailTab>("summary");
  const [scrollOffset, setScrollOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const { stdout } = useStdout();
  const termRows = stdout?.rows ?? 24;
  const contentHeight = Math.max(5, termRows - CHROME_ROWS);

  // Reset scroll when tab or cursor changes
  useEffect(() => {
    setScrollOffset(0);
  }, [tab, cursor]);

  // Auto-follow output when on the output tab
  const selectedPlan = plans[cursor] ?? null;

  // Load content for the current tab
  const planContent =
    selectedPlan && repo.repoPath
      ? loadPlanContent(repo.repoPath, selectedPlan)
      : null;
  const progressContent =
    selectedPlan && repo.repoPath
      ? loadProgressContent(repo.repoPath, selectedPlan)
      : null;
  const outputData =
    selectedPlan && repo.repoPath
      ? loadOutputTail(repo.repoPath, selectedPlan)
      : null;

  const showMessage = useCallback((msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }, []);

  // Tab cycling
  const TABS: DetailTab[] = ["summary", "plan", "progress", "output"];
  const nextTab = useCallback(() => {
    setTab((prev) => {
      const idx = TABS.indexOf(prev);
      return TABS[(idx + 1) % TABS.length]!;
    });
  }, []);
  const prevTab = useCallback(() => {
    setTab((prev) => {
      const idx = TABS.indexOf(prev);
      return TABS[(idx - 1 + TABS.length) % TABS.length]!;
    });
  }, []);

  useInput((input, key) => {
    // Quit
    if (input === "q") {
      onQuit();
      return;
    }

    // Back to repo list
    if (key.escape) {
      if (focus === "detail") {
        setFocus("list");
        return;
      }
      onBack();
      return;
    }

    // Focus toggle
    if (key.tab) {
      if (key.shift) {
        setFocus((prev) => (prev === "list" ? "detail" : "list"));
      } else {
        setFocus((prev) => (prev === "list" ? "detail" : "list"));
      }
      return;
    }

    // Quick-jump tab keys (work from either focus)
    if (input === "s" && focus === "detail") {
      setTab("summary");
      return;
    }
    if (input === "p") {
      setTab("plan");
      if (focus === "list") setFocus("detail");
      return;
    }
    if (input === "g" && !(focus === "detail" && key.shift)) {
      setTab("progress");
      if (focus === "list") setFocus("detail");
      return;
    }
    if (input === "o") {
      setTab("output");
      if (focus === "list") setFocus("detail");
      return;
    }

    // Navigation depends on focus
    if (focus === "list") {
      // Plan list navigation
      if (key.upArrow || input === "k") {
        setCursor((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor((prev) => Math.min(plans.length - 1, prev + 1));
        return;
      }

      // Enter to focus detail pane
      if (key.return && selectedPlan) {
        setFocus("detail");
        return;
      }

      // Action keys (list focus only)
      if (!selectedPlan) return;
      if (!repo.repoPath || !repo.pathExists) {
        if (input === "r" || input === "w" || input === "x") {
          showMessage("Cannot act: repo path missing or stale");
        }
        return;
      }

      if (selectedPlan.state === "backlog") {
        if (input === "r") {
          showMessage(
            `Run: ralphai run --plan=${selectedPlan.slug} (from ${repo.repoPath})`,
          );
        } else if (input === "w") {
          showMessage(
            `Worktree: ralphai worktree --plan=${selectedPlan.slug} (from ${repo.repoPath})`,
          );
        }
      }

      if (selectedPlan.state === "in-progress") {
        if (input === "x") {
          showMessage(`Reset: ralphai reset (from ${repo.repoPath})`);
        }
      }
    } else {
      // Detail pane navigation — scroll content
      if (key.upArrow || input === "k") {
        setScrollOffset((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setScrollOffset((prev) => prev + 1);
        return;
      }

      // Page up/down
      if (key.pageUp) {
        setScrollOffset((prev) => Math.max(0, prev - contentHeight));
        return;
      }
      if (key.pageDown) {
        setScrollOffset((prev) => prev + contentHeight);
        return;
      }

      // Jump to top/bottom
      if (input === "G") {
        // Jump to bottom — set offset high, ContentView will clamp
        setScrollOffset(99999);
        return;
      }

      // Follow tail toggle for output
      if (input === "f" && tab === "output" && outputData) {
        setScrollOffset(
          Math.max(0, outputData.content.split("\n").length - contentHeight),
        );
        return;
      }

      // Summary tab quick-jump only works when detail is focused
      if (input === "s") {
        setTab("summary");
        return;
      }

      // Tab cycling with [ and ]
      if (input === "[") {
        prevTab();
        return;
      }
      if (input === "]") {
        nextTab();
        return;
      }
    }
  });

  // Focus indicator for footer hints
  const focusHints =
    focus === "list"
      ? "\u2191\u2193 navigate  tab \u2192 detail  esc back  q quit"
      : "\u2191\u2193/jk scroll  tab \u2192 list  [/] switch tab  f tail  esc \u2192 list";

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box>
        <Text bold>{repo.id}</Text>
        <Text dimColor>
          {"  "}
          {repo.repoPath ?? "(unknown path)"}
        </Text>
      </Box>

      {/* Message bar */}
      {message && (
        <Box>
          <Text color="cyan">{message}</Text>
        </Box>
      )}

      {/* Two-pane workspace */}
      <Box marginTop={1}>
        <PlanListPane
          plans={plans}
          cursor={cursor}
          focused={focus === "list"}
        />
        <PlanDetailPane
          plan={selectedPlan}
          tab={tab}
          focused={focus === "detail"}
          scrollOffset={scrollOffset}
          planContent={planContent}
          progressContent={progressContent}
          outputData={outputData}
          contentHeight={contentHeight}
        />
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>{focusHints}</Text>
      </Box>
    </Box>
  );
}
