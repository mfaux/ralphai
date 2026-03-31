import { describe, it, expect } from "bun:test";
import { extractPrSummary } from "./pr-summary.ts";

describe("extractPrSummary", () => {
  it("extracts content between pr-summary tags", () => {
    const output =
      "some agent output\n<pr-summary>\nAdd authentication with JWT tokens.\n</pr-summary>\nmore output";
    expect(extractPrSummary(output)).toBe(
      "Add authentication with JWT tokens.",
    );
  });

  it("returns null when no pr-summary tags present", () => {
    expect(extractPrSummary("just regular agent output")).toBeNull();
  });

  it("returns null when only opening tag present", () => {
    expect(extractPrSummary("<pr-summary>content without end")).toBeNull();
  });

  it("returns null when content between tags is empty", () => {
    expect(extractPrSummary("<pr-summary></pr-summary>")).toBeNull();
  });

  it("returns null when content is only whitespace", () => {
    expect(extractPrSummary("<pr-summary>   \n  </pr-summary>")).toBeNull();
  });

  it("trims whitespace from extracted content", () => {
    const output = "<pr-summary>\n  Implement rate limiting.  \n</pr-summary>";
    expect(extractPrSummary(output)).toBe("Implement rate limiting.");
  });

  it("extracts multi-line summaries", () => {
    const output = [
      "<pr-summary>",
      "Add a complete metrics dashboard with real-time tracking,",
      "CSV/JSON export, and per-user breakdown views.",
      "</pr-summary>",
    ].join("\n");
    expect(extractPrSummary(output)).toBe(
      "Add a complete metrics dashboard with real-time tracking,\nCSV/JSON export, and per-user breakdown views.",
    );
  });

  it("extracts only the first pr-summary block", () => {
    const output = [
      "<pr-summary>First summary.</pr-summary>",
      "<pr-summary>Second summary.</pr-summary>",
    ].join("\n");
    expect(extractPrSummary(output)).toBe("First summary.");
  });

  it("works alongside other structured blocks", () => {
    const output = [
      "<progress>",
      "- [x] Add login endpoint",
      "</progress>",
      "<pr-summary>Implement user authentication with bcrypt.</pr-summary>",
      "<learnings>",
      "<entry>",
      "status: none",
      "</entry>",
      "</learnings>",
    ].join("\n");
    expect(extractPrSummary(output)).toBe(
      "Implement user authentication with bcrypt.",
    );
  });
});
