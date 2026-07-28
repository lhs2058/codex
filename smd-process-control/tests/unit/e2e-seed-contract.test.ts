import readXlsxFile, { readSheetNames } from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseStandardWorkbook } from "../../src/excel/adapters/standard-adapter";
import type { WorkbookSheet } from "../../src/excel/contracts";
import {
  SEED_CONTRACT,
  assertSeedEnvironment,
  buildDuplicateWorkbookBuffer,
  publicSeedManifest,
} from "../../scripts/e2e-seed-contract.mjs";

const completeEnvironment = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "local-test-service-role",
  E2E_OPERATOR_PASSWORD: "operator-password",
  E2E_ADMIN_PASSWORD: "admin-password",
  E2E_VIEWER_PASSWORD: "viewer-password",
  E2E_DUPLICATE_WORKBOOK: ".e2e/duplicate-upload.xlsx",
  E2E_SEED_CONFIRM: "local-only-smd-e2e",
};

describe("local E2E seed contract", () => {
  it("fails closed without every secret, confirmation, and the exact local Supabase target", () => {
    expect(() => assertSeedEnvironment({})).toThrow(/SUPABASE_URL/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, SUPABASE_SERVICE_ROLE_KEY: "" })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, E2E_SEED_CONFIRM: "yes" })).toThrow(/E2E_SEED_CONFIRM/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, SUPABASE_URL: "https://project.supabase.co" })).toThrow(/local Supabase/);
    expect(() => assertSeedEnvironment({ ...completeEnvironment, SUPABASE_URL: "http://127.0.0.1:54322" })).toThrow(/local Supabase/);
  });

  it("publishes exact stable IDs and values without exposing credentials", () => {
    const manifest = publicSeedManifest("2026-07-28", "process-id-from-migration");
    expect(manifest).toMatchObject({
      productionDate: "2026-07-28",
      processId: "process-id-from-migration",
      records: {
        concurrency: {
          id: SEED_CONTRACT.ids.concurrencyRecord,
          version: 3,
          actualQty: 100,
        },
        dashboardBaselineActual: 300,
        dashboardAfterEditActual: 310,
      },
    });
    expect(JSON.stringify(manifest)).not.toMatch(/password|service.role|secret/i);
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
});
