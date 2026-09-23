import { applyRate, money, rate, subtract, type Money, type Rate } from "@bahulam/workplane-data";
import { CURRENCY, SCALE } from "./fixture.js";

export const SCENARIO_FORMULA_VERSION = "optimization/1";

export interface ScenarioInput {
  baseline: Money;
  /** Share of the baseline that the optimization can apply to. */
  eligibleShare: Rate;
  reduction: Rate;
}

/**
 * A scenario result identifies what produced it. Without the baseline version
 * and formula version, a saved "1,200" is a number with no provenance — and
 * the next filter change silently makes it wrong.
 */
export interface ScenarioResult {
  baseline: Money;
  eligibleSpend: Money;
  savings: Money;
  projectedCost: Money;
  formulaVersion: string;
  /** Version of the source data the baseline came from. */
  baselineVersion: string;
  eligibleSharePercent: number;
  reductionPercent: number;
}

/**
 * Deterministic and integer-exact: 10,000 x 60% x 20% is 1,200, every time,
 * on every machine. Rounding happens once, inside `applyRate`.
 *
 * This is a projection under stated assumptions. It is not a forecast, and
 * running it changes no infrastructure and writes to no external system.
 */
export function computeScenario(input: ScenarioInput, baselineVersion: string): ScenarioResult {
  const eligibleSpend = applyRate(input.baseline, input.eligibleShare);
  const savings = applyRate(eligibleSpend, input.reduction);
  return {
    baseline: input.baseline,
    eligibleSpend,
    savings,
    projectedCost: subtract(input.baseline, savings),
    formulaVersion: SCENARIO_FORMULA_VERSION,
    baselineVersion,
    eligibleSharePercent: input.eligibleShare.basisPoints / 100,
    reductionPercent: input.reduction.basisPoints / 100,
  };
}

/** Convenience for the demo and tests: percentages in, result out. */
export function scenarioFromPercentages(
  baselineMinorUnits: number,
  eligibleSharePercent: number,
  reductionPercent: number,
  baselineVersion: string,
): ScenarioResult {
  return computeScenario(
    {
      baseline: money(baselineMinorUnits, CURRENCY, SCALE),
      eligibleShare: rate(eligibleSharePercent),
      reduction: rate(reductionPercent),
    },
    baselineVersion,
  );
}
