/**
 * App — root dashboard component. Manages screen navigation and auto-refresh.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useApp } from "ink";
import type { RepoSummary } from "../global-state.ts";
import type { DashboardScreen, PlanInfo } from "./types.ts";
import { loadRepos, loadPlans } from "./data.ts";
import { useAutoRefresh } from "./hooks.ts";
import { RepoList } from "./RepoList.tsx";
import { PlanList } from "./PlanList.tsx";

const REFRESH_INTERVAL_MS = 3000;

export function App() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<DashboardScreen>("repos");
  const [selectedRepo, setSelectedRepo] = useState<RepoSummary | null>(null);

  // Auto-refresh repos
  const repoLoader = useCallback(() => loadRepos(), []);
  const { data: repos } = useAutoRefresh(repoLoader, REFRESH_INTERVAL_MS);

  // Auto-refresh plans for selected repo
  const planLoader = useCallback(
    () => (selectedRepo?.repoPath ? loadPlans(selectedRepo.repoPath) : []),
    [selectedRepo],
  );
  const { data: plans } = useAutoRefresh<PlanInfo[]>(
    planLoader,
    REFRESH_INTERVAL_MS,
  );

  const handleSelectRepo = useCallback((repo: RepoSummary) => {
    setSelectedRepo(repo);
    setScreen("plans");
  }, []);

  const handleBack = useCallback(() => {
    setSelectedRepo(null);
    setScreen("repos");
  }, []);

  const handleQuit = useCallback(() => {
    exit();
  }, [exit]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>ralphai</Text>
        <Text dimColor>{" dashboard"}</Text>
      </Box>
      {screen === "repos" ? (
        <RepoList
          repos={repos}
          onSelect={handleSelectRepo}
          onQuit={handleQuit}
        />
      ) : selectedRepo ? (
        <PlanList
          repo={selectedRepo}
          plans={plans}
          onBack={handleBack}
          onQuit={handleQuit}
        />
      ) : null}
    </Box>
  );
}
