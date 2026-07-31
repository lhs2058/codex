import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ko } from "../../src/i18n/ko";
import { login, requiredEnv, selectConfigured } from "./support";

const LEGACY = Object.freeze({
  modelCode: "E2E-LEGACY-MODEL",
  lineCode: "E2E-LEGACY-LINE",
  process: "AOI",
});

async function approveCandidate(page: Page, label: string) {
  const checkbox = page.getByLabel(label, { exact: true });
  await expect(checkbox).toBeEnabled();
  await checkbox.check();
}

test("operator stages a legacy workbook and an admin reopens, approves, replaces, and verifies it end to end", async ({ browser }) => {
  const workbook = path.resolve(requiredEnv("E2E_LEGACY_WORKBOOK"));
  const workbookName = path.basename(workbook);
  const operatorContext = await browser.newContext();
  const adminContext = await browser.newContext();
  try {
    const operator = await operatorContext.newPage();
    await login(operator, "operator", "/upload");
    await operator.getByLabel("엑셀 파일").setInputFiles(workbook);

    const operatorSummary = operator.getByLabel("업로드 요약");
    await expect(operatorSummary).toContainText("신규: 2");
    await expect(operatorSummary).toContainText("중복: 1");
    await expect(operatorSummary).toContainText("오류: 0");
    await expect(operator.getByLabel(`model ${LEGACY.modelCode} 승인`)).toBeDisabled();
    await expect(operator.getByLabel(`line ${LEGACY.lineCode} 승인`)).toBeDisabled();
    await expect(operator.getByLabel("shift NIGHT 승인")).toBeDisabled();
    await expect(operator.getByLabel("time_slot B 승인")).toBeDisabled();
    await expect(operator.getByLabel("중복 교체")).toBeDisabled();
    await expect(operator.getByRole("button", {
      name: ko["upload.commitFinal"],
      exact: true,
    })).toBeDisabled();

    const admin = await adminContext.newPage();
    await login(admin, "admin", "/upload");
    await admin.getByRole("button", {
      name: `${workbookName} 배치 열기`,
      exact: true,
    }).click();
    await expect(admin.getByLabel("원본 워크북")).toContainText(workbookName);

    await approveCandidate(admin, `model ${LEGACY.modelCode} 승인`);
    await approveCandidate(admin, `line ${LEGACY.lineCode} 승인`);
    await approveCandidate(admin, "shift NIGHT 승인");
    await approveCandidate(admin, "time_slot B 승인");
    await expect(admin.getByLabel("downtime_reason LEGACY_UNSPECIFIED 승인")).toBeChecked();
    await expect(admin.getByLabel("downtime_reason LEGACY_UNSPECIFIED 승인")).toBeDisabled();
    await approveCandidate(
      admin,
      `${LEGACY.modelCode} ${LEGACY.lineCode} ${LEGACY.process} 표준시간(ST) 승인`,
    );
    await admin.getByLabel("중복 교체").check();
    await admin.getByRole("button", {
      name: ko["upload.commitFinal"],
      exact: true,
    }).click();

    await expect(admin.getByRole("status")).toContainText(
      "반영 완료: 신규 2건, 교체 1건, 건너뛰기 0건, 기준정보 4건, 표준시간(ST) 1건",
    );

    await admin.goto("/entry");
    await admin.getByLabel("생산일", { exact: true }).fill(requiredEnv("E2E_OPERATOR_DATE"));
    await selectConfigured(admin, "조", "E2E_SHIFT_LABEL");
    await selectConfigured(admin, "시간대", "E2E_TIME_SLOT_LABEL");
    await admin.getByLabel("라인", { exact: true }).selectOption({ label: LEGACY.lineCode });
    await admin.getByLabel("모델", { exact: true }).selectOption({ label: LEGACY.modelCode });
    await admin.getByLabel("공정", { exact: true }).selectOption({ label: LEGACY.process });
    await expect(admin.getByTestId("production-entry-form")).toHaveAttribute("data-record-state", "new");
    await admin.getByLabel("투입", { exact: true }).fill("10");
    await admin.getByLabel("실적", { exact: true }).fill("10");
    await admin.getByLabel("양품", { exact: true }).fill("9");
    await admin.getByLabel("불량", { exact: true }).fill("1");
    await admin.getByRole("button", { name: "저장", exact: true }).click();
    await expect(admin.getByRole("alert")).toHaveText("저장되었습니다.");

    await admin.goto("/");
    await admin.getByLabel("생산일", { exact: true }).fill(requiredEnv("E2E_OPERATOR_DATE"));
    await admin.getByLabel("모델", { exact: true }).selectOption({
      label: `${LEGACY.modelCode} · ${LEGACY.modelCode}`,
    });
    await admin.getByLabel("라인", { exact: true }).selectOption({ label: LEGACY.lineCode });
    await admin.getByLabel("공정", { exact: true }).selectOption({ label: LEGACY.process });
    const dashboard = admin.getByTestId("dashboard-main");
    await expect(dashboard).toHaveAttribute("data-dashboard-state", "ready");
    await expect(dashboard).toHaveAttribute("data-dashboard-total-actual", "65");
    const yieldTable = admin.getByRole("table", { name: "공정별 라인 수율" });
    const yieldRow = yieldTable.getByRole("row", { name: /AOI.*90\.0%/ });
    await expect(yieldTable).toContainText(LEGACY.lineCode);
    await expect(yieldRow).toContainText("90.0%");
    await expect(yieldRow).not.toContainText("산출 불가");
    await expect(admin.getByRole("region", { name: "라인 가동률" })).toContainText(LEGACY.lineCode);
    await expect(admin.getByRole("region", { name: "라인 가동률" })).toContainText("%");

    let secondBatchInsert = 0;
    admin.on("request", (request) => {
      if (request.method() === "POST" && /\/rest\/v1\/upload_batches(?:\?|$)/.test(request.url())) {
        secondBatchInsert += 1;
      }
    });
    await admin.goto("/upload");
    await admin.getByLabel("엑셀 파일").setInputFiles(workbook);
    await expect(admin.getByRole("status")).toContainText("이미 반영이 완료된 워크북입니다.");
    expect(secondBatchInsert).toBe(0);
  } finally {
    await operatorContext.close();
    await adminContext.close();
  }
});
