import type { LegacyUploadReview } from "../../src/domain/types";

export const completeCandidateReview = {
  batchId: "batch-1",
  newCount: 0,
  conflictCount: 0,
  errorCount: 0,
  unknownMasterDataCount: 0,
  rows: [],
  diagnostics: [],
  sourceFileName: "legacy.xlsx",
  sourceSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  workbookKind: "production",
  masterCandidates: [],
  standardTimeCandidates: [],
  detailTotal: 0,
  detailPage: 1,
} satisfies LegacyUploadReview;
