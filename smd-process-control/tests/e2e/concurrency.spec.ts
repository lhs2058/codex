import { expect, test } from "@playwright/test";
import { fillProductionDraft, login, requiredEnv, totalActual } from "./support";

test("stale second context gets record_version_conflict, retains its draft, and dashboard refreshes within five seconds", async ({ browser }) => {
  const productionDate = requiredEnv("E2E_CONCURRENCY_DATE");
  const quantities = { input: 93, actual: 90, ok: 89, ng: 1 };
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
      fillProductionDraft(pageA, productionDate, quantities),
      fillProductionDraft(pageB, productionDate, quantities),
    ]);
    await dashboard.getByLabel("생산일", { exact: true }).fill(productionDate);
    const before = await totalActual(dashboard).innerText();

    await pageA.getByRole("button", { name: "저장", exact: true }).click();
    await expect(pageA.getByRole("alert")).toHaveText("저장되었습니다.");
    await expect.poll(() => totalActual(dashboard).innerText(), { timeout: 5_000 }).not.toBe(before);

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
  } finally {
    await Promise.all([contextA.close(), contextB.close(), dashboardContext.close()]);
  }
});
