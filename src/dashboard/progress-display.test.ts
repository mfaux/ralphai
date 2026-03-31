import { describe, it, expect } from "vitest";
import { hasProgressData, clampCompleted } from "./format.ts";

describe("hasProgressData", () => {
  it("returns false when both fields are undefined", () => {
    expect(hasProgressData(undefined, undefined)).toBe(false);
  });

  it("returns false when totalTasks is undefined and tasksCompleted is defined", () => {
    // AC: SummaryView hides the progress bar when tasksCompleted=1 and totalTasks=undefined
    expect(hasProgressData(undefined, 1)).toBe(false);
  });

  it("returns false when totalTasks is 0 and tasksCompleted is 0", () => {
    // AC: SummaryView hides the progress bar when both fields are 0
    expect(hasProgressData(0, 0)).toBe(false);
  });

  it("returns false when totalTasks is 0 and tasksCompleted is undefined", () => {
    expect(hasProgressData(0, undefined)).toBe(false);
  });

  it("returns true when totalTasks is positive", () => {
    expect(hasProgressData(5, 3)).toBe(true);
  });

  it("returns true when totalTasks is positive and tasksCompleted is undefined", () => {
    expect(hasProgressData(5, undefined)).toBe(true);
  });

  it("returns true when totalTasks is positive and tasksCompleted is 0", () => {
    expect(hasProgressData(5, 0)).toBe(true);
  });
});

describe("clampCompleted", () => {
  it("returns completed when completed <= total", () => {
    expect(clampCompleted(3, 5)).toBe(3);
  });

  it("clamps completed to total when completed > total", () => {
    // AC: Display shows total/total (not 7/5) when completed exceeds total
    expect(clampCompleted(7, 5)).toBe(5);
  });

  it("handles undefined completed", () => {
    expect(clampCompleted(undefined, 5)).toBe(0);
  });

  it("handles undefined total", () => {
    expect(clampCompleted(3, undefined)).toBe(0);
  });

  it("handles both undefined", () => {
    expect(clampCompleted(undefined, undefined)).toBe(0);
  });

  it("handles zero total", () => {
    expect(clampCompleted(3, 0)).toBe(0);
  });

  it("handles equal values", () => {
    expect(clampCompleted(5, 5)).toBe(5);
  });
});
