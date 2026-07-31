import path from "node:path";
import writeXlsxFile from "write-excel-file/node";

export const SEED_CONTRACT = Object.freeze({
  confirmation: "local-only-smd-e2e",
  employees: Object.freeze({
    operator: Object.freeze({ employeeId: "910001", email: "910001@smd.internal", displayName: "E2E Operator", role: "operator" }),
    admin: Object.freeze({ employeeId: "910002", email: "910002@smd.internal", displayName: "E2E Admin", role: "admin" }),
    viewer: Object.freeze({ employeeId: "910003", email: "910003@smd.internal", displayName: "E2E Viewer", role: "viewer" }),
  }),
  ids: Object.freeze({
    model: "e2000000-0000-4000-8000-000000000001",
    line: "e2000000-0000-4000-8000-000000000002",
    shift: "e2000000-0000-4000-8000-000000000003",
    concurrencySlot: "e2000000-0000-4000-8000-000000000004",
    reportSlot: "e2000000-0000-4000-8000-000000000005",
    downtimeReason: "e2000000-0000-4000-8000-000000000006",
    standardTime: "e2000000-0000-4000-8000-000000000007",
    yieldTarget: "e2000000-0000-4000-8000-000000000008",
    operatorLine: "e2000000-0000-4000-8000-000000000301",
    operatorStandardTime: "e2000000-0000-4000-8000-000000000302",
  }),
  codes: Object.freeze({
    model: "E2E-MODEL",
    line: "LINE-1",
    shift: "E2E-DAY",
    concurrencySlot: "E2E-08",
    reportSlot: "E2E-09",
    downtimeReason: "E2E-WAIT",
    process: "AOI",
    operatorLine: "LINE-2",
    adminModel: "E2E-ADMIN-MODEL",
  }),
  labels: Object.freeze({
    model: "E2E Model",
    line: "E2E Line 1",
    shift: "E2E Day Shift",
    concurrencySlot: "E2E-08",
    process: "AOI",
    operatorLine: "E2E Operator Line",
  }),
  records: Object.freeze({
    concurrency: Object.freeze({ inputQty: 100, actualQty: 100, okQty: 99, ngQty: 1, downtimeMinutes: 5, version: 3 }),
    edited: Object.freeze({ inputQty: 110, actualQty: 110, okQty: 109, ngQty: 1 }),
    report: Object.freeze({ inputQty: 200, actualQty: 200, okQty: 198, ngQty: 2, version: 1 }),
    dashboardBaselineActual: 300,
    dashboardAfterEditActual: 310,
  }),
});

export function datedSeedIds(productionDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate)
    || new Date(`${productionDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== productionDate) {
    throw new Error("productionDate must be a real ISO date");
  }
  const stamp = productionDate.replaceAll("-", "");
  const id = (suffix) => `e2000000-0000-4000-8000-${stamp}${suffix}`;
  return Object.freeze({
    concurrencyRecord: id("0101"),
    concurrencyQuality: id("0102"),
    concurrencyDowntime: id("0103"),
    reportRecord: id("0201"),
    reportQuality: id("0202"),
  });
}

const REQUIRED_ENVIRONMENT = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "E2E_OPERATOR_PASSWORD",
  "E2E_ADMIN_PASSWORD",
  "E2E_VIEWER_PASSWORD",
  "E2E_DUPLICATE_WORKBOOK",
  "E2E_LEGACY_WORKBOOK",
  "E2E_SEED_CONFIRM",
];

export function assertSeedEnvironment(environment, projectRoot = process.cwd()) {
  for (const name of REQUIRED_ENVIRONMENT) {
    if (!String(environment[name] ?? "").trim()) throw new Error(`${name} is required`);
  }
  if (environment.E2E_SEED_CONFIRM !== SEED_CONTRACT.confirmation) {
    throw new Error(`E2E_SEED_CONFIRM must equal ${SEED_CONTRACT.confirmation}`);
  }
  let target;
  try {
    target = new URL(environment.SUPABASE_URL);
  } catch {
    throw new Error("SUPABASE_URL must be the local Supabase API URL");
  }
  const localHost = target.hostname === "127.0.0.1" || target.hostname === "localhost";
  if (target.protocol !== "http:" || !localHost || target.port !== "54321" || target.pathname !== "/") {
    throw new Error("Refusing to seed anything except local Supabase at http://127.0.0.1:54321");
  }
  const workbookPath = path.resolve(projectRoot, environment.E2E_DUPLICATE_WORKBOOK);
  const legacyWorkbookPath = path.resolve(projectRoot, environment.E2E_LEGACY_WORKBOOK);
  const fixtureRoot = path.resolve(projectRoot, ".e2e");
  if (
    path.extname(workbookPath).toLowerCase() !== ".xlsx"
    || !workbookPath.startsWith(`${fixtureRoot}${path.sep}`)
    || path.extname(legacyWorkbookPath).toLowerCase() !== ".xlsx"
    || !legacyWorkbookPath.startsWith(`${fixtureRoot}${path.sep}`)
    || legacyWorkbookPath === workbookPath
  ) {
    throw new Error("E2E workbook paths must be distinct .xlsx paths inside the project .e2e directory");
  }
  return {
    supabaseUrl: target.toString().replace(/\/$/, ""),
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    passwords: {
      operator: environment.E2E_OPERATOR_PASSWORD,
      admin: environment.E2E_ADMIN_PASSWORD,
      viewer: environment.E2E_VIEWER_PASSWORD,
    },
    workbookPath,
    legacyWorkbookPath,
  };
}

export async function runAfterSeedPreflight(loadSnapshot, write) {
  const snapshot = await loadSnapshot();
  if (!snapshot.reviewRpcAvailable || !snapshot.candidateTablesAvailable) {
    throw new Error("Required legacy upload migrations are missing; reset the local database before seeding");
  }
  if (!snapshot.processId || !snapshot.legacyReasonId) {
    throw new Error("Required AOI process or LEGACY_UNSPECIFIED reason is missing; reset the local database before seeding");
  }
  if (
    snapshot.candidateNamespaceCount !== 0
    || snapshot.candidateRowCount !== 0
    || snapshot.uploadBatchCount !== 0
    || snapshot.storageObjectCount !== 0
  ) {
    throw new Error("Legacy approval E2E namespace is dirty; reset the local database before seeding");
  }
  return write(snapshot);
}

const PRODUCTION_HEADERS = [
  "Production Date", "Shift", "Time Slot", "Line", "Model", "Process",
  "Input", "Actual", "OK", "NG", "Downtime Minutes", "Downtime Reason", "Note",
];
const cell = (value, type = String) => ({ value, type });

export async function buildDuplicateWorkbookBuffer(productionDate) {
  const production = [
    [{ ...cell("SMD_STANDARD_V1"), columnSpan: PRODUCTION_HEADERS.length }],
    PRODUCTION_HEADERS.map((value) => cell(value)),
    [
      { ...cell(new Date(`${productionDate}T00:00:00.000Z`), Date), format: "yyyy-mm-dd" },
      cell(SEED_CONTRACT.codes.shift),
      cell(SEED_CONTRACT.codes.reportSlot),
      cell(SEED_CONTRACT.codes.line),
      cell(SEED_CONTRACT.codes.model),
      cell(SEED_CONTRACT.codes.process),
      cell(SEED_CONTRACT.records.report.inputQty, Number),
      cell(SEED_CONTRACT.records.report.actualQty, Number),
      cell(SEED_CONTRACT.records.report.okQty, Number),
      cell(SEED_CONTRACT.records.report.ngQty, Number),
      cell(0, Number),
      cell(""),
      cell("Deterministic duplicate of seeded report record"),
    ],
  ];
  const defects = [[cell("Production Row"), cell("Defect Type"), cell("Classification"), cell("Quantity")]];
  const reference = [
    [cell("Template Version"), cell(1, Number)],
    [cell("Generated On"), { ...cell(new Date(`${productionDate}T00:00:00.000Z`), Date), format: "yyyy-mm-dd" }],
  ];
  return writeXlsxFile([
    { data: production, sheet: "Production" },
    { data: defects, sheet: "Defects" },
    { data: reference, sheet: "Reference" },
  ]).toBuffer();
}

export async function buildLegacyApprovalWorkbookBuffer(productionDate) {
  datedSeedIds(productionDate);
  const [year, month, day] = productionDate.split("-");
  const pad = (values) => [
    cell(""),
    cell(""),
    ...values.map((value) => cell(value ?? "", typeof value === "number" ? Number : String)),
  ];
  const groupedHeaders = [
    null, null, null, null, null, null,
    "Time A", null, null, null, null,
    "Time B", null, null, null, null,
    "Time C", null, null, null, null,
    "Time D", null, null, null, null,
    "Time E", null, null, null, null,
  ];
  const slotHeaders = [
    null, null, null, null, null, null,
    "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú",
    "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú",
    "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú",
    "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú",
    "CAPA", "Sản Lượng Thực Tế", "Tỷ Lệ", "Time dừng máy (p)", "Ghi chú",
  ];
  const detail = ({
    shift,
    line,
    model,
    slot,
    capacity,
    actual,
    downtime = 0,
    note = "",
  }) => {
    const values = Array(31).fill(null);
    values[1] = shift;
    values[2] = line;
    values[3] = model;
    const slotStart = 6 + slot * 5;
    values[slotStart] = capacity;
    values[slotStart + 1] = actual;
    values[slotStart + 3] = downtime;
    values[slotStart + 4] = note;
    return pad(values);
  };
  const data = [
    pad([`BÁO CÁO SẢN LƯỢNG CÁC CÔNG ĐOẠN SMD THEO TIME NGÀY ${day}/${month}/${year}`]),
    pad(["Ngày", "Ca", "Line", "Model", null, null, "Sản Lượng Từng Time"]),
    pad(groupedHeaders),
    pad(slotHeaders),
    detail({
      shift: "DAY",
      line: "E2E-LEGACY-LINE",
      model: "E2E-LEGACY-MODEL",
      slot: 0,
      capacity: 720,
      actual: 25,
      downtime: 5,
      note: "E2E legacy DAY/A evidence",
    }),
    detail({
      shift: "NIGHT",
      line: "E2E-LEGACY-LINE",
      model: "E2E-LEGACY-MODEL",
      slot: 1,
      capacity: 1260,
      actual: 30,
      note: "E2E legacy NIGHT/B evidence",
    }),
    detail({
      shift: "DAY",
      line: "E2E-LEGACY-DUPLICATE-LINE",
      model: "E2E-LEGACY-DUPLICATE-MODEL",
      slot: 0,
      capacity: null,
      actual: 45,
      note: "E2E deterministic replacement target",
    }),
  ];
  return writeXlsxFile([{ data, sheet: `${day}.${month}` }]).toBuffer();
}

export function publicSeedManifest(productionDate, processId) {
  const datedIds = datedSeedIds(productionDate);
  return {
    contractVersion: 1,
    productionDate,
    processId,
    employees: Object.fromEntries(Object.entries(SEED_CONTRACT.employees).map(([role, value]) => [
      role,
      { employeeId: value.employeeId, email: value.email, role: value.role },
    ])),
    ids: { ...SEED_CONTRACT.ids, ...datedIds },
    codes: SEED_CONTRACT.codes,
    labels: SEED_CONTRACT.labels,
    records: {
      concurrency: { id: datedIds.concurrencyRecord, ...SEED_CONTRACT.records.concurrency },
      report: { id: datedIds.reportRecord, ...SEED_CONTRACT.records.report },
      edited: SEED_CONTRACT.records.edited,
      dashboardBaselineActual: SEED_CONTRACT.records.dashboardBaselineActual,
      dashboardAfterEditActual: SEED_CONTRACT.records.dashboardAfterEditActual,
    },
  };
}
