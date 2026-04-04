import { describe, it, expect } from "bun:test";
import { deriveLabels } from "./labels.ts";

// ---------------------------------------------------------------------------
// deriveLabels — default names
// ---------------------------------------------------------------------------

describe("deriveLabels — default standalone name", () => {
  it("derives four labels from ralphai-standalone", () => {
    const labels = deriveLabels("ralphai-standalone");
    expect(labels).toEqual({
      intake: "ralphai-standalone",
      inProgress: "ralphai-standalone:in-progress",
      done: "ralphai-standalone:done",
      stuck: "ralphai-standalone:stuck",
    });
  });
});

describe("deriveLabels — default subissue name", () => {
  it("derives four labels from ralphai-subissue", () => {
    const labels = deriveLabels("ralphai-subissue");
    expect(labels).toEqual({
      intake: "ralphai-subissue",
      inProgress: "ralphai-subissue:in-progress",
      done: "ralphai-subissue:done",
      stuck: "ralphai-subissue:stuck",
    });
  });
});

describe("deriveLabels — default prd name", () => {
  it("derives four labels from ralphai-prd including :stuck", () => {
    const labels = deriveLabels("ralphai-prd");
    expect(labels).toEqual({
      intake: "ralphai-prd",
      inProgress: "ralphai-prd:in-progress",
      done: "ralphai-prd:done",
      stuck: "ralphai-prd:stuck",
    });
  });
});

// ---------------------------------------------------------------------------
// deriveLabels — custom names
// ---------------------------------------------------------------------------

describe("deriveLabels — custom base name", () => {
  it("works with arbitrary base names", () => {
    const labels = deriveLabels("my-team-label");
    expect(labels).toEqual({
      intake: "my-team-label",
      inProgress: "my-team-label:in-progress",
      done: "my-team-label:done",
      stuck: "my-team-label:stuck",
    });
  });

  it("handles base names with colons", () => {
    const labels = deriveLabels("org:task");
    expect(labels).toEqual({
      intake: "org:task",
      inProgress: "org:task:in-progress",
      done: "org:task:done",
      stuck: "org:task:stuck",
    });
  });

  it("handles single-word base name", () => {
    const labels = deriveLabels("review");
    expect(labels.intake).toBe("review");
    expect(labels.inProgress).toBe("review:in-progress");
    expect(labels.done).toBe("review:done");
    expect(labels.stuck).toBe("review:stuck");
  });
});

// ---------------------------------------------------------------------------
// deriveLabels — edge cases
// ---------------------------------------------------------------------------

describe("deriveLabels — edge cases", () => {
  it("handles empty base name", () => {
    const labels = deriveLabels("");
    expect(labels).toEqual({
      intake: "",
      inProgress: ":in-progress",
      done: ":done",
      stuck: ":stuck",
    });
  });

  it("handles base name with spaces", () => {
    const labels = deriveLabels("my label");
    expect(labels.intake).toBe("my label");
    expect(labels.inProgress).toBe("my label:in-progress");
  });

  it("handles base name with unicode", () => {
    const labels = deriveLabels("ralphai-\u2713");
    expect(labels.intake).toBe("ralphai-\u2713");
    expect(labels.done).toBe("ralphai-\u2713:done");
  });
});
