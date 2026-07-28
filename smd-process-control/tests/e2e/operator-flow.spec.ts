import path from "node:path";
import { expect, test } from "@playwright/test";
import { assertForbiddenRoute, expectDashboardValue, fillProductionDraft, login, requiredEnv, selectConfigured } from "./support";

test("operator logs in, enters production, sees dashboard data, and cannot use admin replacement", async ({ page }) => {
  const productionDate = requiredEnv("E2E_OPERATOR_DATE");
  const actual = Number(requiredEnv("E2E_OPERATOR_ACTUAL"));
  await login(page, "operator", "/entry");

  await expect(page.getByRole("link", { name: "생산 실적 입력" })).toBeVisible();
  await expect(page.getByRole("link", { name: "기준정보 관리" })).toHaveCount(0);
  await fillProductionDraft(page, productionDate, { input: actual + 2, actual, ok: actual - 1, ng: 1 });
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("저장되었습니다.");

  await page.goto("/");
  await page.getByLabel("생산일", { exact: true }).fill(productionDate);
  await selectConfigured(page, "라인", "E2E_LINE_LABEL");
  await expectDashboardValue(page, productionDate, actual);

  await page.goto("/upload");
  await page.getByLabel("엑셀 파일").setInputFiles(path.resolve(requiredEnv("E2E_DUPLICATE_WORKBOOK")));
  await expect(page.getByLabel("업로드 요약")).toBeVisible();
  await expect(page.getByLabel("중복 기록 교체")).toHaveCount(0);

  await assertForbiddenRoute(page, "/admin");
});
