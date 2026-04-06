/**
 * GitHub issue picker screen for the TUI.
 *
 * Full-screen list of GitHub issues using the `SelectableList` component.
 * PRD issues appear as selectable parents with indented sub-issue context
 * lines that are skipped by cursor navigation. Regular (non-PRD) issues
 * appear as flat selectable items below PRD groups.
 *
 * Data source: `listGithubIssues()` from `src/interactive/github-issues.ts`.
 *
 * Pure helpers are exported for unit testing:
 * - `buildIssuePickerItems` — PRD tree rendering with connectors/annotations
 * - `issuePickerSelect` — maps a selected value to a DispatchResult
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Box, Text } from "ink";

import type {
  ListItem,
  ItemRenderProps,
} from "../components/selectable-list.tsx";
import { SelectableList } from "../components/selectable-list.tsx";
import type { DispatchResult } from "../types.ts";
import type {
  GithubIssueListItem,
  ListGithubIssuesOptions,
  ListGithubIssuesResult,
} from "../../interactive/github-issues.ts";
import { listGithubIssues } from "../../interactive/github-issues.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IssuePickerScreenProps {
  /** Options for fetching the issue list. */
  listOptions: ListGithubIssuesOptions;
  /** Called when the user selects an issue or navigates back. */
  onResult: (result: DispatchResult) => void;
  /** Whether keyboard input is active. @default true */
  isActive?: boolean;
  /**
   * Injected fetch function for testing. Defaults to the real
   * `listGithubIssues` — override in tests to avoid network calls.
   */
  fetchIssues?: (options: ListGithubIssuesOptions) => ListGithubIssuesResult;
}

/** Sentinel prefix for sub-issue context rows. */
const CTX_PREFIX = "__ctx__:";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert GitHub issues into a flat `ListItem[]` for the `SelectableList`.
 *
 * PRD issues render as selectable parents with indented sub-issue context
 * lines beneath them. Context lines use tree connectors (├/└) and the first
 * open sub-issue is annotated with "(next up)". The PRD hint shows
 * "N remaining".
 *
 * Regular (non-PRD) issues appear as flat selectable items below PRD groups.
 *
 * Non-selectable context rows are marked `disabled: true` so the cursor
 * skips them during navigation.
 */
export function buildIssuePickerItems(
  issues: GithubIssueListItem[],
): ListItem[] {
  const items: ListItem[] = [];

  for (const issue of issues) {
    if (issue.isPrd) {
      // PRD parent — selectable
      const remaining = issue.subIssues.length;
      const hint = remaining > 0 ? `${remaining} remaining` : "no sub-issues";
      items.push({
        value: String(issue.number),
        label: `#${issue.number} ${issue.title} [PRD]`,
        hint,
      });

      // Build a title lookup from subIssueDetails
      const titleByNumber = new Map(
        issue.subIssueDetails.map((si) => [si.number, si.title]),
      );

      // Sub-issue context lines — non-selectable
      for (let i = 0; i < issue.subIssues.length; i++) {
        const subNum = issue.subIssues[i]!;
        const subTitle = titleByNumber.get(subNum) ?? "";
        const isLast = i === issue.subIssues.length - 1;
        const connector = isLast ? "\u2514" : "\u251C";
        const titleSuffix = subTitle ? ` ${subTitle}` : "";
        const nextUp = i === 0 ? "  (next up)" : "";
        items.push({
          value: `${CTX_PREFIX}${subNum}`,
          label: `  ${connector} #${subNum}${titleSuffix}${nextUp}`,
          disabled: true,
        });
      }
    } else {
      // Regular issue — selectable
      items.push({
        value: String(issue.number),
        label: `#${issue.number} ${issue.title}`,
      });
    }
  }

  return items;
}

/**
 * Map a selected issue picker value to a `DispatchResult`.
 *
 * - Numeric issue value → `exit-to-runner` with `["run", issueNumber]`
 * - Context row values (prefixed with `__ctx__:`) → ignored (returns null)
 * - Invalid values → ignored (returns null)
 */
export function issuePickerSelect(value: string): DispatchResult | null {
  // Context rows should never be selected (they're disabled), but guard anyway
  if (value.startsWith(CTX_PREFIX)) return null;

  const issueNumber = parseInt(value, 10);
  if (isNaN(issueNumber)) return null;

  return { type: "exit-to-runner", args: ["run", String(issueNumber)] };
}

// ---------------------------------------------------------------------------
// Fetch state machine
// ---------------------------------------------------------------------------

type FetchPhase = "loading" | "success" | "error" | "empty";

interface FetchState {
  phase: FetchPhase;
  issues: GithubIssueListItem[];
  error: string | undefined;
}

const INITIAL_STATE: FetchState = {
  phase: "loading",
  issues: [],
  error: undefined,
};

// ---------------------------------------------------------------------------
// Custom item renderer
// ---------------------------------------------------------------------------

function IssueListItem({
  item,
  isCursor,
  isDisabled,
}: {
  item: ListItem;
  isCursor: boolean;
  isDisabled: boolean;
}) {
  const cursor = isCursor ? "❯ " : "  ";
  const labelColor = isDisabled ? "gray" : isCursor ? "cyan" : undefined;

  return (
    <Box>
      <Text color={isCursor ? "cyan" : undefined}>{cursor}</Text>
      <Text color={labelColor} dimColor={isDisabled}>
        {item.label}
      </Text>
      {item.hint ? <Text dimColor> {item.hint}</Text> : null}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// IssuePickerScreen component
// ---------------------------------------------------------------------------

export function IssuePickerScreen({
  listOptions,
  onResult,
  isActive = true,
  fetchIssues,
}: IssuePickerScreenProps) {
  const [state, setState] = useState<FetchState>(INITIAL_STATE);

  // Keep a ref to the latest options for the async callback
  const optsRef = useRef({ listOptions, fetchIssues });
  optsRef.current = { listOptions, fetchIssues };

  // Fetch issues on mount
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const { listOptions: opts, fetchIssues: fetch } = optsRef.current;
        const result = fetch ? fetch(opts) : listGithubIssues(opts);

        if (!result.ok) {
          setState({ phase: "error", issues: [], error: result.error });
          return;
        }

        if (result.issues.length === 0) {
          setState({ phase: "empty", issues: [], error: undefined });
          return;
        }

        setState({ phase: "success", issues: result.issues, error: undefined });
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error fetching GitHub issues";
        setState({ phase: "error", issues: [], error: message });
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- runs once on mount

  const handleBack = useCallback(() => {
    onResult({ type: "navigate", screen: { type: "menu" } });
  }, [onResult]);

  // Build list items from fetched issues
  const listItems = useMemo(() => {
    if (state.phase !== "success") return [];
    return buildIssuePickerItems(state.issues);
  }, [state.phase, state.issues]);

  const handleSelect = useCallback(
    (value: string) => {
      const result = issuePickerSelect(value);
      if (result) onResult(result);
    },
    [onResult],
  );

  const renderItem = useCallback(
    (item: ListItem, props: ItemRenderProps) => (
      <IssueListItem
        item={item}
        isCursor={props.isCursor}
        isDisabled={props.isDisabled}
      />
    ),
    [],
  );

  // --- Loading state ---
  if (state.phase === "loading") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>Loading GitHub issues...</Text>
      </Box>
    );
  }

  // --- Error state ---
  if (state.phase === "error") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text color="red">Error loading issues:</Text>
        <Text dimColor>{state.error}</Text>
        <Box marginTop={1}>
          <SelectableList
            items={[{ value: "__back__", label: "Back" }]}
            onSelect={handleBack}
            onBack={handleBack}
            isActive={isActive}
          />
        </Box>
      </Box>
    );
  }

  // --- Empty state ---
  if (state.phase === "empty") {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>No matching issues found</Text>
        <Box marginTop={1}>
          <SelectableList
            items={[{ value: "__back__", label: "Back" }]}
            onSelect={handleBack}
            onBack={handleBack}
            isActive={isActive}
          />
        </Box>
      </Box>
    );
  }

  // --- Success state: full issue list ---
  return (
    <Box flexDirection="column">
      <Box paddingLeft={1} marginBottom={1}>
        <Text bold>Pick a GitHub issue to run</Text>
        <Text dimColor> ({state.issues.length} available)</Text>
      </Box>
      <SelectableList
        items={listItems}
        onSelect={handleSelect}
        onBack={handleBack}
        isActive={isActive}
        renderItem={renderItem}
      />
    </Box>
  );
}
