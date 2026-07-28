import { expect, test } from "@playwright/test";
import { assertForbiddenRoute, login } from "./support";

test("viewer can inspect and download reports but has no mutation controls or direct route access", async ({ page }) => {
  await login(page, "viewer");
  await expect(page.getByRole("link", { name: "생산 실적 입력" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "엑셀 업로드" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "기준정보 관리" })).toHaveCount(0);

  for (const path of ["/entry", "/upload", "/admin"]) {
    await assertForbiddenRoute(page, path);
  }

  await page.goto("/analysis");
  await expect(page.getByRole("heading", { name: "상세 분석" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Excel" })).toBeEnabled();
  const excel = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel" }).click();
  await expect((await excel).suggestedFilename()).toMatch(/\.xlsx$/);
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF" }).click();
  await expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);
});
