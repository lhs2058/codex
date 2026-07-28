import { expect, type Locator, type Page } from "@playwright/test";

export type SeededRole = "operator" | "admin" | "viewer";

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required. Seed the local Supabase E2E fixture and set the explicit E2E environment.`);
  }
  return value;
}

export async function login(page: Page, role: SeededRole, next = "/") {
  const prefix = `E2E_${role.toUpperCase()}`;
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("사번").fill(requiredEnv(`${prefix}_EMPLOYEE_ID`));
  await page.getByLabel("비밀번호").fill(requiredEnv(`${prefix}_PASSWORD`));
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next === "/" ? "/$" : next.replace("/", "\\/")}$`));
}

async function selectConfigured(page: Page, label: string, environmentName: string) {
  await page.getByLabel(label, { exact: true }).selectOption({ label: requiredEnv(environmentName) });
}

export async function fillProductionDraft(
  page: Page,
  productionDate: string,
  quantities: { input: number; actual: number; ok: number; ng: number },
) {
  await page.getByLabel("생산일", { exact: true }).fill(productionDate);
  await selectConfigured(page, "조", "E2E_SHIFT_LABEL");
  await selectConfigured(page, "시간대", "E2E_TIME_SLOT_LABEL");
  await selectConfigured(page, "라인", "E2E_LINE_LABEL");
  await selectConfigured(page, "모델", "E2E_MODEL_LABEL");
  await selectConfigured(page, "공정", "E2E_PROCESS_LABEL");
  await page.getByLabel("투입", { exact: true }).fill(String(quantities.input));
  await page.getByLabel("실적", { exact: true }).fill(String(quantities.actual));
  await page.getByLabel("양품", { exact: true }).fill(String(quantities.ok));
  await page.getByLabel("불량", { exact: true }).fill(String(quantities.ng));
}

export function totalActual(page: Page): Locator {
  return page.locator("article").filter({ hasText: "금일 총 실적" }).locator("strong");
}

export async function assertForbiddenRoute(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "통합 생산 대시보드" })).toBeVisible();
}
