import { describe, expect, it } from "vitest";
import {
  add,
  applyRate,
  CurrencyMismatchError,
  formatMoney,
  fromMajor,
  money,
  rate,
  subtract,
  toMajor,
} from "@bahulam/workplane-data";
import { scenarioFromPercentages } from "@bahulam/workplane-testkit";

describe("minor-unit money", () => {
  it("rejects fractional minor units outright", () => {
    expect(() => money(10.5, "USD")).toThrow(/whole minor units/);
  });

  it("refuses to combine currencies without a rate source", () => {
    expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(CurrencyMismatchError);
    expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(/rate source and effective date/);
  });

  it("refuses to combine differing scales", () => {
    expect(() => subtract(money(100, "USD", 2), money(100, "USD", 0))).toThrow(/scale/);
  });

  it("round-trips major units exactly", () => {
    expect(fromMajor(10_000, "USD").minorUnits).toBe(1_000_000);
    expect(toMajor(money(1_000_000, "USD"))).toBe(10_000);
  });

  it("rejects an amount finer than the scale allows", () => {
    expect(() => fromMajor(1.005, "USD", 2)).toThrow(/exactly/);
  });

  it("rejects a rate finer than one basis point", () => {
    expect(() => rate(20.001)).toThrow(/basis point/);
  });
});

describe("rate application", () => {
  it("is integer-exact where floating point is not", () => {
    // 0.1 + 0.2 !== 0.3 territory: this is why rates are basis points.
    const baseline = fromMajor(10_000, "USD");
    const eligible = applyRate(baseline, rate(60));
    expect(eligible.minorUnits).toBe(600_000);
    const savings = applyRate(eligible, rate(20));
    expect(savings.minorUnits).toBe(120_000);
    expect(toMajor(savings)).toBe(1_200);
  });

  it("applies the declared rounding mode at one stage", () => {
    const value = money(101, "USD");
    expect(applyRate(value, rate(50), "down").minorUnits).toBe(50);
    expect(applyRate(value, rate(50), "half-up").minorUnits).toBe(51);
    expect(applyRate(value, rate(50), "half-even").minorUnits).toBe(50);
  });

  it("formats with the declared currency and scale", () => {
    expect(formatMoney(fromMajor(8_800, "USD"))).toBe("$8,800.00");
  });
});

describe("AC-02 — the PRD worked example", () => {
  const BASELINE_MINOR_UNITS = 1_000_000; // 10,000.00 USD
  const VERSION = "fixture-2026-09-22";

  it("20% reduction yields 1,200 saved and 8,800 projected", () => {
    const result = scenarioFromPercentages(BASELINE_MINOR_UNITS, 60, 20, VERSION);
    expect(toMajor(result.savings)).toBe(1_200);
    expect(toMajor(result.projectedCost)).toBe(8_800);
  });

  it("30% reduction yields 1,800 saved and 8,200 projected", () => {
    const result = scenarioFromPercentages(BASELINE_MINOR_UNITS, 60, 30, VERSION);
    expect(toMajor(result.savings)).toBe(1_800);
    expect(toMajor(result.projectedCost)).toBe(8_200);
  });

  it("carries the provenance that makes the number meaningful", () => {
    const result = scenarioFromPercentages(BASELINE_MINOR_UNITS, 60, 20, VERSION);
    expect(result.baselineVersion).toBe(VERSION);
    expect(result.formulaVersion).toBe("optimization/1");
    expect(result.eligibleSharePercent).toBe(60);
    expect(result.reductionPercent).toBe(20);
  });

  it("is deterministic across repeated evaluation", () => {
    const runs = Array.from({ length: 50 }, () =>
      scenarioFromPercentages(BASELINE_MINOR_UNITS, 60, 30, VERSION).savings.minorUnits,
    );
    expect(new Set(runs).size).toBe(1);
  });
});
