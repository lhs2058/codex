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

export async function selectConfigured(page: Page, label: string, environmentName: string) {
  await page.getByRole("combobox", { name: label, exact: true })
    .selectOption({ label: requiredEnv(environmentName) });
}

export async function selectProductionNaturalKey(
  page: Page,
  productionDate: string,
  environment = {
    shift: "E2E_SHIFT_LABEL",
    timeSlot: "E2E_TIME_SLOT_LABEL",
    line: "E2E_LINE_LABEL",
    model: "E2E_MODEL_LABEL",
    process: "E2E_PROCESS_LABEL",
  },
) {
  await page.getByLabel("생산일", { exact: true }).fill(productionDate);
  await selectConfigured(page, "조", environment.shift);
  await selectConfigured(page, "시간대", environment.timeSlot);
  await selectConfigured(page, "라인", environment.line);
  await selectConfigured(page, "모델", environment.model);
  await selectConfigured(page, "공정", environment.process);
}

export async function fillProductionDraft(
  page: Page,
  productionDate: string,
  quantities: { input: number; actual: number; ok: number; ng: number },
) {
  await selectProductionNaturalKey(page, productionDate);
  await expect(page.getByTestId("production-entry-form")).toHaveAttribute("data-record-state", "new");
  await page.getByLabel("투입", { exact: true }).fill(String(quantities.input));
  await page.getByLabel("실적", { exact: true }).fill(String(quantities.actual));
  await page.getByLabel("양품", { exact: true }).fill(String(quantities.ok));
  await page.getByLabel("불량", { exact: true }).fill(String(quantities.ng));
}

export function totalActual(page: Page): Locator {
  return page.locator("article").filter({ hasText: "금일 총 실적" }).locator("strong");
}

export async function expectDashboardValue(page: Page, productionDate: string, total: number) {
  const dashboard = page.getByTestId("dashboard-main");
  await expect(dashboard).toHaveAttribute("data-dashboard-date", productionDate);
  await expect(dashboard).toHaveAttribute("data-dashboard-state", "ready");
  await expect(dashboard).toHaveAttribute("data-dashboard-total-actual", String(total));
  await expect(totalActual(page)).toContainText(total.toLocaleString("ko-KR"));
}

export async function assertForbiddenRoute(page: Page, path: string) {
  await page.goto(path);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "통합 생산 대시보드" })).toBeVisible();
}
