import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseStandardWorkbook } from "../../src/excel/adapters/standard-adapter";
import { parseProductionWorkbook } from "../../src/excel/adapters/production-adapter";
import type { WorkbookSheet } from "../../src/excel/contracts";
import {
  SEED_CONTRACT,
  assertSeedEnvironment,
  buildDuplicateWorkbookBuffer,
  buildLegacyApprovalWorkbookBuffer,
  datedSeedIds,
  publicSeedManifest,
} from "../../scripts/e2e-seed-contract.mjs";

const completeEnvironment = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "local-test-service-role",
  E2E_OPERATOR_PASSWORD: "operator-password",
  E2E_ADMIN_PASSWORD: "admin-password",
  E2E_VIEWER_PASSWORD: "viewer-password",
  E2E_DUPLICATE_WORKBOOK: ".e2e/duplicate-upload.xlsx",
  E2E_LEGACY_WORKBOOK: ".e2e/legacy-master-approval.xlsx",
  E2E_SEED_CONFIRM: "local-only-smd-e2e",
};

describe("local E2E seed contract", () => {
  it("fails closed without every secret, confirmation, and the exact local Supabase target", () => {
    expect(() => assertSeedEnvironment({})).toThrow(/SUPABASE_URL/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, E2E_SEED_CONFIRM: "yes" })).toThrow(/E2E_SEED_CONFIRM/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, SUPABASE_URL: "https://project.supabase.co" })).toThrow(/local Supabase/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, SUPABASE_URL: "http://127.0.0.1:54322" })).toThrow(/local Supabase/);
    expect(assertSeedEnvironment(completeEnvironment).legacyWorkbookPath).toBe(
      path.resolve(process.cwd(), ".e2e/legacy-master-approval.xlsx"),
    );
  });

  it("publishes exact date-stable IDs and values without exposing credentials", () => {
    const manifest = publicSeedManifest("2026-07-28", "process-id-from-migration");
    expect(manifest).toMatchObject({
      productionDate: "2026-07-28",
      processId: "process-id-from-migration",
      records: {
        concurrency: {
          id: datedSeedIds("2026-07-28").concurrencyRecord,
          version: 3,
          actualQty: 100,
        },
        dashboardBaselineActual: 300,
        dashboardAfterEditActual: 310,
      },
    });
    expect(JSON.stringify(manifest)).not.toMatch(/password|service.role|secret/i);
    expect(datedSeedIds("2026-07-28")).toEqual(datedSeedIds("2026-07-28"));
    expect(datedSeedIds("2026-07-29")).not.toEqual(datedSeedIds("2026-07-28"));
  });

  it("generates a real standard workbook containing the exact seeded report duplicate key", async () => {
    const buffer = await buildDuplicateWorkbookBuffer("2026-07-28");
    await expect(readSheetNames(buffer)).resolves.toEqual(["Production", "Defects", "Reference"]);
    const sheets: WorkbookSheet[] = await Promise.all(
      ["Production", "Defects", "Reference"].map(async (sheet) => ({
        sheet,
        data: await readXlsxFile(buffer, { sheet }),
      })),
    );
    const parsed = parseStandardWorkbook(sheets);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rows).toEqual([expect.objectContaining({
      productionDate: "2026-07-28",
      shiftCode: SEED_CONTRACT.codes.shift,
      timeSlotCode: SEED_CONTRACT.codes.reportSlot,
      lineCode: SEED_CONTRACT.codes.line,
      modelCode: SEED_CONTRACT.codes.model,
      processCode: SEED_CONTRACT.codes.process,
      inputQty: 200,
      actualQty: 200,
      okQty: 198,
      ngQty: 2,
    })]);
  });

  it("generates DAY/A and NIGHT/B legacy evidence plus one deterministic duplicate", async () => {
    const buffer = await buildLegacyApprovalWorkbookBuffer("2026-07-28");
    await expect(readSheetNames(buffer)).resolves.toEqual(["28.07"]);
    const parsed = parseProductionWorkbook([{
      sheet: "28.07",
      data: await readXlsxFile(buffer, { sheet: "28.07" }),
    }]);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        productionDate: "2026-07-28",
        shiftCode: "DAY",
        timeSlotCode: "A",
        lineCode: "E2E-LEGACY-LINE",
        modelCode: "E2E-LEGACY-MODEL",
        processCode: "AOI",
        actualQty: 25,
        downtimeMinutes: 5,
      }),
      expect.objectContaining({
        productionDate: "2026-07-28",
        shiftCode: "NIGHT",
        timeSlotCode: "B",
        lineCode: "E2E-LEGACY-LINE",
        modelCode: "E2E-LEGACY-MODEL",
        processCode: "AOI",
        actualQty: 30,
      }),
      expect.objectContaining({
        productionDate: "2026-07-28",
        shiftCode: "DAY",
        timeSlotCode: "A",
        lineCode: "E2E-LEGACY-DUPLICATE-LINE",
        modelCode: "E2E-LEGACY-DUPLICATE-MODEL",
        processCode: "AOI",
        actualQty: 45,
      }),
    ]);
    expect(parsed.capacityEvidence).toEqual([
      expect.objectContaining({ shiftCode: "DAY", timeSlotCode: "A", capacityQty: 720 }),
      expect.objectContaining({ shiftCode: "NIGHT", timeSlotCode: "B", capacityQty: 1260 }),
    ]);
  });

  it("reconciles a second run through stable upserts and recoverable soft retirement only", async () => {
    const source = await readFile(path.resolve(process.cwd(), "scripts/seed-e2e.mjs"), "utf8");
    expect(source).not.toMatch(/\.delete\s*\(/);
    expect(source).toContain("softRetire");
    expect(source).toContain("datedSeedIds(productionDate)");
    expect(source.match(/onConflict:\s*\"id\"/g)?.length).toBeGreaterThanOrEqual(8);
    expect(source).toMatch(/upsert quality records[\s\S]*shift_id: SEED_CONTRACT\.ids\.shift[\s\S]*time_slot_id: SEED_CONTRACT\.ids\.concurrencySlot/);
    expect(source.match(/deleted_by: null/g)?.length).toBeGreaterThanOrEqual(5);
    expect(source.match(/\.eq\("production_date", productionDate\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(publicSeedManifest("2026-07-28", "process-a")).toEqual(
      publicSeedManifest("2026-07-28", "process-a"),
    );
  });
});
