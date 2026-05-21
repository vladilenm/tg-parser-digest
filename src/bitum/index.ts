// src/bitum/index.ts — public API barrel для битум-pipeline.

export * from "./types.js";
export { BUILT_IN_SIGNATURES, type Signature } from "./signatures.js";
export { classifyFile } from "./classifier.js";
export { loadLearned, appendLearned } from "./learned-signatures.js";
export {
  loadRefineries,
  normalizeRefinery,
  getCompany,
} from "./refineries.js";
export {
  isoWeekFolder,
  weekDir,
  saveUpload,
  listWeekV5,
  findLatestWeekWithUploads,
  writeLastRun,
  resetWeek,
} from "./storage.js";
export {
  deltasFor,
  volumeTotals,
  byCompanyFixedOrder,
  crossCheck,
  type BitumDelta,
  type BitumCompanyGroup,
  type BitumVolumeTotals,
  type CrossCheckWarning,
} from "./analyzer.js";
export {
  renderBitumReport,
  chunkBitumHtml,
  type ReporterPayload,
  type ReporterOptions,
} from "./reporter.js";
export {
  buildBitumNarrative,
  encodeReportForLlm,
  BITUM_NARRATIVE_SYSTEM_PROMPT,
  type NarrativePayload,
  type NarrativeResult,
} from "./llm.js";
export {
  parseBirzhaPrices,
  parseBirzhaVolumes,
  parseFcaSellers,
  parseAllPrices,
  parseBitumPriceNew,
} from "./parsers/index.js";
