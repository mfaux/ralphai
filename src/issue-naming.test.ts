/**
 * Tests for issue naming utilities — branch names, slugs, commit-type
 * extraction. All functions here are pure (no I/O), so no mocking is needed.
 */
import { describe, expect, it } from "bun:test";
import {
  slugify,
  commitTypeFromTitle,
  issueBranchName,
  issueDepSlug,
} from "./issue-lifecycle.ts";

describe("issue naming", () => {
  describe("slugify", () => {
    it("lowercases and replaces non-alphanumeric chars", () => {
      expect(slugify("Hello World!")).toBe("hello-world");
    });

    it("trims leading/trailing hyphens", () => {
      expect(slugify("--hello--")).toBe("hello");
    });

    it("truncates to 60 chars", () => {
      const long = "a".repeat(80);
      expect(slugify(long).length).toBe(60);
    });
  });

  describe("commitTypeFromTitle", () => {
    it("extracts fix type", () => {
      const r = commitTypeFromTitle("fix: broken login");
      expect(r).toEqual({ type: "fix", description: "broken login" });
    });

    it("extracts refactor type", () => {
      const r = commitTypeFromTitle("refactor(core): split module");
      expect(r).toEqual({ type: "refactor", description: "split module" });
    });

    it("defaults to feat for plain title", () => {
      const r = commitTypeFromTitle("Add dark mode");
      expect(r).toEqual({ type: "feat", description: "Add dark mode" });
    });

    it("strips PRD: prefix", () => {
      const r = commitTypeFromTitle("PRD: Add dark mode");
      expect(r).toEqual({ type: "feat", description: "Add dark mode" });
    });
  });

  describe("issueBranchName", () => {
    it("produces type/slug format", () => {
      expect(issueBranchName("fix: broken login")).toBe("fix/broken-login");
    });

    it("defaults to feat/ for plain title", () => {
      expect(issueBranchName("Add tests")).toBe("feat/add-tests");
    });

    it("uses branchPrefix when non-empty", () => {
      expect(
        issueBranchName("fix: broken login", { branchPrefix: "ralphai/" }),
      ).toBe("ralphai/broken-login");
    });

    it("uses branchPrefix 'auto/' for plain title", () => {
      expect(issueBranchName("Add dark mode", { branchPrefix: "auto/" })).toBe(
        "auto/add-dark-mode",
      );
    });

    it("empty branchPrefix + conventional preserves type/slug", () => {
      expect(
        issueBranchName("fix: broken login", {
          branchPrefix: "",
          commitStyle: "conventional",
        }),
      ).toBe("fix/broken-login");
    });

    it("empty branchPrefix + commitStyle=none produces slug only", () => {
      expect(
        issueBranchName("Add dark mode", {
          branchPrefix: "",
          commitStyle: "none",
        }),
      ).toBe("add-dark-mode");
    });

    it("empty branchPrefix + commitStyle=none with CC title strips type", () => {
      expect(
        issueBranchName("fix: broken login", {
          branchPrefix: "",
          commitStyle: "none",
        }),
      ).toBe("broken-login");
    });

    it("branchPrefix takes precedence over commitStyle", () => {
      expect(
        issueBranchName("fix: broken login", {
          branchPrefix: "ralphai/",
          commitStyle: "none",
        }),
      ).toBe("ralphai/broken-login");
    });
  });

  describe("issueDepSlug", () => {
    it("generates gh-N format", () => {
      expect(issueDepSlug(42)).toBe("gh-42");
    });

    it("handles single-digit numbers", () => {
      expect(issueDepSlug(1)).toBe("gh-1");
    });
  });
});
