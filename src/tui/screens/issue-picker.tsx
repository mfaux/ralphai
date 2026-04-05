/**
 * Issue picker screen for the TUI.
 *
 * Full-screen list of GitHub issues using the SelectableList component.
 * PRD issues appear as selectable parents with indented, non-selectable
 * sub-issue context lines. Regular issues appear as flat selectable items.
 *
 * Data is fetched via `listGithubIssues()` and transformed through
 * `buildGithubPickList()` into the list format, then mapped to
 * `ListItem[]` for the `SelectableList` component.
 */

import React, { useState, useEffect, useRef } from "react";
import { Box, Text } from "ink";
import {
  listGithubIssues,
  buildGithubPickList,
  type ListGithubIssuesOptions,
  type PickListItem,
} from "../../interactive/github-issues.ts";
import {
  SelectableList,
  type ListItem,
} from "../components/selectable-list.tsx";

// ---------------------------------------------------------------------------
// Pure data transformation (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert `PickListItem[]` from `buildGithubPickList()` into `ListItem[]`
 * for the `SelectableList` component.
 *
 * - Context rows (`__ctx__:*`) become disabled items (skipped by cursor)
 * - The `__back__` item is excluded (Esc handles back in the TUI)
 * - All other items are selectable
 */
export function pickListToListItems(pickList: PickListItem[]): ListItem[] {
  return pickList
    .filter((item) => item.value !== "__back__")
    .map((item) => ({
      value: item.value,
      label: item.label,
      hint: item.hint,
      disabled: item.value.startsWith("__ctx__:"),
    }));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssuePickerProps {
  /** Options for fetching GitHub issues. */
  listOptions: ListGithubIssuesOptions;
  /**
   * Called when the user selects an issue.
   * Receives the run args to navigate to the confirmation screen.
   * - Regular issue: `["run", issueNumber]`
   * - PRD issue: `["run", prdNumber]`
   */
  onSelect: (args: string[]) => void;
  /** Called when the user presses Esc to go back. */
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

type LoadState =
  | { tag: "loading" }
  | { tag: "error"; message: string }
  | { tag: "empty"; repo: string }
  | { tag: "ready"; items: ListItem[]; issueCount: number };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IssuePicker({
  listOptions,
  onSelect,
  onBack,
}: IssuePickerProps): React.ReactNode {
  const [loadState, setLoadState] = useState<LoadState>({ tag: "loading" });
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Run synchronous API calls in a microtask to avoid blocking render
    void Promise.resolve().then(() => {
      const result = listGithubIssues(listOptions);

      if (cancelled || !mountedRef.current) return;

      if (!result.ok) {
        setLoadState({ tag: "error", message: result.error });
        return;
      }

      if (result.issues.length === 0) {
        setLoadState({ tag: "empty", repo: result.repo });
        return;
      }

      const pickList = buildGithubPickList(result.issues);
      const items = pickListToListItems(pickList);
      setLoadState({
        tag: "ready",
        items,
        issueCount: result.issues.length,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [listOptions]);

  const handleSelect = (value: string) => {
    // Context rows should never reach here (disabled), but guard anyway
    if (value.startsWith("__ctx__:")) return;

    const issueNumber = parseInt(value, 10);
    if (isNaN(issueNumber)) return;

    onSelect(["run", String(issueNumber)]);
  };

  // --- Loading ---
  if (loadState.tag === "loading") {
    return (
      <Box flexDirection="column">
        <Text>Loading GitHub issues...</Text>
      </Box>
    );
  }

  // --- Error ---
  if (loadState.tag === "error") {
    return (
      <Box flexDirection="column">
        <Text color="red">{loadState.message}</Text>
        <Text dimColor>Press Esc to go back</Text>
        <SelectableList
          items={[{ value: "__back__", label: "Back" }]}
          onSelect={onBack}
          onBack={onBack}
        />
      </Box>
    );
  }

  // --- Empty ---
  if (loadState.tag === "empty") {
    return (
      <Box flexDirection="column">
        <Text>No matching issues found in {loadState.repo}.</Text>
        <Text dimColor>Press Esc to go back</Text>
        <SelectableList
          items={[{ value: "__back__", label: "Back" }]}
          onSelect={onBack}
          onBack={onBack}
        />
      </Box>
    );
  }

  // --- Ready ---
  return (
    <Box flexDirection="column">
      <Text bold>Pick a GitHub issue ({loadState.issueCount} available)</Text>
      <SelectableList
        items={loadState.items}
        onSelect={handleSelect}
        onBack={onBack}
      />
    </Box>
  );
}
