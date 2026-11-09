export * from "./contract.js";
export * from "./native.js";
export * from "./diagram.js";
export * from "./echarts.js";
export * from "./three.js";

import { describeCatalog, type RendererContract, type RendererDescriptor, toDescriptor } from "./contract.js";
import { diagramContract } from "./diagram.js";
import { echartsContract } from "./echarts.js";
import { threeContract } from "./three.js";
import { NATIVE_CONTRACTS } from "./native.js";

/**
 * Every renderer this package ships a contract for.
 *
 * This list IS the catalog. There is no separate descriptor table to keep in
 * step, because the entry an agent reads and the validator that judges its
 * output are the same object. `workplane.echarts` and `workplane.diagram` are
 * here even though their components need a peer dependency: a host must be able
 * to tell an agent what a chart looks like before deciding to install ECharts.
 */
export const ALL_CONTRACTS: readonly RendererContract<never>[] = [
  ...NATIVE_CONTRACTS,
  diagramContract,
  echartsContract,
  threeContract,
  // The spec type appears in both a return position (validate) and an argument
  // position (summarize), so no single instantiation covers every contract.
  // Erasing it is safe here because the catalog only reads declarations.
] as unknown as readonly RendererContract<never>[];

/** The catalog a host publishes: data only, no functions. */
export const BUILTIN_RENDERERS: readonly RendererDescriptor[] = ALL_CONTRACTS.map(toDescriptor);

/** Catalog text for a tool description, derived from the contracts themselves. */
export function describeBuiltinCatalog(): string {
  return describeCatalog(ALL_CONTRACTS);
}
