import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import type { MasterDataSnapshot } from "../../src/domain/types";
import { parseStandardWorkbook } from "../../src/excel/adapters/standard-adapter";
import {
  PRODUCTION_HEADERS,
  buildStandardTemplate,
} from "../../src/excel/template";
import type { WorkbookSheet } from "../../src/excel/contracts";

const masterData: MasterDataSnapshot = {
  models: [
    { id: "m1", code: "MODEL-A", name: "Model A", active: true, version: 1 },
    { id: "m2", code: "MODEL-OFF", name: "Inactive", active: false, version: 2 },
  ],
  processes: [
    { id: "p1", code: "AOI", name: "AOI", active: true },
    { id: "p2", code: "SPI", name: "SPI", active: false },
  ],
  lines: [
    { id: "l1", code: "LINE-1", name: "Line 1", active: true },
    { id: "l2", code: "LINE-OFF", name: "Inactive", active: false },
  ],
  shifts: [
    { id: "s1", code: "DAY", name: "Day", active: true },
    { id: "s2", code: "OFF", name: "Inactive", active: false },
  ],
  timeSlots: [
    { id: "t1", shiftId: "s1", code: "A", startsAt: "08:00", endsAt: "10:00", endDayOffset: 0, sequence: 1 },
    { id: "t2", shiftId: "s2", code: "OFF-A", startsAt: "08:00", endsAt: "10:00", endDayOffset: 0, sequence: 2 },
  ],
  downtimeReasons: [
    { id: "d1", code: "WAIT", name: "Waiting", active: true, version: 1 },
    { id: "d2", code: "OLD", name: "Inactive", active: false, version: 2 },
  ],
  standardTimes: [],
};
const referenceSheet = (version: unknown = 1): WorkbookSheet => ({
  sheet: "Reference",
  data: [["Template Version", version]],
});

describe("standard workbook template", () => {
  it("builds the versioned three-sheet contract with exact headers and active reference data", () => {
    const generatedAt = new Date(2026, 0, 2);
    const template = buildStandardTemplate(masterData, generatedAt);

    expect(template.sheets).toEqual(["Production", "Defects", "Reference"]);
    expect(template.data[0][0][0]).toMatchObject({ value: "SMD_STANDARD_V1" });
    expect(template.data[0][1].map((cell) => cell?.value)).toEqual(PRODUCTION_HEADERS);
    expect(template.data[0][2][0]).toMatchObject({ type: Date, format: "yyyy-mm-dd" });
    for (const column of [6, 7, 8, 9, 10]) {
      expect(template.data[0][2][column]).toMatchObject({ type: Number, format: "#,##0" });
    }

    const referenceValues = template.data[2].flatMap((row) => row.map((cell) => cell?.value));
    expect(referenceValues).toEqual(expect.arrayContaining(["MODEL-A", "LINE-1", "AOI", "DAY", "A", "WAIT"]));
    expect(referenceValues).not.toEqual(expect.arrayContaining(["MODEL-OFF", "LINE-OFF", "SPI", "OFF", "OFF-A", "OLD"]));
    expect(template.data[2][0][1]).toMatchObject({ value: 1, type: Number });
    expect(template.data[2][1][1]).toMatchObject({ value: new Date("2026-01-02T00:00:00.000Z"), type: Date, format: "yyyy-mm-dd" });
  });

  it("produces a real readable XLSX with typed metadata and no formula error values", async () => {
    const template = buildStandardTemplate(masterData, new Date(2026, 0, 2));
    const buffer = await writeXlsxFile(template.data, { ...template.options, sheets: template.sheets, buffer: true });

    await expect(readSheetNames(buffer)).resolves.toEqual(["Production", "Defects", "Reference"]);
    const production = await readXlsxFile(buffer, { sheet: "Production" });
    const reference = await readXlsxFile(buffer, { sheet: "Reference" });
    expect(production[0][0]).toBe("SMD_STANDARD_V1");
    expect(production[1]).toEqual(PRODUCTION_HEADERS);
    expect(reference[0][1]).toBe(1);
    expect(reference[1][1]).toBeInstanceOf(Date);
    expect((reference[1][1] as Date).toISOString().slice(0, 10)).toBe("2026-01-02");
    expect([...production.flat(), ...reference.flat()].filter((cell) => typeof cell === "string" && /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A)$/i.test(cell))).toEqual([]);
  });

  it("parses typed standard rows and emits row diagnostics for invalid counts", () => {
    const result = parseStandardWorkbook([
      {
        sheet: "Production",
        data: [
          ["SMD_STANDARD_V1"],
          PRODUCTION_HEADERS,
          [new Date(2026, 6, 28), "DAY", "A", "LINE-1", "MODEL-A", "AOI", 10, 9, 8, 1, 5, "WAIT", "ok"],
          [new Date(2026, 6, 28), "DAY", "A", "LINE-1", "MODEL-A", "AOI", 10, 9, 8, -1, 0, null, "bad"],
        ],
      },
      referenceSheet(),
    ]);

    expect(result.rows).toEqual([expect.objectContaining({
      productionDate: "2026-07-28",
      shiftCode: "DAY",
      timeSlotCode: "A",
      inputQty: 10,
      actualQty: 9,
      okQty: 8,
      ngQty: 1,
      downtimeMinutes: 5,
    })]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      sourceSheet: "Production",
      sourceRow: 4,
      code: "invalid-count",
    }));
  });

  it("rejects template versions other than 1 before parsing data", () => {
    const result = parseStandardWorkbook([
      {
        sheet: "Production",
        data: [["SMD_STANDARD_V2"], PRODUCTION_HEADERS, [new Date(2026, 6, 28), "DAY", "A", "LINE-1", "MODEL-A", "AOI", 1, 1, 1, 0, 0, null, ""]],
      },
      referenceSheet(),
    ]);

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unsupported-template-version",
      field: "template_version",
    }));
  });

  it.each([
    ["numeric version 2", referenceSheet(2)],
    ["string version", referenceSheet("1")],
    ["missing numeric value", { sheet: "Reference", data: [["Template Version"]] }],
    ["missing Reference sheet", null],
  ] as const)("rejects %s even when the marker remains SMD_STANDARD_V1", (_caseName, reference) => {
    const sheets: WorkbookSheet[] = [{
      sheet: "Production",
      data: [
        ["SMD_STANDARD_V1"],
        PRODUCTION_HEADERS,
        [new Date(2026, 6, 28), "DAY", "A", "LINE-1", "MODEL-A", "AOI", 1, 1, 1, 0, 0, null, ""],
      ],
    }];
    if (reference) sheets.push(reference);

    const result = parseStandardWorkbook(sheets);

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "unsupported-template-version",
      field: "template_version",
    }));
  });

  it("rejects a populated 14th header and data column", () => {
    const result = parseStandardWorkbook([
      {
        sheet: "Production",
        data: [
          ["SMD_STANDARD_V1"],
          [...PRODUCTION_HEADERS, "Unexpected Column"],
          [new Date(2026, 6, 28), "DAY", "A", "LINE-1", "MODEL-A", "AOI", 1, 1, 1, 0, 0, null, "", "unexpected"],
        ],
      },
      referenceSheet(),
    ]);

    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing-required-value",
      field: "headers",
    }));
  });

  it("accepts truly empty trailing header and row cells", () => {
    const result = parseStandardWorkbook([
      {
        sheet: "Production",
        data: [
          ["SMD_STANDARD_V1"],
          [...PRODUCTION_HEADERS, null, ""],
          [new Date(2026, 6, 28), "DAY", "A", "LINE-1", "MODEL-A", "AOI", 1, 1, 1, 0, 0, null, "", null, ""],
        ],
      },
      referenceSheet(),
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });
});
