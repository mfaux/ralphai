/**
 * Learnings parser and writer: extracts structured <learnings> blocks
 * from agent output and appends logged entries to LEARNINGS.md
 * (in global state: ~/.ralphai/repos/<id>/LEARNINGS.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LearningEntry {
  status: "logged" | "none";
  date?: string;
  title?: string;
  what?: string;
  rootCause?: string;
  prevention?: string;
}

export interface ProcessLearningsResult {
  /** What happened: "logged", "none", "no-block", "malformed", "unknown-status". */
  outcome: string;
  /** Human-readable status message. */
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEARNINGS_SEED = `# Ralphai Learnings

Mistakes and lessons learned during autonomous runs. This file is **gitignored** —
Ralphai reads and writes it automatically. Review periodically and promote useful
entries to \`AGENTS.md\` or skill docs when they have lasting value.

## Format

Each entry should include:

- **Date**: When the mistake was made
- **What went wrong**: Brief description of the error
- **Root cause**: Why it happened
- **Fix / Prevention**: How to avoid it in the future

---

<!-- Entries are added automatically by Ralphai during autonomous runs -->
`;

const CANDIDATES_SEED = `# Ralphai Learning Candidates

Potential durable lessons for human review and possible promotion into AGENTS.md or skill docs.

## Format

- Date
- Proposed rule
- Why it matters
- Suggested destination

---

<!-- Append new candidate entries below -->
`;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Extract the first `<learnings>...</learnings>` block from agent output.
 * Returns the content between the tags, or null if not found.
 */
export function extractLearningsBlock(text: string): string | null {
  const startTag = "<learnings>";
  const endTag = "</learnings>";

  const startIdx = text.indexOf(startTag);
  if (startIdx === -1) return null;

  const endIdx = text.indexOf(endTag, startIdx);
  if (endIdx === -1) return null;

  const content = text.slice(startIdx + startTag.length, endIdx).trim();
  return content.length > 0 ? content : null;
}

/**
 * Parse structured fields from a learnings block (the content between
 * `<learnings>` tags). Extracts the first `<entry>...</entry>` and parses
 * key-value fields.
 *
 * Returns null if parsing fails (no `<entry>` tag or missing required
 * fields).
 */
export function parseLearningsEntry(block: string): LearningEntry | null {
  const entryStart = block.indexOf("<entry>");
  const entryEnd = block.indexOf("</entry>");
  if (entryStart === -1 || entryEnd === -1) return null;

  const entry = block.slice(entryStart + "<entry>".length, entryEnd).trim();
  if (entry.length === 0) return null;

  const lines = entry.split("\n");

  // Parse key-value pairs from lines like "key: value"
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)/);
    if (match && match[1] !== undefined && match[2] !== undefined) {
      fields[match[1]] = match[2].trim();
    }
  }

  const status = fields.status;
  if (!status) return null;

  if (status === "none") {
    return { status: "none" };
  }

  if (status === "logged") {
    const date = fields.date;
    const title = fields.title;
    const what = fields.what;
    const rootCause = fields.root_cause;
    const prevention = fields.prevention;

    // All fields required for logged entries
    if (!date || !title || !what || !rootCause || !prevention) {
      return null;
    }

    return { status: "logged", date, title, what, rootCause, prevention };
  }

  // Unknown status — return null to signal parse failure
  return null;
}

/**
 * Append a formatted Markdown entry to the learnings file.
 * Creates the file with a seed header if it doesn't exist.
 */
export function appendLearningEntry(
  filePath: string,
  entry: LearningEntry,
): void {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, LEARNINGS_SEED, "utf-8");
  }

  const block = [
    "",
    `### ${entry.date} — ${entry.title}`,
    "",
    `**What went wrong:** ${entry.what}`,
    "",
    `**Root cause:** ${entry.rootCause}`,
    "",
    `**Fix / Prevention:** ${entry.prevention}`,
    "",
  ].join("\n");

  const existing = readFileSync(filePath, "utf-8");
  writeFileSync(filePath, existing + block, "utf-8");
}

/**
 * Create LEARNING_CANDIDATES.md with a seed header if it
 * doesn't already exist.
 */
export function seedLearningCandidatesFile(filePath: string): void {
  if (existsSync(filePath)) return;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, CANDIDATES_SEED, "utf-8");
}

/**
 * Prune the learnings file to keep only the most recent `maxEntries`
 * entries. Entries are delimited by `### ` headings. The file header
 * (everything before the first entry) is always preserved.
 *
 * No-op if the file doesn't exist or has fewer entries than the limit.
 */
export function pruneLearningsFile(
  filePath: string,
  maxEntries: number = 20,
): void {
  if (!existsSync(filePath) || maxEntries <= 0) return;

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Find all entry heading positions (lines starting with "### ")
  const entryPositions: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined && line.startsWith("### ")) {
      entryPositions.push(i);
    }
  }

  if (entryPositions.length <= maxEntries) return;

  // Header = everything before the first entry heading
  const headerEnd = entryPositions[0];
  const header = lines.slice(0, headerEnd).join("\n");

  // Keep only the last maxEntries entries
  const keepFrom = entryPositions.length - maxEntries;
  const keptStart = entryPositions[keepFrom];
  const kept = lines.slice(keptStart).join("\n");

  writeFileSync(filePath, header + kept + "\n", "utf-8");
}

/**
 * Process the learnings block from agent output. Extracts, parses, and
 * appends if status is "logged". Seeds the candidates file.
 *
 * Returns a result describing what happened.
 */
export function processLearnings(
  agentOutput: string,
  learningsFilePath: string,
  candidatesFilePath: string,
  maxLearnings: number = 20,
): ProcessLearningsResult {
  // Ensure candidates file exists for agent to append to
  seedLearningCandidatesFile(candidatesFilePath);

  const block = extractLearningsBlock(agentOutput);
  if (block === null) {
    return {
      outcome: "no-block",
      message: "WARNING: No <learnings> block found in agent output.",
    };
  }

  const entry = parseLearningsEntry(block);
  if (entry === null) {
    return {
      outcome: "malformed",
      message:
        "WARNING: Malformed <learnings> block — could not parse entry fields.",
    };
  }

  if (entry.status === "none") {
    return {
      outcome: "none",
      message: "No learning logged this task.",
    };
  }

  if (entry.status === "logged") {
    appendLearningEntry(learningsFilePath, entry);
    pruneLearningsFile(learningsFilePath, maxLearnings);
    return {
      outcome: "logged",
      message: `Logged learning: ${entry.title}`,
    };
  }

  return {
    outcome: "unknown-status",
    message: `WARNING: Unknown learnings status: ${entry.status}`,
  };
}
