import { describe, it, expect } from "vitest";
import { truncateSlug } from "./format.ts";

describe("truncateSlug", () => {
  it("returns slug unchanged when shorter than maxLen", () => {
    expect(truncateSlug("add-auth", 20)).toBe("add-auth");
  });

  it("returns slug unchanged when exactly maxLen", () => {
    expect(truncateSlug("add-auth", 8)).toBe("add-auth");
  });

  it("truncates at last dash boundary when slug is longer", () => {
    // "refactor-auth-middleware" is 23 chars, maxLen 15
    // truncatable = "refactor-auth-m", lastDash at 13 ("refactor-auth")
    expect(truncateSlug("refactor-auth-middleware", 15)).toBe(
      "refactor-auth\u2026",
    );
  });

  it("truncates at an earlier dash boundary when needed", () => {
    // "add-user-dashboard-feature" with maxLen 12
    // truncatable = "add-user-das", lastDash at 8 ("add-user")
    expect(truncateSlug("add-user-dashboard-feature", 12)).toBe(
      "add-user\u2026",
    );
  });

  it("hard-truncates when no dash in truncatable portion", () => {
    // "superlongword" has no dashes, maxLen 8
    expect(truncateSlug("superlongword", 8)).toBe("superlo\u2026");
  });

  it("handles single-character maxLen gracefully", () => {
    expect(truncateSlug("abc", 1)).toBe("\u2026");
  });

  it("handles slug with leading dash", () => {
    // "-leading-dash" with maxLen 5
    // truncatable = "-lead", lastDash at 0 — but lastDash > 0 is false, so hard-truncate
    expect(truncateSlug("-leading-dash", 5)).toBe("-lea\u2026");
  });
});
