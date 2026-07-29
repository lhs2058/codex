import { describe, expect, it } from "vitest";
import type { LegacyUploadReview, MasterDataSnapshot } from "../../src/domain/types";
import type { ImportParseResult } from "../../src/excel/contracts";
import { deriveLegacyCandidates, median, plannedSeconds } from "../../src/upload/legacy-master-candidates";

const emptyMaster = (): MasterDataSnapshot => ({
  models: [], processes: [], lines: [], shifts: [], timeSlots: [], downtimeReasons: [], standardTimes: [],
});

const candidateReviewFixture = {
  batchId: "batch-1",
  newCount: 0,
  conflictCount: 0,
  errorCount: 0,
  unknownMasterDataCount: 0,
  rows: [],
  diagnostics: [],
  sourceFileName: "legacy.xlsx",
  sourceSha256: "a".repeat(64),
  workbookKind: "production",
  masterCandidates: [],
  standardTimeCandidates: [],
  detailTotal: 0,
  detailPage: 1,
} satisfies LegacyUploadReview;

function parsed(overrides: Partial<ImportParseResult> = {}): ImportParseResult {
  return {
    kind: "production",
    rows: [{
      sourceSheet: "Production", sourceRow: 8, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A",
      lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", inputQty: 0, actualQty: 100, okQty: 0, ngQty: 0,
      downtimeMinutes: 0, downtimeReasonCode: null, note: "", dimensions: { production: { inputQty: 0, actualQty: 100 }, quality: null }, warnings: [], defects: [],
    }],
    diagnostics: [],
    capacityEvidence: [{
      sourceSheet: "Production", sourceRow: 8, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A",
      lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720,
    }],
    stWarnings: [],
    ...overrides,
  };
}

describe("legacy master candidate derivation", () => {
  it("proposes missing models, lines, shifts, and approved time slots with source references", () => {
    const result = deriveLegacyCandidates(parsed(), emptyMaster());

    expect(result.masterCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "model", code: "MODEL-1", status: "new", proposedName: "MODEL-1", sources: [{ sheet: "Production", row: 8 }] }),
      expect.objectContaining({ entity: "line", code: "AOI-1", status: "new", proposedName: "AOI-1" }),
      expect.objectContaining({ entity: "shift", code: "DAY", status: "new" }),
      expect.objectContaining({ entity: "time_slot", code: "A", parentCode: "DAY", status: "new", startsAt: "07:30", endsAt: "09:30", endDayOffset: 0, sequence: 1 }),
    ]));
  });

  it("uses the approved overnight slot table without changing NIGHT source dates", () => {
    const result = deriveLegacyCandidates(parsed({
      rows: [{ ...parsed().rows[0]!, sourceRow: 9, productionDate: "2026-07-28", shiftCode: "NIGHT", timeSlotCode: "B" }, { ...parsed().rows[0]!, sourceRow: 10, productionDate: "2026-07-28", shiftCode: "NIGHT", timeSlotCode: "C" }],
      capacityEvidence: [{
        sourceSheet: "Production", sourceRow: 10, productionDate: "2026-07-28", shiftCode: "NIGHT", timeSlotCode: "C",
        lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720,
      }],
    }), emptyMaster());

    expect(result.masterCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "time_slot", parentCode: "NIGHT", code: "B", startsAt: "21:30", endsAt: "01:00", endDayOffset: 1, sequence: 2 }),
      expect.objectContaining({ entity: "time_slot", parentCode: "NIGHT", code: "C", startsAt: "01:00", endsAt: "03:00", endDayOffset: 0, sequence: 3 }),
    ]));
    expect(result.standardTimeCandidates[0]?.observations).toEqual([expect.objectContaining({
      productionDate: "2026-07-28", shiftCode: "NIGHT", timeSlotCode: "C",
    })]);
  });

  it("proposes the legacy downtime fallback only for positive downtime without a reason", () => {
    const withoutReason = parsed({ rows: [{ ...parsed().rows[0]!, downtimeMinutes: 3, downtimeReasonCode: null }] });
    const withReason = parsed({ rows: [{ ...parsed().rows[0]!, downtimeMinutes: 3, downtimeReasonCode: "SETUP" }] });

    expect(deriveLegacyCandidates(withoutReason, emptyMaster()).masterCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "downtime_reason", code: "LEGACY_UNSPECIFIED", status: "new" }),
    ]));
    expect(deriveLegacyCandidates(withReason, emptyMaster()).masterCandidates.some((candidate) => candidate.code === "LEGACY_UNSPECIFIED")).toBe(false);
  });

  it("keeps matching active master records unchanged and flags a code whose name differs", () => {
    const master = emptyMaster();
    master.models = [{ id: "model-1", code: "MODEL-1", name: "MODEL-1", active: true, version: 1 }];
    master.lines = [{ id: "line-1", code: "AOI-1", name: "Renamed AOI", active: true }];

    const candidates = deriveLegacyCandidates(parsed({ capacityEvidence: [] }), master).masterCandidates;

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "model", code: "MODEL-1", status: "existing", approved: true }),
      expect.objectContaining({ entity: "line", code: "AOI-1", status: "conflict", approved: false }),
    ]));
  });

  it("reports unsupported processes and shifts at their source and excludes them from master candidates", () => {
    const result = deriveLegacyCandidates(parsed({
      rows: [{ ...parsed().rows[0]!, processCode: "WAVE" as "AOI", shiftCode: "WEEKEND" }],
      capacityEvidence: [],
    }), emptyMaster());

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSheet: "Production", sourceRow: 8, code: "unknown-process", field: "processCode" }),
      expect.objectContaining({ sourceSheet: "Production", sourceRow: 8, code: "unknown-shift", field: "shiftCode" }),
    ]));
    expect(result.masterCandidates.some((candidate) => candidate.code === "WEEKEND" || candidate.code === "WAVE")).toBe(false);
  });
});

describe("legacy standard-time candidates", () => {
  it("requires the complete candidate-review identity and paging contract", () => {
    expect(candidateReviewFixture.detailPage).toBe(1);
  });

  it("returns the middle observation for an odd sample", () => {
    expect(median([10, 10.5, 11])).toBe(10.5);
  });

  it("returns the mean of the two centre observations for an even sample", () => {
    expect(median([10, 10.5, 11, 15])).toBe(10.75);
  });

  it("calculates approved planned seconds for an overnight slot", () => {
    expect(plannedSeconds("NIGHT", "B")).toBe(12_600);
  });

  it("uses CAPA evidence to propose a three-decimal median and its earliest effective date", () => {
    const result = deriveLegacyCandidates(parsed({
      capacityEvidence: [
        { sourceSheet: "Production", sourceRow: 8, productionDate: "2026-07-29", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720 },
        { sourceSheet: "Production", sourceRow: 9, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 685.7142857142857 },
        { sourceSheet: "Production", sourceRow: 10, productionDate: "2026-07-30", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 654.5454545454545 },
      ],
    }), emptyMaster());

    expect(result.standardTimeCandidates).toEqual([expect.objectContaining({
      modelCode: "MODEL-1", lineCode: "AOI-1", processCode: "AOI", minimum: 10, median: 10.5, maximum: 11,
      proposedSecondsPerUnit: 10.5, effectiveFrom: "2026-07-28", status: "new",
    })]);
  });

  it("does not conflict at exactly five percent but conflicts when a sample exceeds five percent", () => {
    const atBoundary = deriveLegacyCandidates(parsed({
      capacityEvidence: [
        { sourceSheet: "Production", sourceRow: 8, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720 },
        { sourceSheet: "Production", sourceRow: 9, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720 },
        { sourceSheet: "Production", sourceRow: 10, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 685.7142857142857 },
      ],
    }), emptyMaster());
    const overBoundary = deriveLegacyCandidates(parsed({
      capacityEvidence: [
        { sourceSheet: "Production", sourceRow: 8, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720 },
        { sourceSheet: "Production", sourceRow: 9, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 685.7142857142857 },
        { sourceSheet: "Production", sourceRow: 10, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 648.6486486486486 },
      ],
    }), emptyMaster());

    expect(atBoundary.standardTimeCandidates[0]).toMatchObject({ status: "new", median: 10, maximum: 10.5 });
    expect(overBoundary.standardTimeCandidates[0]).toMatchObject({ status: "conflict", median: 10.5, maximum: 11.1 });
  });

  it("uses raw seconds per unit before deciding a deviation that display rounding would hide", () => {
    const result = deriveLegacyCandidates(parsed({
      capacityEvidence: [
        { sourceSheet: "Production", sourceRow: 8, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720 },
        { sourceSheet: "Production", sourceRow: 9, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720 },
        { sourceSheet: "Production", sourceRow: 10, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 685.688164260409 },
      ],
    }), emptyMaster());

    expect(result.standardTimeCandidates).toEqual([expect.objectContaining({
      status: "conflict", minimum: 10, median: 10, maximum: 10.5004, proposedSecondsPerUnit: null,
      observations: expect.arrayContaining([expect.objectContaining({ secondsPerUnit: 10.5004 })]),
    })]);
  });

  it("excludes blank and zero CAPA evidence and detects inclusive overlap with an open standard time", () => {
    const master = emptyMaster();
    master.models = [{ id: "model-1", code: "MODEL-1", name: "MODEL-1", active: true, version: 1 }];
    master.lines = [{ id: "line-1", code: "AOI-1", name: "AOI-1", active: true }];
    master.processes = [{ id: "process-aoi", code: "AOI", name: "AOI", active: true }];
    master.standardTimes = [{ id: "st-1", modelId: "model-1", lineId: "line-1", processId: "process-aoi", secondsPerUnit: 10, effectiveFrom: "2026-07-28", effectiveTo: null }];
    const result = deriveLegacyCandidates(parsed({
      capacityEvidence: [
        { sourceSheet: "Production", sourceRow: 8, productionDate: "2026-07-28", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 720 },
        { sourceSheet: "Production", sourceRow: 9, productionDate: "2026-07-29", shiftCode: "DAY", timeSlotCode: "A", lineCode: "AOI-1", modelCode: "MODEL-1", processCode: "AOI", capacityQty: 0 },
      ],
    }), master);

    expect(result.standardTimeCandidates).toEqual([expect.objectContaining({
      observations: [expect.objectContaining({ sheet: "Production", row: 8, secondsPerUnit: 10 })],
      status: "conflict", proposedSecondsPerUnit: null, approvedSecondsPerUnit: null,
    })]);
  });
});
