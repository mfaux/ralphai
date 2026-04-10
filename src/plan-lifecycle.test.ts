/**
 * Boundary tests for plan-lifecycle.ts facade.
 *
 * Verifies that every public function and type re-exported through the
 * facade is the same reference as the original module's export. This
 * catches missing or stale re-exports without duplicating the exhaustive
 * behavior tests that already exist in each module's own test file.
 */
import { describe, it, expect } from "bun:test";

// Import everything from the facade
import * as facade from "./plan-lifecycle.ts";

// Import originals from each underlying module
import * as planDetection from "./plan-detection.ts";
import * as frontmatter from "./frontmatter.ts";
import * as receipt from "./receipt.ts";
import * as globalState from "./global-state.ts";
import * as pipelineState from "./pipeline-state.ts";

// ---------------------------------------------------------------------------
// Verify every runtime export from each underlying module is re-exported
// through the facade as the same reference (catches missing, stale, or
// shadowed re-exports in a single loop).
// ---------------------------------------------------------------------------

const modules: [string, Record<string, unknown>][] = [
  ["plan-detection", planDetection],
  ["frontmatter", frontmatter],
  ["receipt", receipt],
  ["global-state", globalState],
  ["pipeline-state", pipelineState],
];

const facadeRecord = facade as Record<string, unknown>;

for (const [label, mod] of modules) {
  describe(`plan-lifecycle facade — ${label}`, () => {
    for (const key of Object.keys(mod)) {
      it(`re-exports ${key}`, () => {
        expect(facadeRecord[key]).toBe(mod[key]);
      });
    }
  });
}
