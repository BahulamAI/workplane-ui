/**
 * Synthetic Azure-shaped cost data. Two periods, two environments, five
 * services. These are TEST VALUES chosen to make the acceptance arithmetic
 * exact — they are not Azure pricing estimates and must never be presented as
 * a cost forecast.
 *
 * Production / 2026-08 sums to exactly 10,000 so that the PRD's worked
 * example holds: 10,000 baseline x 60% eligible x 20% reduction = 1,200 saved,
 * 8,800 projected.
 */
export interface CostRow {
  period: string;
  environment: string;
  service: string;
  /** Integer minor units, USD. 420000 = $4,200.00 */
  costMinorUnits: number;
}

export const CURRENCY = "USD";
export const SCALE = 2;

export const PERIODS = ["2026-07", "2026-08"] as const;
export const ENVIRONMENTS = ["production", "development"] as const;
export const SERVICES = ["compute", "storage", "network", "database", "analytics"] as const;

export const SERVICE_LABELS: Record<string, string> = {
  compute: "Compute",
  storage: "Storage",
  network: "Networking",
  database: "Database",
  analytics: "Analytics",
};

export const COST_ROWS: readonly CostRow[] = [
  // Production 2026-08 -> 10,000.00 exactly
  { period: "2026-08", environment: "production", service: "compute", costMinorUnits: 420_000 },
  { period: "2026-08", environment: "production", service: "storage", costMinorUnits: 180_000 },
  { period: "2026-08", environment: "production", service: "network", costMinorUnits: 110_000 },
  { period: "2026-08", environment: "production", service: "database", costMinorUnits: 220_000 },
  { period: "2026-08", environment: "production", service: "analytics", costMinorUnits: 70_000 },
  // Production 2026-07 -> 9,400.00
  { period: "2026-07", environment: "production", service: "compute", costMinorUnits: 390_000 },
  { period: "2026-07", environment: "production", service: "storage", costMinorUnits: 175_000 },
  { period: "2026-07", environment: "production", service: "network", costMinorUnits: 105_000 },
  { period: "2026-07", environment: "production", service: "database", costMinorUnits: 205_000 },
  { period: "2026-07", environment: "production", service: "analytics", costMinorUnits: 65_000 },
  // Development 2026-08 -> 2,500.00
  { period: "2026-08", environment: "development", service: "compute", costMinorUnits: 120_000 },
  { period: "2026-08", environment: "development", service: "storage", costMinorUnits: 40_000 },
  { period: "2026-08", environment: "development", service: "network", costMinorUnits: 25_000 },
  { period: "2026-08", environment: "development", service: "database", costMinorUnits: 50_000 },
  { period: "2026-08", environment: "development", service: "analytics", costMinorUnits: 15_000 },
  // Development 2026-07 -> 2,350.00
  { period: "2026-07", environment: "development", service: "compute", costMinorUnits: 110_000 },
  { period: "2026-07", environment: "development", service: "storage", costMinorUnits: 38_000 },
  { period: "2026-07", environment: "development", service: "network", costMinorUnits: 24_000 },
  { period: "2026-07", environment: "development", service: "database", costMinorUnits: 47_000 },
  { period: "2026-07", environment: "development", service: "analytics", costMinorUnits: 16_000 },
];

export const SOURCE_VERSION = "fixture-2026-09-22";
