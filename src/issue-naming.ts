/**
 * Issue naming utilities — branch names, slugs, commit-type extraction.
 *
 * Facade that re-exports the pure naming functions from issues.ts.
 * Callers can import from here instead of reaching into issues.ts directly.
 * No logic moves yet — every function delegates to the existing implementation.
 */
export {
  slugify,
  commitTypeFromTitle,
  issueBranchName,
  prdBranchName,
  issueDepSlug,
} from "./issues.ts";
