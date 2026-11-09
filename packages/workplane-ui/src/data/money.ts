/**
 * Monetary arithmetic in integer minor units. No float ever holds a currency
 * amount, and no renderer rounds on its own — rounding happens at declared
 * stages, here.
 */
export interface Money {
  /** Integer. 1234 at scale 2 is 12.34. */
  minorUnits: number;
  /** ISO 4217 code. A label, never an instruction to convert. */
  currency: string;
  /** Decimal places. 2 for most currencies, 0 for JPY. */
  scale: number;
}

/** A proportion in basis points. 10000 bp = 100%. Integer by construction. */
export interface Rate {
  basisPoints: number;
}

export type Rounding = "half-up" | "half-even" | "down";

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(
      `Cannot combine ${a} and ${b}. Currency conversion requires an identified rate source and effective date; a label change is not a conversion.`,
    );
    this.name = "CurrencyMismatchError";
  }
}

export function money(minorUnits: number, currency: string, scale = 2): Money {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`Money must be whole minor units, received ${minorUnits}`);
  }
  return { minorUnits, currency, scale };
}

/** `fromMajor(10_000, "USD")` is ten thousand dollars, not ten thousand cents. */
export function fromMajor(major: number, currency: string, scale = 2): Money {
  const factor = 10 ** scale;
  const minorUnits = Math.round(major * factor);
  if (Math.abs(major * factor - minorUnits) > 1e-6) {
    throw new Error(`${major} cannot be represented exactly at scale ${scale}`);
  }
  return { minorUnits, currency, scale };
}

export function toMajor(value: Money): number {
  return value.minorUnits / 10 ** value.scale;
}

export function rate(percent: number): Rate {
  const basisPoints = Math.round(percent * 100);
  if (Math.abs(percent * 100 - basisPoints) > 1e-9) {
    throw new Error(`${percent}% is finer than one basis point`);
  }
  return { basisPoints };
}

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  if (a.scale !== b.scale) {
    throw new Error(`Cannot combine ${a.currency} at scale ${a.scale} and scale ${b.scale}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSame(a, b);
  return { ...a, minorUnits: a.minorUnits + b.minorUnits };
}

export function subtract(a: Money, b: Money): Money {
  assertSame(a, b);
  return { ...a, minorUnits: a.minorUnits - b.minorUnits };
}

export function sum(values: readonly Money[], currency: string, scale = 2): Money {
  return values.reduce<Money>((acc, value) => add(acc, value), money(0, currency, scale));
}

function divideRounded(numerator: number, denominator: number, rounding: Rounding): number {
  const quotient = numerator / denominator;
  const floor = Math.floor(quotient);
  const remainder = quotient - floor;
  switch (rounding) {
    case "down":
      return floor;
    case "half-up":
      return remainder >= 0.5 ? floor + 1 : floor;
    case "half-even":
      if (remainder > 0.5) return floor + 1;
      if (remainder < 0.5) return floor;
      return floor % 2 === 0 ? floor : floor + 1;
  }
}

/**
 * Apply a proportion. Integer numerator, integer denominator, one declared
 * rounding step — so `10,000 x 60% x 20%` is exactly `1,200`, not
 * `1,199.9999999999998`.
 */
export function applyRate(value: Money, proportion: Rate, rounding: Rounding = "half-even"): Money {
  const minorUnits = divideRounded(value.minorUnits * proportion.basisPoints, 10_000, rounding);
  return { ...value, minorUnits };
}

export function formatMoney(value: Money, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: value.scale,
    maximumFractionDigits: value.scale,
  }).format(toMajor(value));
}
