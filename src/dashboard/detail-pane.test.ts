import { describe, it, expect } from "vitest";
import { defaultTabForState } from "./DetailPane.tsx";

describe("defaultTabForState", () => {
  it('returns "progress" for in-progress plans', () => {
    expect(defaultTabForState("in-progress")).toBe("progress");
  });

  it('returns "plan" for backlog plans', () => {
    expect(defaultTabForState("backlog")).toBe("plan");
  });

  it('returns "summary" for completed plans', () => {
    expect(defaultTabForState("completed")).toBe("summary");
  });
});
