import { expect, test } from "@playwright/test";
import { SEED_CONTRACT } from "../../scripts/e2e-seed-contract.mjs";
import {
  expectDashboardValue,
  login,
  requiredEnv,
  selectConfigured,
  selectProductionNaturalKey,
} from "./support";

test("stale second context gets record_version_conflict, retains its draft, and dashboard refreshes within five seconds", async ({ browser }) => {
  const productionDate = requiredEnv("E2E_CONCURRENCY_DATE");
  const quantities = {
    input: SEED_CONTRACT.records.edited.inputQty,
    actual: SEED_CONTRACT.records.edited.actualQty,
    ok: SEED_CONTRACT.records.edited.okQty,
    ng: SEED_CONTRACT.records.edited.ngQty,
  };
  const naturalEnvironment = {
    shift: "E2E_SHIFT_LABEL",
    timeSlot: "E2E_CONCURRENCY_TIME_SLOT_LABEL",
    line: "E2E_CONCURRENCY_LINE_LABEL",
    model: "E2E_MODEL_LABEL",
    process: "E2E_PROCESS_LABEL",
  };
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const dashboardContext = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const dashboard = await dashboardContext.newPage();
  try {
    await Promise.all([
      login(pageA, "operator", "/entry"),
      login(pageB, "operator", "/entry"),
      login(dashboard, "viewer"),
    ]);
    await Promise.all([
      selectProductionNaturalKey(pageA, productionDate, naturalEnvironment),
      selectProductionNaturalKey(pageB, productionDate, naturalEnvironment),
    ]);
    for (const page of [pageA, pageB]) {
      const form = page.getByTestId("production-entry-form");
      await expect(form).toHaveAttribute("data-record-id", SEED_CONTRACT.ids.concurrencyRecord);
      await expect(form).toHaveAttribute("data-record-state", "existing");
      await expect(form).toHaveAttribute("data-record-version", String(SEED_CONTRACT.records.concurrency.version));
      await expect(page.getByLabel("실적", { exact: true })).toHaveValue(String(SEED_CONTRACT.records.concurrency.actualQty));
      await page.getByLabel("투입", { exact: true }).fill(String(quantities.input));
      await page.getByLabel("실적", { exact: true }).fill(String(quantities.actual));
      await page.getByLabel("양품", { exact: true }).fill(String(quantities.ok));
      await page.getByLabel("불량", { exact: true }).fill(String(quantities.ng));
    }
    await dashboard.getByLabel("생산일", { exact: true }).fill(productionDate);
    await selectConfigured(dashboard, "라인", "E2E_CONCURRENCY_LINE_LABEL");
    await expectDashboardValue(dashboard, productionDate, SEED_CONTRACT.records.dashboardBaselineActual);

    await pageA.getByRole("button", { name: "저장", exact: true }).click();
    await expect(pageA.getByRole("alert")).toHaveText("저장되었습니다.");
    await expect(pageA.getByTestId("production-entry-form")).toHaveAttribute(
      "data-record-version",
      String(SEED_CONTRACT.records.concurrency.version + 1),
    );
    await expectDashboardValue(dashboard, productionDate, SEED_CONTRACT.records.dashboardAfterEditActual);

    const conflictResponse = pageB.waitForResponse((response) =>
      response.url().includes("/rpc/save_production_record"));
    await pageB.getByRole("button", { name: "저장", exact: true }).click();
    const response = await conflictResponse;
    expect(await response.text()).toContain("record_version_conflict");
    await expect(pageB.getByRole("alert")).toContainText("다른 사용자가 수정했습니다.");
    await expect(pageB.getByLabel("투입", { exact: true })).toHaveValue(String(quantities.input));
    await expect(pageB.getByLabel("실적", { exact: true })).toHaveValue(String(quantities.actual));
    await expect(pageB.getByLabel("양품", { exact: true })).toHaveValue(String(quantities.ok));
    await expect(pageB.getByLabel("불량", { exact: true })).toHaveValue(String(quantities.ng));
    await expect(pageB.getByTestId("production-entry-form")).toHaveAttribute(
      "data-record-version",
      String(SEED_CONTRACT.records.concurrency.version),
    );
  } finally {
    await Promise.all([contextA.close(), contextB.close(), dashboardContext.close()]);
  }
});
