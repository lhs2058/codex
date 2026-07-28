import path from "node:path";
import { expect, test } from "@playwright/test";
import { login, requiredEnv } from "./support";

test("admin manages model and standard time, then explicitly replaces duplicate upload rows", async ({ page }) => {
  await login(page, "admin", "/admin");
  await expect(page.getByRole("link", { name: "기준정보 관리" })).toBeVisible();

  await page.getByLabel("모델 코드").fill(requiredEnv("E2E_ADMIN_MODEL_CODE"));
  await page.getByLabel("모델명").fill(requiredEnv("E2E_ADMIN_MODEL_NAME"));
  const modelResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/rest/v1/models"));
  await page.getByRole("button", { name: "모델 추가" }).click();
  const createdModel = await (await modelResponse).json() as { id?: string };
  expect(createdModel.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByLabel("모델 코드")).toHaveValue("");

  await page.getByLabel("표준시간 모델").fill(createdModel.id!);
  await page.getByLabel("공정", { exact: true }).selectOption({ label: requiredEnv("E2E_PROCESS_LABEL") });
  await page.getByLabel("라인", { exact: true }).selectOption({ label: requiredEnv("E2E_LINE_LABEL") });
  await page.getByLabel("개당 초").fill(requiredEnv("E2E_ST_SECONDS"));
  await page.getByLabel("적용 시작일").fill(requiredEnv("E2E_ST_EFFECTIVE_FROM"));
  await page.getByRole("button", { name: "표준시간 저장" }).click();
  await expect(page.getByLabel("개당 초")).toHaveValue("");

  await page.goto("/upload");
  await page.getByLabel("엑셀 파일").setInputFiles(path.resolve(requiredEnv("E2E_DUPLICATE_WORKBOOK")));
  await expect(page.getByLabel("업로드 요약")).toContainText("중복");
  const replace = page.getByLabel("중복 기록 교체");
  await expect(replace).toBeVisible();
  await replace.check();
  await page.getByRole("button", { name: "업로드 저장" }).click();
  await expect(page.getByRole("status")).toContainText("교체");
});
