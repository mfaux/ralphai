/**
 * Feedback scope detection from plan content.
 *
 * Parses the `## Relevant Files` markdown section, extracts file paths,
 * and computes the longest common parent directory. Pure function, no I/O.
 */
import { dirname } from "path";

/**
 * Extract file paths from a `## Relevant Files` markdown section.
 *
 * Recognizes list items like:
 *   - `src/foo/bar.ts`
 *   - `src/foo/bar.ts` — description text
 *   - `src/foo/bar.ts` - description text
 *
 * Returns an array of raw file path strings (no descriptions).
 */
export function extractRelevantFiles(planContent: string): string[] {
  // Find the ## Relevant Files section
  const sectionMatch = planContent.match(/^##\s+Relevant\s+Files\s*$/m);
  if (!sectionMatch) return [];

  // Get content after the heading until the next heading or end of file
  const startIdx = sectionMatch.index! + sectionMatch[0].length;
  const rest = planContent.slice(startIdx);

  // Stop at the next heading (any level) or end of string
  const nextHeadingMatch = rest.match(/^#{1,6}\s/m);
  const sectionContent = nextHeadingMatch
    ? rest.slice(0, nextHeadingMatch.index)
    : rest;

  const files: string[] = [];
  for (const line of sectionContent.split("\n")) {
    // Match list items: "- `path`" or "- path"
    const backtickMatch = line.match(/^\s*[-*]\s+`([^`]+)`/);
    if (backtickMatch) {
      files.push(backtickMatch[1]!.trim());
      continue;
    }

    // Match bare list items: "- path/to/file.ext" (must look like a file path)
    const bareMatch = line.match(/^\s*[-*]\s+(\S+\.\w+)/);
    if (bareMatch) {
      files.push(bareMatch[1]!.trim());
    }
  }

  return files;
}

/**
 * Compute the longest common parent directory for an array of file paths.
 *
 * Returns "" when paths span unrelated directories (no common parent
 * beyond the root) or when the input is empty.
 */
export function commonParentDir(paths: string[]): string {
  if (paths.length === 0) return "";

  const dirs = paths.map((p) => {
    const d = dirname(p);
    // dirname("file.ts") returns "." — treat that as root (no parent)
    return d === "." ? "" : d;
  });

  // If any file lives at the root, there's no meaningful common parent
  if (dirs.some((d) => d === "")) return "";

  // Split each directory path into segments
  const segmentsList = dirs.map((d) => d.split("/").filter(Boolean));

  // Find common prefix segments
  const first = segmentsList[0]!;
  let commonLength = 0;

  for (let i = 0; i < first.length; i++) {
    const segment = first[i];
    if (segmentsList.every((segs) => segs[i] === segment)) {
      commonLength = i + 1;
    } else {
      break;
    }
  }

  if (commonLength === 0) return "";
  return first.slice(0, commonLength).join("/");
}

/**
 * Detect the feedback scope from plan content by parsing the
 * `## Relevant Files` section and computing the common parent directory.
 *
 * @param planContent - Raw markdown content of the plan file.
 * @returns The common parent directory (e.g. `"src/foo"`) or `""` if
 *   no scope can be inferred.
 */
export function detectFeedbackScope(planContent: string): string {
  const files = extractRelevantFiles(planContent);
  return commonParentDir(files);
}
