import type {
  CandidateDerivationResult,
  MasterDataSnapshot,
  ProcessCode,
  StandardTimeObservation,
  UploadMasterCandidate,
  UploadMasterEntity,
  UploadSourceRef,
  UploadStandardTimeCandidate,
} from "../domain/types";
import type { CapacityEvidence, ImportParseResult } from "../excel/contracts";

type SlotDefinition = {
  startsAt: string;
  endsAt: string;
  endDayOffset: 0 | 1;
  sequence: number;
};

const SHIFT_SLOT_DEFINITIONS: Record<"DAY" | "NIGHT", Record<"A" | "B" | "C" | "D" | "E", SlotDefinition>> = {
  DAY: {
    A: { startsAt: "07:30", endsAt: "09:30", endDayOffset: 0, sequence: 1 },
    B: { startsAt: "09:30", endsAt: "13:00", endDayOffset: 0, sequence: 2 },
    C: { startsAt: "13:00", endsAt: "15:00", endDayOffset: 0, sequence: 3 },
    D: { startsAt: "15:00", endsAt: "17:00", endDayOffset: 0, sequence: 4 },
    E: { startsAt: "17:00", endsAt: "19:30", endDayOffset: 0, sequence: 5 },
  },
  NIGHT: {
    A: { startsAt: "19:30", endsAt: "21:30", endDayOffset: 0, sequence: 1 },
    B: { startsAt: "21:30", endsAt: "01:00", endDayOffset: 1, sequence: 2 },
    C: { startsAt: "01:00", endsAt: "03:00", endDayOffset: 0, sequence: 3 },
    D: { startsAt: "03:00", endsAt: "05:00", endDayOffset: 0, sequence: 4 },
    E: { startsAt: "05:00", endsAt: "07:30", endDayOffset: 0, sequence: 5 },
  },
};

const PROCESS_CODES = new Set<ProcessCode>(["SPI", "AOI", "XRAY", "ICT", "ROUTER"]);

function roundThree(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function sourceRef(sourceSheet: string, sourceRow: number): UploadSourceRef {
  return { sheet: sourceSheet, row: sourceRow };
}

function addSource(sources: UploadSourceRef[], source: UploadSourceRef): void {
  if (!sources.some((candidate) => candidate.sheet === source.sheet && candidate.row === source.row)) sources.push(source);
}

function slotDefinition(shiftCode: string, slotCode: string): SlotDefinition | null {
  const shift = SHIFT_SLOT_DEFINITIONS[shiftCode as keyof typeof SHIFT_SLOT_DEFINITIONS];
  return shift?.[slotCode as keyof typeof shift] ?? null;
}

export function plannedSeconds(shiftCode: string, slotCode: string): number {
  const slot = slotDefinition(shiftCode, slotCode);
  if (!slot) return 0;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return (minutes(slot.endsAt) + slot.endDayOffset * 24 * 60 - minutes(slot.startsAt)) * 60;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function standardMasterCandidate(
  entity: UploadMasterEntity,
  code: string,
  source: UploadSourceRef,
  master: MasterDataSnapshot,
): UploadMasterCandidate {
  const records = entity === "model" ? master.models
    : entity === "line" ? master.lines
      : entity === "shift" ? master.shifts
        : master.downtimeReasons;
  const existing = records.find((record) => record.code === code);
  const active = existing?.active === true;
  const exact = active && existing?.name === code;
  return {
    key: `${entity}|${code}`,
    entity,
    code,
    parentCode: null,
    proposedName: code,
    status: exact ? "existing" : existing ? "conflict" : "new",
    approved: exact,
    startsAt: null,
    endsAt: null,
    endDayOffset: null,
    sequence: null,
    messages: exact ? [] : existing ? [active ? `Existing ${entity} name differs` : `Existing ${entity} is inactive`] : [],
    sources: [source],
  };
}

function timeSlotMasterCandidate(
  shiftCode: "DAY" | "NIGHT",
  slotCode: string,
  source: UploadSourceRef,
  master: MasterDataSnapshot,
): UploadMasterCandidate {
  const definition = slotDefinition(shiftCode, slotCode)!;
  const shift = master.shifts.find((record) => record.code === shiftCode);
  const existing = shift ? master.timeSlots.find((slot) => slot.shiftId === shift.id && slot.code === slotCode) : undefined;
  const exact = existing !== undefined
    && existing.active !== false
    && existing.startsAt === definition.startsAt
    && existing.endsAt === definition.endsAt
    && existing.endDayOffset === definition.endDayOffset
    && existing.sequence === definition.sequence;
  return {
    key: `time_slot|${shiftCode}|${slotCode}`,
    entity: "time_slot",
    code: slotCode,
    parentCode: shiftCode,
    proposedName: slotCode,
    status: exact ? "existing" : existing ? "conflict" : "new",
    approved: exact,
    startsAt: definition.startsAt,
    endsAt: definition.endsAt,
    endDayOffset: definition.endDayOffset,
    sequence: definition.sequence,
    messages: exact ? [] : existing ? ["Existing time slot configuration differs"] : [],
    sources: [source],
  };
}

function addMasterCandidate(
  candidates: Map<string, UploadMasterCandidate>,
  candidate: UploadMasterCandidate,
): void {
  const current = candidates.get(candidate.key);
  if (current) addSource(current.sources, candidate.sources[0]!);
  else candidates.set(candidate.key, candidate);
}

function addDiagnostic(
  diagnostics: CandidateDerivationResult["diagnostics"],
  sourceSheet: string,
  sourceRow: number,
  code: "unknown-process" | "unknown-shift" | "unknown-time-slot",
  field: "processCode" | "shiftCode" | "timeSlotCode",
): void {
  diagnostics.push({ sourceSheet, sourceRow, code, field, message: `Unsupported ${field}: ${field === "processCode" ? "process" : field === "shiftCode" ? "shift" : "time slot"}` });
}

function validDimensions(
  evidence: Pick<CapacityEvidence, "sourceSheet" | "sourceRow" | "processCode" | "shiftCode" | "timeSlotCode">,
  diagnostics: CandidateDerivationResult["diagnostics"],
): evidence is CapacityEvidence & { processCode: ProcessCode; shiftCode: "DAY" | "NIGHT" } {
  let valid = true;
  if (!PROCESS_CODES.has(evidence.processCode)) {
    addDiagnostic(diagnostics, evidence.sourceSheet, evidence.sourceRow, "unknown-process", "processCode");
    valid = false;
  }
  if (!slotDefinition(evidence.shiftCode, evidence.timeSlotCode)) {
    const code = evidence.shiftCode === "DAY" || evidence.shiftCode === "NIGHT" ? "unknown-time-slot" : "unknown-shift";
    const field = code === "unknown-time-slot" ? "timeSlotCode" : "shiftCode";
    addDiagnostic(diagnostics, evidence.sourceSheet, evidence.sourceRow, code, field);
    valid = false;
  }
  return valid;
}

function overlaps(candidateFrom: string, candidateTo: string | null, existingFrom: string, existingTo: string | null): boolean {
  return (existingTo === null || candidateFrom <= existingTo)
    && (candidateTo === null || existingFrom <= candidateTo);
}

function deriveStandardTimeCandidates(
  parsed: ImportParseResult,
  master: MasterDataSnapshot,
  diagnostics: CandidateDerivationResult["diagnostics"],
): UploadStandardTimeCandidate[] {
  const groups = new Map<string, StandardTimeObservation[]>();
  for (const evidence of parsed.capacityEvidence) {
    if (!Number.isFinite(evidence.capacityQty) || evidence.capacityQty <= 0 || !validDimensions(evidence, diagnostics)) continue;
    const seconds = plannedSeconds(evidence.shiftCode, evidence.timeSlotCode);
    if (seconds <= 0) continue;
    const observation: StandardTimeObservation = {
      ...sourceRef(evidence.sourceSheet, evidence.sourceRow),
      productionDate: evidence.productionDate,
      shiftCode: evidence.shiftCode,
      timeSlotCode: evidence.timeSlotCode,
      capacityQty: evidence.capacityQty,
      plannedSeconds: seconds,
      secondsPerUnit: roundThree(seconds / evidence.capacityQty),
    };
    const key = `${evidence.modelCode}|${evidence.lineCode}|${evidence.processCode}`;
    const current = groups.get(key) ?? [];
    current.push(observation);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, observations]) => {
    const [modelCode, lineCode, processCode] = key.split("|") as [string, string, ProcessCode];
    const values = observations.map((observation) => observation.secondsPerUnit);
    const medianValue = median(values);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const effectiveFrom = observations.map((observation) => observation.productionDate).sort()[0]!;
    const model = master.models.find((record) => record.active && record.code === modelCode);
    const line = master.lines.find((record) => record.active && record.code === lineCode);
    const process = master.processes.find((record) => record.active && record.code === processCode);
    const periodConflict = model && line && process && master.standardTimes.some((standardTime) =>
      standardTime.modelId === model.id
      && standardTime.lineId === line.id
      && standardTime.processId === process.id
      && overlaps(effectiveFrom, null, standardTime.effectiveFrom, standardTime.effectiveTo));
    const deviationConflict = values.some((value) => Math.abs(value - medianValue) / medianValue > 0.05);
    const messages = [
      ...(deviationConflict ? ["CAPA evidence deviates by more than 5% from the median"] : []),
      ...(periodConflict ? ["Standard-time effective period overlaps an existing record"] : []),
    ];
    return {
      key,
      modelCode,
      lineCode,
      processCode,
      status: messages.length > 0 ? "conflict" : "new",
      approved: false,
      proposedSecondsPerUnit: roundThree(medianValue),
      approvedSecondsPerUnit: null,
      minimum: roundThree(minimum),
      median: roundThree(medianValue),
      maximum: roundThree(maximum),
      effectiveFrom,
      effectiveTo: null,
      messages,
      observations,
    };
  });
}

export function deriveLegacyCandidates(
  parsed: ImportParseResult,
  master: MasterDataSnapshot,
): CandidateDerivationResult {
  const diagnostics: CandidateDerivationResult["diagnostics"] = [];
  const candidates = new Map<string, UploadMasterCandidate>();
  for (const row of parsed.rows) {
    const source = sourceRef(row.sourceSheet, row.sourceRow);
    const validProcess = PROCESS_CODES.has(row.processCode);
    const validShift = row.shiftCode === "DAY" || row.shiftCode === "NIGHT";
    if (!validProcess) addDiagnostic(diagnostics, row.sourceSheet, row.sourceRow, "unknown-process", "processCode");
    if (!validShift) addDiagnostic(diagnostics, row.sourceSheet, row.sourceRow, "unknown-shift", "shiftCode");
    if (!validProcess || !validShift) continue;
    const shiftCode = row.shiftCode as "DAY" | "NIGHT";
    addMasterCandidate(candidates, standardMasterCandidate("model", row.modelCode, source, master));
    addMasterCandidate(candidates, standardMasterCandidate("line", row.lineCode, source, master));
    addMasterCandidate(candidates, standardMasterCandidate("shift", shiftCode, source, master));
    if (row.timeSlotCode !== null) {
      if (!slotDefinition(shiftCode, row.timeSlotCode)) addDiagnostic(diagnostics, row.sourceSheet, row.sourceRow, "unknown-time-slot", "timeSlotCode");
      else addMasterCandidate(candidates, timeSlotMasterCandidate(shiftCode, row.timeSlotCode, source, master));
    }
    if (row.downtimeMinutes > 0) {
      addMasterCandidate(candidates, standardMasterCandidate(
        "downtime_reason",
        row.downtimeReasonCode ?? "LEGACY_UNSPECIFIED",
        source,
        master,
      ));
    }
  }
  return {
    masterCandidates: [...candidates.values()],
    standardTimeCandidates: deriveStandardTimeCandidates(parsed, master, diagnostics),
    diagnostics,
    stWarnings: [...parsed.stWarnings],
  };
}
