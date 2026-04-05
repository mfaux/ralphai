/**
 * Run confirmation screen for the TUI.
 *
 * Displays plan/issue title, PRD context (if applicable), agent command,
 * branch name, and feedback commands. The user can:
 * - Enter to confirm and launch the run
 * - Esc to go back to the previous screen
 * - `o` to open the run-with-options wizard (placeholder transition)
 *
 * This screen is the gate between selecting what to run and actually
 * running it. When the user confirms, the TUI exits and returns the
 * run args to the CLI layer.
 */

import React from "react";
import { Box, Text, useInput } from "ink";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** PRD context for a plan that belongs to a PRD. */
export interface PrdContext {
  /** PRD parent title (e.g., "Auth Redesign"). */
  prdTitle: string;
  /** PRD issue number. */
  prdNumber: number;
  /** Position text (e.g., "1 of 3 remaining"). */
  position: string;
}

/** All data needed to render the confirmation screen. */
export interface ConfirmScreenData {
  /** Plan/issue title (e.g., "feat: add login endpoint"). */
  title: string;
  /** Branch name (e.g., "ralphai/gh-42-add-login-endpoint"). */
  branch: string;
  /** Agent command (e.g., "claude -p"). */
  agentCommand: string;
  /** Feedback commands (e.g., "bun run build,bun test"). */
  feedbackCommands: string;
  /** PRD context if this plan belongs to a PRD. */
  prdContext?: PrdContext;
  /** Run args to pass to the CLI when confirmed (e.g., ["run", "42"]). */
  runArgs: string[];
}

export interface ConfirmScreenProps {
  /** Data to display on the confirmation screen. */
  data: ConfirmScreenData;
  /** Called when the user presses Enter to confirm the run. */
  onConfirm: (args: string[]) => void;
  /** Called when the user presses Esc to go back. */
  onBack: () => void;
  /** Called when the user presses `o` to open the run-with-options wizard. */
  onOptions: (args: string[]) => void;
  /** Whether this component is actively receiving input. */
  isActive?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Format feedback commands for display.
 *
 * Splits a comma-separated string into individual commands and
 * returns them as an array. Returns an empty array if the input
 * is empty or undefined.
 */
export function formatFeedbackCommands(feedbackCommands: string): string[] {
  if (!feedbackCommands) return [];
  return feedbackCommands
    .split(",")
    .map((cmd) => cmd.trim())
    .filter(Boolean);
}

/**
 * Build the PRD position text for display.
 *
 * @param remaining - Number of remaining open sub-issues (including this one)
 * @param total - Total number of sub-issues
 * @returns Position string like "1 of 3 remaining" or "2 of 5 remaining"
 */
export function buildPrdPositionText(remaining: number, total: number): string {
  return `${remaining} of ${total} remaining`;
}

/**
 * Extract the plan title from a plan file's markdown content.
 *
 * Looks for the first `# ` heading after the frontmatter block.
 * Returns the heading text, or the slug as fallback.
 */
export function extractPlanTitle(content: string, fallback: string): string {
  // Skip frontmatter
  let body = content;
  if (content.startsWith("---\n")) {
    const endIdx = content.indexOf("\n---", 4);
    if (endIdx !== -1) {
      body = content.slice(endIdx + 4);
    }
  }

  // Find first H1 heading
  const match = body.match(/^\s*#\s+(.+)$/m);
  if (match) {
    return match[1]!.trim();
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmScreen({
  data,
  onConfirm,
  onBack,
  onOptions,
  isActive = true,
}: ConfirmScreenProps): React.ReactNode {
  useInput(
    (input, key) => {
      if (key.return) {
        onConfirm(data.runArgs);
      } else if (key.escape) {
        onBack();
      } else if (input === "o") {
        onOptions(data.runArgs);
      }
    },
    { isActive },
  );

  const feedbackList = formatFeedbackCommands(data.feedbackCommands);

  return (
    <Box flexDirection="column" paddingTop={1}>
      {/* Title */}
      <Text bold>Run: {data.title}</Text>

      {/* PRD context */}
      {data.prdContext && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>
            PRD: #{data.prdContext.prdNumber} {data.prdContext.prdTitle}
          </Text>
          <Text dimColor> {data.prdContext.position}</Text>
        </Box>
      )}

      {/* Details */}
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text dimColor>Branch: </Text>
          <Text>{data.branch}</Text>
        </Text>
        <Text>
          <Text dimColor>Agent: </Text>
          <Text>{data.agentCommand || "(not configured)"}</Text>
        </Text>
        {feedbackList.length > 0 && (
          <Box flexDirection="column">
            <Text>
              <Text dimColor>Feedback:</Text>
            </Text>
            {feedbackList.map((cmd, i) => (
              <Text key={i}>
                <Text dimColor>
                  {" "}
                  {i === feedbackList.length - 1 ? "\u2514" : "\u251C"}{" "}
                </Text>
                <Text>{cmd}</Text>
              </Text>
            ))}
          </Box>
        )}
        {feedbackList.length === 0 && (
          <Text>
            <Text dimColor>Feedback: </Text>
            <Text>(none)</Text>
          </Text>
        )}
      </Box>

      {/* Key hints */}
      <Box marginTop={1}>
        <Text dimColor>
          Enter to run {"\u00b7"} Esc to go back {"\u00b7"} o for options
        </Text>
      </Box>
    </Box>
  );
}
