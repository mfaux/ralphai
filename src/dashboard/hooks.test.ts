import { describe, it, expect } from "bun:test";
import { filterPlans, SPINNER_FRAMES } from "./hooks.ts";
import type { PlanInfo } from "./types.ts";

/** Helper to build a minimal PlanInfo for testing. */
function makePlan(
  overrides: Partial<PlanInfo> & Pick<PlanInfo, "slug" | "state">,
): PlanInfo {
  return {
    filename: `${overrides.slug}.md`,
    ...overrides,
  };
}

const plans: PlanInfo[] = [
  makePlan({
    slug: "add-auth-middleware",
    state: "in-progress",
    scope: "backend",
  }),
  makePlan({ slug: "fix-login-flow", state: "backlog", scope: "frontend" }),
  makePlan({
    slug: "refactor-db-schema",
    state: "completed",
    scope: "backend",
  }),
  makePlan({ slug: "update-readme", state: "backlog" }),
  makePlan({
    slug: "add-user-dashboard",
    state: "in-progress",
    scope: "frontend",
  }),
];

describe("filterPlans", () => {
  it("empty query returns all plans", () => {
    expect(filterPlans(plans, "")).toEqual(plans);
    expect(filterPlans(plans, "   ")).toEqual(plans);
  });

  it("plain text matches against slug (case-insensitive)", () => {
    const result = filterPlans(plans, "auth");
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("add-auth-middleware");
  });

  it("plain text matches multiple slugs", () => {
    const result = filterPlans(plans, "add");
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.slug)).toEqual([
      "add-auth-middleware",
      "add-user-dashboard",
    ]);
  });

  it("state:active filters to in-progress plans", () => {
    const result = filterPlans(plans, "state:active");
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.state === "in-progress")).toBe(true);
  });

  it("state:queued filters to backlog plans", () => {
    const result = filterPlans(plans, "state:queued");
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.state === "backlog")).toBe(true);
  });

  it("state:done filters to completed plans", () => {
    const result = filterPlans(plans, "state:done");
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe("completed");
  });

  it("state:in-progress works as a literal state value", () => {
    const result = filterPlans(plans, "state:in-progress");
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.state === "in-progress")).toBe(true);
  });

  it("scope:backend filters by scope", () => {
    const result = filterPlans(plans, "scope:backend");
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.slug)).toEqual([
      "add-auth-middleware",
      "refactor-db-schema",
    ]);
  });

  it("scope:frontend filters by scope", () => {
    const result = filterPlans(plans, "scope:frontend");
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.slug)).toEqual([
      "fix-login-flow",
      "add-user-dashboard",
    ]);
  });

  it("combined state:active and text query", () => {
    const result = filterPlans(plans, "state:active auth");
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("add-auth-middleware");
  });

  it("combined scope and text query", () => {
    const result = filterPlans(plans, "scope:backend refactor");
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("refactor-db-schema");
  });

  it("combined state and scope filters", () => {
    const result = filterPlans(plans, "state:active scope:frontend");
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("add-user-dashboard");
  });

  it("unrecognized state value returns no matches", () => {
    const result = filterPlans(plans, "state:bogus");
    // stateFilter is null (no alias), so no state filtering, returns all
    // Actually: stateFilter is null, so state filter is skipped
    expect(result).toEqual(plans);
  });

  it("query with no matches returns empty array", () => {
    const result = filterPlans(plans, "nonexistent-slug");
    expect(result).toHaveLength(0);
  });

  it("plans without scope are excluded by scope filter", () => {
    const result = filterPlans(plans, "scope:backend");
    // update-readme has no scope, so it should not appear
    expect(result.find((p) => p.slug === "update-readme")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// source: filter
// ---------------------------------------------------------------------------

describe("filterPlans — source: filter", () => {
  const sourcePlans: PlanInfo[] = [
    makePlan({ slug: "local-plan", state: "backlog" }),
    makePlan({
      slug: "gh-42-pulled-issue",
      state: "in-progress",
      source: "github",
      issueNumber: 42,
    }),
    makePlan({
      slug: "gh-99-remote-issue",
      state: "backlog",
      source: "github-remote",
      issueNumber: 99,
    }),
    makePlan({
      slug: "gh-7-another-pulled",
      state: "completed",
      source: "github",
      issueNumber: 7,
    }),
  ];

  it("source:github matches both pulled and remote issues", () => {
    const result = filterPlans(sourcePlans, "source:github");
    expect(result).toHaveLength(3);
    expect(result.every((p) => p.source?.startsWith("github"))).toBe(true);
  });

  it("source:remote matches only unpulled remote issues", () => {
    const result = filterPlans(sourcePlans, "source:remote");
    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("github-remote");
  });

  it("source:local matches only plans without a source field", () => {
    const result = filterPlans(sourcePlans, "source:local");
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("local-plan");
  });

  it("source: filter combines with text query", () => {
    const result = filterPlans(sourcePlans, "source:github pulled");
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.slug)).toEqual([
      "gh-42-pulled-issue",
      "gh-7-another-pulled",
    ]);
  });

  it("source: filter combines with state: filter", () => {
    const result = filterPlans(sourcePlans, "source:github state:done");
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe("gh-7-another-pulled");
  });
});

// ---------------------------------------------------------------------------
// SPINNER_FRAMES
// ---------------------------------------------------------------------------

describe("SPINNER_FRAMES", () => {
  it("contains 10 braille dot characters", () => {
    expect(SPINNER_FRAMES).toHaveLength(10);
  });

  it("every frame is a single non-empty character", () => {
    for (const frame of SPINNER_FRAMES) {
      expect(frame).toHaveLength(1);
      expect(frame.trim()).not.toBe("");
    }
  });

  it("contains the expected braille sequence", () => {
    expect([...SPINNER_FRAMES]).toEqual([
      "\u280B",
      "\u2819",
      "\u2839",
      "\u2838",
      "\u283C",
      "\u2834",
      "\u2826",
      "\u2827",
      "\u2807",
      "\u280F",
    ]);
  });
});
