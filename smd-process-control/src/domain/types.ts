export type AppRole = "operator" | "admin" | "viewer";
export type ProcessCode = "SPI" | "AOI" | "XRAY" | "ICT" | "ROUTER";
export type WorkbookKind = "aoi" | "spi" | "ict" | "xray" | "production" | "standard" | "unknown";
export type ImportRowErrorCode =
  | "missing-required-value"
  | "unknown-model"
  | "unknown-line"
  | "unknown-process"
  | "unknown-shift"
  | "unknown-time-slot"
  | "unknown-downtime-reason"
  | "invalid-count"
  | "duplicate-record"
  | "unsupported-template-version";

export type MetricResult =
  | { status: "ok"; value: number }
  | { status: "not-calculable"; reason: "zero-input" | "missing-st" | "zero-net-time" };

export class DomainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainValidationError";
  }
}

export interface StandardTime {
  id: string;
  modelId: string;
  processId: string;
  lineId: string;
  secondsPerUnit: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type StandardTimeInput = Omit<StandardTime, "id">;

export interface TimeSlot {
  id: string;
  shiftId: string;
  code: string;
  startsAt: string;
  endsAt: string;
  endDayOffset: 0 | 1;
  sequence: number;
}

export interface MasterDataSnapshot {
  models: Array<{ id: string; code: string; name: string; active: boolean; version: number }>;
  processes: Array<{ id: string; code: ProcessCode; name: string; active: boolean }>;
  lines: Array<{ id: string; code: string; name: string; active: boolean }>;
  shifts: Array<{ id: string; code: string; name: string; active: boolean }>;
  timeSlots: TimeSlot[];
  downtimeReasons: Array<{ id: string; code: string; name: string; active: boolean; version: number }>;
  standardTimes: StandardTime[];
}

export interface DowntimeDraft {
  reasonId: string;
  minutes?: number;
  startTime?: string;
  endTime?: string;
  note: string;
}

export interface ProductionEntryDraft {
  productionDate: string;
  shiftId: string;
  timeSlotId: string;
  lineId: string;
  modelId: string;
  processId: string;
  inputQty: number;
  actualQty: number;
  okQty: number;
  ngQty: number;
  note: string;
  downtime: DowntimeDraft[];
}

export interface ProductionPreview {
  standardTime: StandardTime | null;
  yieldResult: MetricResult;
  utilizationResult: MetricResult;
  plannedSeconds: number | null;
  downtimeSeconds: number;
}

export interface WorkbookSheet {
  sheet: string;
  data: unknown[][];
}

export type WorkbookDiagnosticCode =
  | "ambiguous-workbook"
  | "unsupported-template-version"
  | "missing-workbook-signature";

export interface WorkbookDiagnostic {
  code: WorkbookDiagnosticCode;
  message: string;
  sourceSheet?: string;
  sourceRow?: number;
  field?: string;
}

export interface WorkbookDetection {
  kind: WorkbookKind;
  diagnostics: WorkbookDiagnostic[];
}

export interface NormalizedImportRow {
  sourceSheet: string;
  sourceRow: number;
  productionDate: string;
  shiftCode: string;
  timeSlotCode: string | null;
  lineCode: string;
  modelCode: string;
  processCode: ProcessCode;
  inputQty: number;
  actualQty: number;
  okQty: number;
  ngQty: number;
  downtimeMinutes: number;
  downtimeReasonCode: string | null;
  note: string;
}

export interface ImportDiagnostic {
  sourceSheet: string;
  sourceRow: number;
  code: ImportRowErrorCode | "ambiguous-workbook";
  message: string;
  field?: string;
}

export interface ImportParseResult {
  kind: WorkbookKind;
  rows: NormalizedImportRow[];
  diagnostics: ImportDiagnostic[];
}

export interface UploadReview {
  batchId: string;
  newCount: number;
  conflictCount: number;
  errorCount: number;
  unknownMasterDataCount: number;
  rows: Array<NormalizedImportRow & { status: "new" | "conflict" | "error"; messages: string[] }>;
  diagnostics: Array<{ sourceSheet: string; sourceRow: number; messages: string[] }>;
}

export interface UploadCommitResult {
  batchId: string;
  insertedCount: number;
  replacedCount: number;
}

export interface DashboardFilters {
  productionDate: string;
  shiftId: string | null;
  modelId: string | null;
  lineId: string | null;
  processCode: ProcessCode | null;
}

export interface DashboardSnapshot {
  totalActual: number;
  weightedYield: MetricResult;
  weightedUtilization: MetricResult;
  attentionCount: number;
  yields: Array<{ processCode: ProcessCode; lineId: string; result: MetricResult }>;
  utilization: Array<{ lineId: string; result: MetricResult }>;
  downtime: Array<{ reasonId: string; reasonName: string; minutes: number }>;
  entryProgress: Array<{ timeSlotId: string; status: "complete" | "in-progress" | "waiting" }>;
}

export interface AnalysisFilters {
  from: string;
  to: string;
  groupBy: "day" | "week" | "month";
  shiftId: string | null;
  modelId: string | null;
  lineId: string | null;
  processCode: ProcessCode | null;
}

export interface AnalysisDataset {
  filters: AnalysisFilters;
  yieldSeries: Array<{ period: string; inputQty: number; okQty: number; target: number | null }>;
  utilizationSeries: Array<{ period: string; actualQty: number; productiveSeconds: number; netSeconds: number }>;
  downtime: Array<{ reason: string; minutes: number }>;
  defects: Array<{ type: string; classification: "pseudo" | "real" | "scrap"; quantity: number }>;
}
