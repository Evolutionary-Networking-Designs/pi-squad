import { describe, expect, it } from "vitest";

import {
  CharApproxTokenEstimator,
  SimpleContextMonitor,
} from "../../src/context/monitor.js";
import { ContextPressureLevel, type ContextBudget } from "../../src/context/types.js";

function createBudget(total = 100): ContextBudget {
  return {
    total,
    used: 0,
    available: total,
    pressureLevel: ContextPressureLevel.NOMINAL,
    utilizationPercent: 0,
    measuredAt: "2026-06-01T00:00:00.000Z",
  };
}

describe("context monitor", () => {
  it("loads the monitor module without runtime errors", async () => {
    const mod = await import("../../src/context/monitor.js");

    expect(mod).toBeTypeOf("object");
  });

  it("uses a four-characters-per-token approximation", () => {
    const estimator = new CharApproxTokenEstimator();

    expect(estimator.method).toBe("char-approx");
    expect(estimator.charsPerToken).toBe(4);
    expect(estimator.estimate("1234")).toBe(1);
    expect(estimator.estimate("12345")).toBe(2);
    expect(estimator.estimate("abcdefgh")).toBe(2);
  });

  it("assesses context and returns the expected ContextAssessment shape", () => {
    const monitor = new SimpleContextMonitor(createBudget(100));

    const assessment = monitor.assess("a".repeat(280), ["b".repeat(40)]);

    expect(assessment).toEqual({
      budget: expect.objectContaining({
        total: 100,
        used: 80,
        available: 20,
        pressureLevel: ContextPressureLevel.WARNING,
        utilizationPercent: 80,
        measuredAt: expect.any(String),
      }),
      recoveryNeeded: true,
      triggerLevel: ContextPressureLevel.WARNING,
    });
  });

  it("detects warning, critical, and overflow thresholds at the documented boundaries", () => {
    const monitor = new SimpleContextMonitor(createBudget(100));

    expect(monitor.classify(69)).toBe(ContextPressureLevel.NOMINAL);
    expect(monitor.classify(70)).toBe(ContextPressureLevel.WARNING);
    expect(monitor.classify(89)).toBe(ContextPressureLevel.WARNING);
    expect(monitor.classify(90)).toBe(ContextPressureLevel.CRITICAL);
    expect(monitor.classify(99)).toBe(ContextPressureLevel.CRITICAL);
    expect(monitor.classify(100)).toBe(ContextPressureLevel.OVERFLOW);
  });
});
