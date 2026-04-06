/**
 * Tests for the ExitIntercepted sentinel class.
 */

import { describe, it, expect } from "bun:test";
import { ExitIntercepted } from "./maintenance-actions.ts";

// ---------------------------------------------------------------------------
// ExitIntercepted sentinel
// ---------------------------------------------------------------------------

describe("ExitIntercepted", () => {
  it("is an Error subclass", () => {
    const err = new ExitIntercepted();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ExitIntercepted");
  });

  it("has a descriptive message", () => {
    const err = new ExitIntercepted();
    expect(err.message).toBe("process.exit intercepted");
  });
});
