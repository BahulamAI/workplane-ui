export * from "./renderer.js";
// The spec types, validator and allowlist live in the headless contract layer
// so a host can advertise chart shapes without installing ECharts. Re-exported
// here because this subpath is where consumers look for them.
export {
  echartsContract,
  echartsSpecShape,
  summarizeEChartsSpec,
  validateEChartsSpec,
  ECHARTS_ALLOW,
  ECHARTS_LIMITS,
  type DataBinding,
  type EChartsSpec,
  type SeriesBinding,
} from "../renderers/echarts.js";
