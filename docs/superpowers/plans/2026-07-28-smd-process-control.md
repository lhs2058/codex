# SMD Process Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 사용자가 동시에 시간대별 SMD 실적을 입력하고 SPI·AOI·X-ray·ICT·Router 수율과 ST 기준 라인 가동률을 실시간으로 관리하는 독립 웹 시스템을 구축한다.

**Architecture:** `smd-process-control` 독립 React 애플리케이션이 전용 Supabase 프로젝트의 Auth, PostgreSQL, Realtime, Storage를 사용한다. 도메인 계산, Excel 변환, 데이터 저장, 화면 표시를 분리하고 모든 업무 테이블은 RLS로 보호한다.

**Tech Stack:** React 19, TypeScript, Vite, React Router, Supabase JS, Zod, read-excel-file, write-excel-file, jsPDF, Vitest, Testing Library, Playwright, Supabase CLI/PostgreSQL

## Global Constraints

- 기존 ACM·ACK 인력현황 앱의 코드, 데이터, 배포 설정을 변경하지 않는다.
- 새 앱은 `smd-process-control` 디렉터리와 전용 Supabase 프로젝트를 사용한다.
- 업무 기준 시간대는 `Asia/Bangkok`이다.
- 화면은 한국어와 베트남어를 지원한다.
- 역할은 `operator`, `admin`, `viewer` 세 가지다.
- 공정 코드는 `SPI`, `AOI`, `XRAY`, `ICT`, `ROUTER`로 고정한다.
- ST 단위는 초/개이며 모델 × 공정 × 라인 × 적용 기간으로 버전 관리한다.
- 수율은 `OK / Input × 100`으로 계산한다.
- 가동률은 `실적 × 유효 ST / (계획시간 - 비가동시간) × 100`으로 계산한다.
- 원본 Excel과 감사 이력은 업무 데이터가 삭제돼도 보존한다.
- 업로드는 검증과 저장을 분리하고 오류가 있으면 자동 부분 저장하지 않는다.
- 정상 네트워크에서 저장 결과는 5초 이내에 다른 사용자 대시보드에 반영한다.

---

## File Structure

```text
smd-process-control/
  package.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  tsconfig.json
  .env.example
  src/
    app/
      App.tsx
      routes.tsx
      providers.tsx
    auth/
      auth-service.ts
      employee-id.ts
      RequireRole.tsx
      LoginPage.tsx
    domain/
      types.ts
      calculations.ts
      validation.ts
      time.ts
    data/
      supabase.ts
      repositories/
        master-data-repository.ts
        production-repository.ts
        quality-repository.ts
        upload-repository.ts
    features/
      dashboard/
        DashboardPage.tsx
        YieldMatrix.tsx
        UtilizationBars.tsx
        EntryProgress.tsx
      entry/
        ProductionEntryPage.tsx
        ProductionEntryForm.tsx
        DowntimeEditor.tsx
      upload/
        UploadPage.tsx
        UploadReviewTable.tsx
      analysis/
        AnalysisPage.tsx
        TrendChart.tsx
        DefectTable.tsx
      admin/
        AdminPage.tsx
        MasterDataEditor.tsx
        StandardTimeEditor.tsx
        UserEditor.tsx
    excel/
      contracts.ts
      normalize.ts
      detect-workbook.ts
      adapters/
        aoi-adapter.ts
        spi-adapter.ts
        ict-adapter.ts
        xray-adapter.ts
        production-adapter.ts
        standard-adapter.ts
      template.ts
    exports/
      excel-report.ts
      pdf-report.ts
    i18n/
      index.ts
      ko.ts
      vi.ts
    styles/
      globals.css
      dashboard.css
  tests/
    unit/
    integration/
    fixtures/
    e2e/
  supabase/
    config.toml
    migrations/
      001_core_schema.sql
      002_constraints_indexes.sql
      003_rls.sql
      004_functions.sql
      005_seed_processes.sql
    functions/
      admin-create-user/index.ts
    tests/
      schema.test.sql
      rls.test.sql
      import.test.sql
  public/
    icon.svg
```

각 파일은 한 가지 책임만 가진다. 계산 모듈은 Supabase나 React를 모르고, Excel 어댑터는 UI를 모르며, 화면은 저장 프로시저의 내부 구현을 모른다.

## Shared Interface Contracts

Task 2의 `src/domain/types.ts`에서 다음 공통 타입을 정의하고 이후 Task는 이름과 필드를 그대로 사용한다.

```ts
export type AppRole = "operator" | "admin" | "viewer";
export type ProcessCode = "SPI" | "AOI" | "XRAY" | "ICT" | "ROUTER";
export type WorkbookKind = "aoi" | "spi" | "ict" | "xray" | "production" | "standard" | "unknown";
export type ImportRowErrorCode =
  | "missing-required-value"
  | "unknown-model"
  | "unknown-line"
  | "unknown-process"
  | "invalid-count"
  | "duplicate-record"
  | "unsupported-template-version";

export interface StandardTime {
  id: string;
  modelId: string;
  processId: string;
  lineId: string;
  secondsPerUnit: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export type StandardTimeInput = Omit<StandardTime, "id">;

export interface TimeSlot {
  id: string;
  shiftId: string;
  code: string;
  startsAt: string;
  endsAt: string;
  endDayOffset: 0 | 1;
  sequence: number;
}

export interface MasterDataSnapshot {
  models: Array<{ id: string; code: string; name: string; active: boolean }>;
  processes: Array<{ id: string; code: ProcessCode; name: string; active: boolean }>;
  lines: Array<{ id: string; code: string; name: string; active: boolean }>;
  shifts: Array<{ id: string; code: string; name: string; active: boolean }>;
  timeSlots: TimeSlot[];
  downtimeReasons: Array<{ id: string; code: string; name: string; active: boolean }>;
  standardTimes: StandardTime[];
}

export interface DowntimeDraft {
  reasonId: string;
  minutes: number;
  note: string;
}

export interface ProductionEntryDraft {
  productionDate: string;
  shiftId: string;
  timeSlotId: string;
  lineId: string;
  modelId: string;
  processId: string;
  inputQty: number;
  actualQty: number;
  okQty: number;
  ngQty: number;
  note: string;
  downtime: DowntimeDraft[];
}

export interface ProductionPreview {
  standardTime: StandardTime | null;
  yieldResult: MetricResult;
  utilizationResult: MetricResult;
  plannedSeconds: number;
  downtimeSeconds: number;
}

export interface WorkbookSheet {
  sheet: string;
  data: unknown[][];
}

export interface WorkbookDetection {
  kind: WorkbookKind;
  diagnostics: Array<{ code: "ambiguous-workbook"; message: string }>;
}

export interface NormalizedImportRow {
  sourceSheet: string;
  sourceRow: number;
  productionDate: string;
  shiftCode: string;
  timeSlotCode: string | null;
  lineCode: string;
  modelCode: string;
  processCode: ProcessCode;
  inputQty: number;
  actualQty: number;
  okQty: number;
  ngQty: number;
  downtimeMinutes: number;
  downtimeReasonCode: string | null;
  note: string;
}

export interface ImportDiagnostic {
  sourceSheet: string;
  sourceRow: number;
  code: ImportRowErrorCode | "ambiguous-workbook";
  message: string;
}

export interface ImportParseResult {
  kind: WorkbookKind;
  rows: NormalizedImportRow[];
  diagnostics: ImportDiagnostic[];
}

export interface UploadReview {
  batchId: string;
  newCount: number;
  conflictCount: number;
  errorCount: number;
  unknownMasterDataCount: number;
  rows: Array<NormalizedImportRow & { status: "new" | "conflict" | "error"; messages: string[] }>;
}

export interface UploadCommitResult {
  batchId: string;
  insertedCount: number;
  replacedCount: number;
}

export interface DashboardFilters {
  productionDate: string;
  shiftId: string | null;
  modelId: string | null;
  lineId: string | null;
  processCode: ProcessCode | null;
}

export interface DashboardSnapshot {
  totalActual: number;
  weightedYield: MetricResult;
  weightedUtilization: MetricResult;
  attentionCount: number;
  yields: Array<{ processCode: ProcessCode; lineId: string; result: MetricResult }>;
  utilization: Array<{ lineId: string; result: MetricResult }>;
  entryProgress: Array<{ timeSlotId: string; status: "complete" | "in-progress" | "waiting" }>;
}

export interface AnalysisFilters {
  from: string;
  to: string;
  groupBy: "day" | "week" | "month";
  shiftId: string | null;
  modelId: string | null;
  lineId: string | null;
  processCode: ProcessCode | null;
}

export interface AnalysisDataset {
  filters: AnalysisFilters;
  yieldSeries: Array<{ period: string; inputQty: number; okQty: number; target: number | null }>;
  utilizationSeries: Array<{ period: string; actualQty: number; productiveSeconds: number; netSeconds: number }>;
  downtime: Array<{ reason: string; minutes: number }>;
  defects: Array<{ type: string; classification: "pseudo" | "real" | "scrap"; quantity: number }>;
}
```

---

### Task 1: 독립 앱 골격과 테스트 실행 환경

**Files:**
- Create: `smd-process-control/package.json`
- Create: `smd-process-control/vite.config.ts`
- Create: `smd-process-control/vitest.config.ts`
- Create: `smd-process-control/playwright.config.ts`
- Create: `smd-process-control/tsconfig.json`
- Create: `smd-process-control/.env.example`
- Create: `smd-process-control/index.html`
- Create: `smd-process-control/src/main.tsx`
- Create: `smd-process-control/src/app/App.tsx`
- Create: `smd-process-control/src/app/providers.tsx`
- Create: `smd-process-control/src/styles/globals.css`
- Test: `smd-process-control/tests/unit/app-smoke.test.tsx`

**Interfaces:**
- Produces: 독립 실행 명령 `npm run dev`, `npm test`, `npm run build`, `npm run test:e2e`
- Produces: `AppProviders({ children }: PropsWithChildren)`

- [ ] **Step 1: 실패하는 앱 스모크 테스트 작성**

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "../../src/app/App";

it("renders the SMD application shell", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "SMD CONTROL" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd smd-process-control && npm test -- app-smoke.test.tsx`

Expected: FAIL because `src/app/App.tsx` does not exist.

- [ ] **Step 3: Vite·TypeScript·React 테스트 설정과 최소 앱 작성**

`package.json`에 `react`, `react-dom`, `react-router-dom`, `@supabase/supabase-js`, `zod`, `read-excel-file`, `write-excel-file`, `jspdf`와 테스트 도구를 선언한다. `App.tsx`의 첫 구현은 다음 계약을 만족한다.

```tsx
export function App() {
  return (
    <main>
      <h1>SMD CONTROL</h1>
    </main>
  );
}
```

`.env.example`에는 비밀값 없이 변수 이름만 둔다.

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

- [ ] **Step 4: 테스트와 프로덕션 빌드 확인**

Run: `cd smd-process-control && npm test -- app-smoke.test.tsx && npm run build`

Expected: PASS and `dist/index.html` exists.

- [ ] **Step 5: 커밋**

```bash
git add smd-process-control
git commit -m "feat(smd): scaffold independent process control app"
```

---

### Task 2: 도메인 타입, 시간 계산, 수율·가동률 엔진

**Files:**
- Create: `smd-process-control/src/domain/types.ts`
- Create: `smd-process-control/src/domain/calculations.ts`
- Create: `smd-process-control/src/domain/time.ts`
- Test: `smd-process-control/tests/unit/calculations.test.ts`
- Test: `smd-process-control/tests/unit/time.test.ts`

**Interfaces:**
- Produces: `calculateYield(input: number, ok: number): MetricResult`
- Produces: `calculateUtilization(actual: number, standardTimeSeconds: number | null, plannedSeconds: number, downtimeSeconds: number): MetricResult`
- Produces: `slotDurationSeconds(start: string, end: string, endDayOffset: 0 | 1): number`

- [ ] **Step 1: 경계값을 포함한 실패 테스트 작성**

```ts
expect(calculateYield(1000, 995)).toEqual({ status: "ok", value: 99.5 });
expect(calculateYield(0, 0)).toEqual({ status: "not-calculable", reason: "zero-input" });
expect(calculateUtilization(800, 1.5, 1800, 300)).toEqual({ status: "ok", value: 80 });
expect(calculateUtilization(800, null, 1800, 0)).toEqual({ status: "not-calculable", reason: "missing-st" });
expect(slotDurationSeconds("22:00", "02:00", 1)).toBe(14400);
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd smd-process-control && npm test -- calculations.test.ts time.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: 명시적 결과 타입과 계산 함수 구현**

```ts
export type MetricResult =
  | { status: "ok"; value: number }
  | { status: "not-calculable"; reason: "zero-input" | "missing-st" | "zero-net-time" };

export function calculateYield(input: number, ok: number): MetricResult {
  if (input === 0) return { status: "not-calculable", reason: "zero-input" };
  return { status: "ok", value: (ok / input) * 100 };
}

export function calculateUtilization(
  actual: number,
  standardTimeSeconds: number | null,
  plannedSeconds: number,
  downtimeSeconds: number,
): MetricResult {
  if (standardTimeSeconds === null) return { status: "not-calculable", reason: "missing-st" };
  const netSeconds = plannedSeconds - downtimeSeconds;
  if (netSeconds <= 0) return { status: "not-calculable", reason: "zero-net-time" };
  return { status: "ok", value: (actual * standardTimeSeconds * 100) / netSeconds };
}
```

- [ ] **Step 4: 음수와 잘못된 시간 조합 테스트 추가 및 방어 구현**

`calculateYield(-1, 0)`, `calculateYield(10, 11)`, `slotDurationSeconds("25:00", "02:00", 1)`이 `DomainValidationError`를 던지는지 검증한다.

- [ ] **Step 5: 전체 단위 테스트 확인**

Run: `cd smd-process-control && npm test -- tests/unit`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add smd-process-control/src/domain smd-process-control/tests/unit
git commit -m "feat(smd): add yield and utilization domain engine"
```

---

### Task 3: PostgreSQL 스키마, 제약, 인덱스

**Files:**
- Create: `smd-process-control/supabase/config.toml`
- Create: `smd-process-control/supabase/migrations/001_core_schema.sql`
- Create: `smd-process-control/supabase/migrations/002_constraints_indexes.sql`
- Create: `smd-process-control/supabase/migrations/005_seed_processes.sql`
- Test: `smd-process-control/supabase/tests/schema.test.sql`

**Interfaces:**
- Produces: `profiles`, `models`, `processes`, `lines`, `shifts`, `time_slots`, `downtime_reasons`, `yield_targets`
- Produces: `standard_times`, `production_records`, `quality_records`, `defect_records`, `downtime_records`
- Produces: `upload_batches`, `upload_rows`, `audit_logs`

- [ ] **Step 1: 실패하는 pgTAP 스키마 테스트 작성**

```sql
select plan(7);
select has_table('public', 'production_records');
select has_table('public', 'standard_times');
select col_type_is('public', 'standard_times', 'seconds_per_unit', 'numeric');
select has_index('public', 'production_records', 'production_records_unique_slot');
select has_check('public', 'quality_records', 'quality_counts_valid');
select results_eq(
  $$select code from public.processes order by code$$,
  $$values ('AOI'), ('ICT'), ('ROUTER'), ('SPI'), ('XRAY')$$
);
select pass('core schema inspected');
select finish();
```

- [ ] **Step 2: 로컬 DB에서 실패 확인**

Run: `cd smd-process-control && npx supabase start && npx supabase test db supabase/tests/schema.test.sql`

Expected: FAIL because tables do not exist.

- [ ] **Step 3: 핵심 테이블과 외래키 작성**

UUID 기본키, `created_at`, `created_by`, `updated_at`, `updated_by`, `version bigint default 1`을 업무 테이블에 적용한다. `production_records`의 유일 제약은 다음과 같다.

```sql
create unique index production_records_unique_slot
on public.production_records (
  production_date, shift_id, time_slot_id, line_id, model_id, process_id
)
where deleted_at is null;
```

- [ ] **Step 4: 품질 수량과 ST 기간 제약 작성**

```sql
alter table public.quality_records
  add constraint quality_counts_valid
  check (input_qty >= 0 and ok_qty >= 0 and ng_qty >= 0
    and ok_qty <= input_qty and ok_qty + ng_qty <= input_qty);

alter table public.standard_times
  add constraint standard_times_positive check (seconds_per_unit > 0);
```

`btree_gist`와 날짜 범위를 사용해 같은 모델·공정·라인의 ST 적용 기간 중복을 차단한다.

- [ ] **Step 5: 공정 seed와 인덱스 작성**

공정 코드를 정확히 `SPI`, `AOI`, `XRAY`, `ICT`, `ROUTER`로 넣고 날짜·라인·모델·공정 필터용 복합 인덱스를 추가한다.

- [ ] **Step 6: DB 테스트 통과 확인**

Run: `cd smd-process-control && npx supabase db reset && npx supabase test db`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add smd-process-control/supabase
git commit -m "feat(smd): define process control database schema"
```

---

### Task 4: RLS, 감사 로그, 원자적 저장 함수

**Files:**
- Create: `smd-process-control/supabase/migrations/003_rls.sql`
- Create: `smd-process-control/supabase/migrations/004_functions.sql`
- Test: `smd-process-control/supabase/tests/rls.test.sql`
- Test: `smd-process-control/supabase/tests/import.test.sql`

**Interfaces:**
- Produces: `current_app_role() returns text`
- Produces: `save_production_record(payload jsonb, expected_version bigint) returns uuid`
- Produces: `commit_upload_batch(batch_id uuid, replace_conflicts boolean) returns jsonb`

- [ ] **Step 1: 역할별 실패 테스트 작성**

테스트 사용자 JWT의 `sub`를 바꾸며 다음을 검증한다.

```sql
select throws_ok(
  $$insert into public.models(code, name) values ('PE-35', 'PE-35')$$,
  '42501'
);
```

`viewer`는 쓰기 실패, `operator`는 실적 작성 성공·기준정보 작성 실패, `admin`은 전체 성공이어야 한다.

- [ ] **Step 2: RLS 적용 전 테스트 실패 확인**

Run: `cd smd-process-control && npx supabase test db supabase/tests/rls.test.sql`

Expected: FAIL because unauthorized writes are not blocked.

- [ ] **Step 3: 모든 업무 테이블에 RLS와 역할 정책 작성**

`profiles.id = auth.uid()`로 역할을 찾는다. 조회자는 활성 업무 데이터만 읽고, 작업자는 자신이 작성한 `Asia/Bangkok` 당일 레코드만 수정하며, 관리자는 전체 접근한다.

- [ ] **Step 4: 버전 충돌을 감지하는 저장 함수 작성**

```sql
if target.version <> expected_version then
  raise exception using errcode = '40001', message = 'record_version_conflict';
end if;
```

저장 성공 시 `version = version + 1`과 감사 로그 기록을 같은 트랜잭션에서 수행한다.

- [ ] **Step 5: 업로드 배치 원자 저장 함수 작성**

오류 행이 하나라도 있으면 `upload_batch_has_errors`, 중복이 있고 관리자 교체가 아니면 `upload_batch_has_conflicts`를 발생시킨다. 성공 시 모든 staged 행을 저장하고 배치 상태를 `committed`로 변경한다.

- [ ] **Step 6: DB 테스트 통과 확인**

Run: `cd smd-process-control && npx supabase db reset && npx supabase test db`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add smd-process-control/supabase
git commit -m "feat(smd): enforce roles audit and atomic writes"
```

---

### Task 5: 사번 로그인, 관리자 계정 생성, 경로 보호

**Files:**
- Create: `smd-process-control/src/data/supabase.ts`
- Create: `smd-process-control/src/auth/employee-id.ts`
- Create: `smd-process-control/src/auth/auth-service.ts`
- Create: `smd-process-control/src/auth/RequireRole.tsx`
- Create: `smd-process-control/src/auth/LoginPage.tsx`
- Create: `smd-process-control/supabase/functions/admin-create-user/index.ts`
- Test: `smd-process-control/tests/unit/employee-id.test.ts`
- Test: `smd-process-control/tests/integration/auth.test.tsx`

**Interfaces:**
- Produces: `employeeIdToInternalEmail(employeeId: string): string`
- Produces: `signInWithEmployeeId(employeeId: string, password: string): Promise<Session>`
- Produces: `<RequireRole allow={["admin"]}>`
- Produces Edge Function body `{ employeeId, displayName, role, temporaryPassword }`

- [ ] **Step 1: 사번 정규화와 권한 경로 실패 테스트 작성**

```ts
expect(employeeIdToInternalEmail(" 025017 ")).toBe("025017@smd.internal");
expect(() => employeeIdToInternalEmail("25-017")).toThrow("invalid_employee_id");
```

로그인하지 않은 사용자는 `/login`, 조회자가 `/admin`을 열면 `/`로 이동해야 한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd smd-process-control && npm test -- employee-id.test.ts auth.test.tsx`

Expected: FAIL with missing auth modules.

- [ ] **Step 3: 사번 로그인 어댑터와 역할 가드 구현**

사번은 `^[0-9]{4,12}$`만 허용하고 내부 이메일로 변환한다. 화면에는 내부 이메일을 노출하지 않는다. 세션의 `profiles.role`과 `is_active`를 확인한 후 경로 접근을 결정한다.

- [ ] **Step 4: 관리자 전용 사용자 생성 Edge Function 구현**

관리자 JWT를 검증하고 service role로 Auth 사용자를 만든 뒤 같은 UUID의 `profiles` 행을 생성한다. 함수 응답은 비밀번호나 service role 키를 포함하지 않는다.

- [ ] **Step 5: 테스트와 빌드 확인**

Run: `cd smd-process-control && npm test -- employee-id.test.ts auth.test.tsx && npm run build`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add smd-process-control/src/auth smd-process-control/src/data/supabase.ts smd-process-control/supabase/functions smd-process-control/tests
git commit -m "feat(smd): add employee ID authentication and roles"
```

---

### Task 6: 기준정보·ST 관리자 기능

**Files:**
- Create: `smd-process-control/src/data/repositories/master-data-repository.ts`
- Create: `smd-process-control/src/features/admin/AdminPage.tsx`
- Create: `smd-process-control/src/features/admin/MasterDataEditor.tsx`
- Create: `smd-process-control/src/features/admin/StandardTimeEditor.tsx`
- Create: `smd-process-control/src/features/admin/UserEditor.tsx`
- Test: `smd-process-control/tests/integration/admin-master-data.test.tsx`
- Test: `smd-process-control/tests/unit/standard-time.test.ts`

**Interfaces:**
- Produces: `listMasterData(): Promise<MasterDataSnapshot>`
- Produces: `saveStandardTime(input: StandardTimeInput): Promise<StandardTime>`
- Produces: `findEffectiveStandardTime(records: StandardTime[], productionDate: string): StandardTime | null`
- Produces: `validateStandardTimeOverlap(records: StandardTime[], candidate: StandardTimeInput): { ok: true } | { ok: false; code: "overlapping-effective-period" }`

- [ ] **Step 1: ST 적용일과 중복 기간 실패 테스트 작성**

```ts
expect(findEffectiveStandardTime(records, "2026-07-01")?.secondsPerUnit).toBe(0.82);
expect(validateStandardTimeOverlap(records, candidate)).toEqual({
  ok: false,
  code: "overlapping-effective-period",
});
```

- [ ] **Step 2: 관리자 화면 실패 테스트 작성**

모델 추가, 비가동 사유 비활성화, ST 저장 후 목록 갱신, 기간 중복 오류 표시를 Testing Library로 검증한다.

- [ ] **Step 3: 저장소와 순수 ST 선택 함수 구현**

날짜 비교는 문자열이 아니라 `Asia/Bangkok` 생산일을 정규화한 ISO 날짜를 사용한다. 서버 제약 오류 `23P01`을 `overlapping-effective-period`로 변환한다.

- [ ] **Step 4: 관리자 편집 화면 구현**

삭제 버튼은 과거 참조가 있는 기준정보를 비활성화로 처리한다. ST 입력은 모델·공정·라인·초/개·시작일·종료일을 명시적으로 받는다.

- [ ] **Step 5: 테스트 확인**

Run: `cd smd-process-control && npm test -- standard-time.test.ts admin-master-data.test.tsx`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add smd-process-control/src/data/repositories/master-data-repository.ts smd-process-control/src/features/admin smd-process-control/tests
git commit -m "feat(smd): add master data and standard time administration"
```

---

### Task 7: 수기 실적 입력과 비가동 편집

**Files:**
- Create: `smd-process-control/src/domain/validation.ts`
- Create: `smd-process-control/src/data/repositories/production-repository.ts`
- Create: `smd-process-control/src/data/repositories/quality-repository.ts`
- Create: `smd-process-control/src/features/entry/ProductionEntryPage.tsx`
- Create: `smd-process-control/src/features/entry/ProductionEntryForm.tsx`
- Create: `smd-process-control/src/features/entry/DowntimeEditor.tsx`
- Test: `smd-process-control/tests/unit/validation.test.ts`
- Test: `smd-process-control/tests/integration/production-entry.test.tsx`

**Interfaces:**
- Produces: `productionEntrySchema: z.ZodType<ProductionEntryDraft>`
- Produces: `validateDowntime(downtime: DowntimeDraft[], plannedSeconds: number): { ok: true } | { ok: false; code: "downtime-exceeds-planned-time" }`
- Produces: `previewProductionMetrics(input: ProductionEntryDraft, masterData: MasterDataSnapshot): ProductionPreview`
- Produces: `saveProductionRecord(draft: ProductionEntryDraft, expectedVersion: number): Promise<string>`

- [ ] **Step 1: 입력 검증 실패 테스트 작성**

```ts
const validDraft: ProductionEntryDraft = {
  productionDate: "2026-07-28",
  shiftId: "shift-day",
  timeSlotId: "slot-a",
  lineId: "line-1",
  modelId: "model-a",
  processId: "process-aoi",
  inputQty: 10,
  actualQty: 9,
  okQty: 9,
  ngQty: 1,
  note: "",
  downtime: [],
};

expect(productionEntrySchema.safeParse({ ...validDraft, okQty: 11 }).success).toBe(false);
expect(
  validateDowntime([{ reasonId: "breakdown", minutes: 61, note: "" }], 3600),
).toEqual({ ok: false, code: "downtime-exceeds-planned-time" });
```

- [ ] **Step 2: 폼 흐름 실패 테스트 작성**

날짜→조→시간대→라인→모델→공정을 선택하고 수량을 입력하면 적용 ST와 예상 수율·가동률이 표시되는지 검증한다. 중복 응답이면 저장하지 않고 기존값 비교 패널이 보여야 한다.

- [ ] **Step 3: Zod 스키마와 미리보기 함수 구현**

`Input`, `실적`, `OK`, `NG`는 0 이상의 정수, `OK <= Input`, `OK + NG <= Input`, 비가동 합계는 계획시간 이하로 제한한다.

- [ ] **Step 4: 폼과 비가동 다중 행 편집 구현**

비가동 행은 사유, 시작·종료 또는 분 입력 중 하나의 방식만 사용한다. 저장 버튼은 검증 성공과 기준정보 로딩 완료 시에만 활성화한다.

- [ ] **Step 5: 버전 충돌과 권한 오류 표시 구현**

`40001`은 “다른 사용자가 수정했습니다”, `42501`은 “수정 권한이 없습니다”로 표시하고 사용자가 입력한 초안은 유지한다.

- [ ] **Step 6: 테스트 확인**

Run: `cd smd-process-control && npm test -- validation.test.ts production-entry.test.tsx`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add smd-process-control/src/domain/validation.ts smd-process-control/src/data/repositories smd-process-control/src/features/entry smd-process-control/tests
git commit -m "feat(smd): add validated time-slot production entry"
```

---

### Task 8: Excel 공통 계약과 파일 유형 감지

**Files:**
- Create: `smd-process-control/src/excel/contracts.ts`
- Create: `smd-process-control/src/excel/normalize.ts`
- Create: `smd-process-control/src/excel/detect-workbook.ts`
- Test: `smd-process-control/tests/unit/excel-normalize.test.ts`
- Test: `smd-process-control/tests/unit/detect-workbook.test.ts`

**Interfaces:**
- Consumes: `NormalizedImportRow`, `WorkbookSheet`, `WorkbookKind`
- Produces: `normalizeProcessName(value: unknown): ProcessCode`
- Produces: `detectWorkbook(sheets: WorkbookSheet[]): WorkbookDetection`
- WorkbookKind: `"aoi" | "spi" | "ict" | "xray" | "production" | "standard" | "unknown"`

- [ ] **Step 1: 공정명·날짜·라인 정규화 실패 테스트 작성**

```ts
expect(normalizeProcessName("X-ray")).toBe("XRAY");
expect(normalizeProcessName("Router Máy 2")).toBe("ROUTER");
expect(normalizeLineName("AOI Line 3")).toBe("LINE-3");
expect(normalizeProductionDate("27.07", 2026)).toBe("2026-07-27");
```

- [ ] **Step 2: 파일 감지 실패 테스트 작성**

시트명과 헤더 조합으로 `Total AOI`, `SPI MODEL`, `Data HS Công Đoạn ICT`, `Xray`, `Sản Lượng Từng Time`, `SMD_STANDARD_V1`을 각각 판별한다.

- [ ] **Step 3: 표준 행 계약과 오류 코드 구현**

```ts
export type ImportRowErrorCode =
  | "missing-required-value"
  | "unknown-model"
  | "unknown-line"
  | "unknown-process"
  | "invalid-count"
  | "duplicate-record"
  | "unsupported-template-version";
```

`NormalizedImportRow`는 sourceSheet, sourceRow, productionDate, shiftCode, timeSlotCode, lineCode, modelCode, processCode, inputQty, actualQty, okQty, ngQty, downtimeMinutes, downtimeReasonCode, note를 가진다.

- [ ] **Step 4: 감지 우선순위 구현**

통합 표준 양식을 가장 먼저 확인하고, 시트명만으로 결정하지 않으며 필수 헤더까지 일치해야 확정한다. 두 형식이 동시에 일치하면 `unknown`과 `ambiguous-workbook` 진단을 반환한다.

- [ ] **Step 5: 테스트 확인**

Run: `cd smd-process-control && npm test -- excel-normalize.test.ts detect-workbook.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add smd-process-control/src/excel smd-process-control/tests/unit
git commit -m "feat(smd): add Excel normalization contracts"
```

---

### Task 9: 기존 5종 Excel 어댑터

**Files:**
- Create: `smd-process-control/src/excel/adapters/aoi-adapter.ts`
- Create: `smd-process-control/src/excel/adapters/spi-adapter.ts`
- Create: `smd-process-control/src/excel/adapters/ict-adapter.ts`
- Create: `smd-process-control/src/excel/adapters/xray-adapter.ts`
- Create: `smd-process-control/src/excel/adapters/production-adapter.ts`
- Create: `smd-process-control/tests/fixtures/aoi-sample.xlsx`
- Create: `smd-process-control/tests/fixtures/spi-sample.xlsx`
- Create: `smd-process-control/tests/fixtures/ict-sample.xlsx`
- Create: `smd-process-control/tests/fixtures/xray-sample.xlsx`
- Create: `smd-process-control/tests/fixtures/production-sample.xlsx`
- Test: `smd-process-control/tests/integration/legacy-excel-adapters.test.ts`

**Interfaces:**
- Produces: `parseAoiWorkbook(sheets: WorkbookSheet[]): ImportParseResult`
- Produces: `parseSpiWorkbook(sheets: WorkbookSheet[]): ImportParseResult`
- Produces: `parseIctWorkbook(sheets: WorkbookSheet[]): ImportParseResult`
- Produces: `parseXrayWorkbook(sheets: WorkbookSheet[]): ImportParseResult`
- Produces: `parseProductionWorkbook(sheets: WorkbookSheet[]): ImportParseResult`

- [ ] **Step 1: 원본을 익명화한 소형 fixture 작성**

실제 파일의 시트명·헤더 위치·병합 구조는 유지하고 모델명은 `MODEL-A`, `MODEL-B`, 수량은 작은 검증값으로 바꾼다. 원본 대용량 업무 파일은 Git에 추가하지 않는다.

- [ ] **Step 2: AOI·SPI 어댑터 실패 테스트 작성**

라인별 시트와 모델별 시트에서 날짜, Input, OK, NG, 라인, 모델이 정확히 정규화되는지 검증한다. 저장된 수율 셀은 신뢰하지 않고 Input과 OK로 다시 계산한다.

- [ ] **Step 3: ICT·X-ray 어댑터 실패 테스트 작성**

시간대가 없는 일 단위 품질 행은 `timeSlotCode: null`로 출력하고, 모델 또는 라인이 없는 합계 행은 가져오지 않는다.

- [ ] **Step 4: 공정별 어댑터 구현**

각 어댑터는 해당 파일만 해석하고 `NormalizedImportRow[]`와 행별 진단을 반환한다. 다른 어댑터의 셀 주소를 재사용하지 않는다.

- [ ] **Step 5: 시간대 실적 어댑터 실패 테스트와 구현**

날짜 시트의 Line 1~4, X-ray, ICT, Router 행과 A~E CAPA·실적·비가동을 펼쳐 시간대별 표준 행으로 변환한다. 합계 행과 `#DIV/0!` 표시 셀은 원천 수량으로 재계산하거나 오류 진단으로 남긴다.

- [ ] **Step 6: 실제 원본 대표값 대조 스크립트 실행**

Run: `cd smd-process-control && npm test -- legacy-excel-adapters.test.ts`

Expected: AOI·SPI·ICT·X-ray·시간대 실적 fixture의 행 수와 합계가 PASS.

- [ ] **Step 7: 커밋**

```bash
git add smd-process-control/src/excel/adapters smd-process-control/tests/fixtures smd-process-control/tests/integration
git commit -m "feat(smd): import five legacy SMD workbook formats"
```

---

### Task 10: 통합 표준 양식과 업로드 검증·커밋 화면

**Files:**
- Create: `smd-process-control/src/excel/adapters/standard-adapter.ts`
- Create: `smd-process-control/src/excel/template.ts`
- Create: `smd-process-control/src/data/repositories/upload-repository.ts`
- Create: `smd-process-control/src/features/upload/UploadPage.tsx`
- Create: `smd-process-control/src/features/upload/UploadReviewTable.tsx`
- Test: `smd-process-control/tests/unit/standard-template.test.ts`
- Test: `smd-process-control/tests/integration/upload-flow.test.tsx`

**Interfaces:**
- Produces: `downloadStandardTemplate(masterData: MasterDataSnapshot): Promise<void>`
- Produces: `parseStandardWorkbook(sheets: WorkbookSheet[]): ImportParseResult`
- Produces: `stageUpload(file: File): Promise<UploadReview>`
- Produces: `commitUpload(batchId: string, replaceConflicts: boolean): Promise<UploadCommitResult>`

- [ ] **Step 1: 표준 양식 계약 실패 테스트 작성**

생성된 파일에 `SMD_STANDARD_V1`, `Production`, `Defects`, `Reference` 시트가 있고 Production 헤더가 설계 문서의 13개 열과 일치하는지 검증한다.

- [ ] **Step 2: 통합 양식 생성과 파서 구현**

날짜·수량은 Excel 타입으로 저장하고 Reference 시트의 활성 모델·라인·공정·조·시간대·비가동 사유를 참조 목록으로 제공한다. `template_version = 1` 이외의 버전은 차단한다.

- [ ] **Step 3: 업로드 화면 실패 테스트 작성**

파일 선택 후 신규·중복·오류·미등록 기준정보 요약, 행별 오류, 저장 버튼 비활성화, 관리자 교체 옵션을 검증한다.

- [ ] **Step 4: 검증·원본 업로드·배치 저장 구현**

원본을 Storage에 먼저 저장하고 `upload_batches`와 `upload_rows`를 만든다. 오류가 1건이라도 있으면 커밋 버튼을 비활성화한다. 중복 교체 체크박스는 admin에게만 보인다.

- [ ] **Step 5: 정상·중복·오류 흐름 테스트**

Run: `cd smd-process-control && npm test -- standard-template.test.ts upload-flow.test.tsx`

Expected: 세 흐름 모두 PASS.

- [ ] **Step 6: 커밋**

```bash
git add smd-process-control/src/excel smd-process-control/src/data/repositories/upload-repository.ts smd-process-control/src/features/upload smd-process-control/tests
git commit -m "feat(smd): add standard workbook and reviewed upload flow"
```

---

### Task 11: 실시간 통합 대시보드

**Files:**
- Create: `smd-process-control/src/features/dashboard/DashboardPage.tsx`
- Create: `smd-process-control/src/features/dashboard/YieldMatrix.tsx`
- Create: `smd-process-control/src/features/dashboard/UtilizationBars.tsx`
- Create: `smd-process-control/src/features/dashboard/EntryProgress.tsx`
- Create: `smd-process-control/src/styles/dashboard.css`
- Test: `smd-process-control/tests/integration/dashboard.test.tsx`
- Test: `smd-process-control/tests/integration/realtime-dashboard.test.tsx`

**Interfaces:**
- Consumes: calculation engine, production and quality repositories
- Produces: `DashboardFilters`
- Produces: `loadDashboard(filters: DashboardFilters): Promise<DashboardSnapshot>`
- Produces: `subscribeDashboard(filters: DashboardFilters, onChange: () => void): () => void`

- [ ] **Step 1: 승인 목업의 핵심 영역 실패 테스트 작성**

금일 총 실적, 평균 공정 수율, 평균 라인 가동률, 확인 필요, 5개 공정 × 라인 수율표, 라인 가동률, 시간대 진행 상태가 렌더링되는지 검증한다.

- [ ] **Step 2: 필터와 집계 저장소 구현**

날짜·조·모델·라인·공정 필터를 하나의 `DashboardFilters`로 전달한다. 평균 수율은 `sum(ok) / sum(input)` 가중 방식으로 계산하고 단순 퍼센트 평균을 사용하지 않는다.

- [ ] **Step 3: 대시보드 구성요소 구현**

승인 목업의 좌측 메뉴, KPI 4개, 수율 매트릭스, 가동률 막대, 비가동 요약, A~E 진행 상태를 반응형으로 구현한다. 값이 없으면 0% 대신 `—`를 표시한다.

- [ ] **Step 4: Realtime 실패 테스트 작성**

production 또는 quality 채널 이벤트를 발생시키면 500ms 디바운스 후 현재 필터의 snapshot을 한 번만 다시 조회하는지 검증한다.

- [ ] **Step 5: Realtime 구독 구현**

컴포넌트 해제 시 채널을 제거하고, 필터 변경 시 이전 구독을 정리한다. 사용자가 입력 중인 폼 상태는 대시보드 이벤트로 초기화하지 않는다.

- [ ] **Step 6: 테스트 확인**

Run: `cd smd-process-control && npm test -- dashboard.test.tsx realtime-dashboard.test.tsx`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add smd-process-control/src/features/dashboard smd-process-control/src/styles/dashboard.css smd-process-control/tests
git commit -m "feat(smd): add real-time production dashboard"
```

---

### Task 12: 상세 분석, 불량 조회, Excel·PDF 보고서

**Files:**
- Create: `smd-process-control/src/features/analysis/AnalysisPage.tsx`
- Create: `smd-process-control/src/features/analysis/TrendChart.tsx`
- Create: `smd-process-control/src/features/analysis/DefectTable.tsx`
- Create: `smd-process-control/src/exports/excel-report.ts`
- Create: `smd-process-control/src/exports/pdf-report.ts`
- Test: `smd-process-control/tests/integration/analysis.test.tsx`
- Test: `smd-process-control/tests/unit/exports.test.ts`

**Interfaces:**
- Produces: `loadAnalysis(filters: AnalysisFilters): Promise<AnalysisDataset>`
- Produces: `downloadAnalysisExcel(dataset: AnalysisDataset, language: "ko" | "vi"): Promise<void>`
- Produces: `downloadAnalysisPdf(dataset: AnalysisDataset, language: "ko" | "vi"): Promise<void>`

- [ ] **Step 1: 기간 집계와 추이 실패 테스트 작성**

일·주·월 그룹 변경, 공정/라인/모델 필터, 목표 미달 표시, 불량 유형 수량 정렬을 검증한다.

- [ ] **Step 2: 분석 조회와 차트 구현**

한 화면에 선택 기간 추이, 공정·라인 비교, 시간대 실적·가동률, 비가동 손실, 불량 상세를 제공한다. 모든 차트에는 단위와 접근 가능한 텍스트 요약을 둔다.

- [ ] **Step 3: Excel 보고서 실패 테스트 작성**

보고서에 `Summary`, `Yield`, `Utilization`, `Downtime`, `Defects` 시트가 있고 숫자와 날짜가 문자열이 아닌 타입으로 기록되는지 검증한다.

- [ ] **Step 4: Excel과 PDF 내보내기 구현**

파일명은 `smd-report_YYYY-MM-DD_YYYY-MM-DD.xlsx|pdf`로 만들고 현재 필터, 생성 시각, 생성 사용자를 포함한다. PDF는 표가 페이지 밖으로 잘리지 않도록 페이지 단위로 나눈다.

- [ ] **Step 5: 테스트 확인**

Run: `cd smd-process-control && npm test -- analysis.test.tsx exports.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add smd-process-control/src/features/analysis smd-process-control/src/exports smd-process-control/tests
git commit -m "feat(smd): add process analysis and reports"
```

---

### Task 13: 한국어·베트남어, 반응형 접근성, 전체 경로

**Files:**
- Create: `smd-process-control/src/i18n/index.ts`
- Create: `smd-process-control/src/i18n/ko.ts`
- Create: `smd-process-control/src/i18n/vi.ts`
- Create: `smd-process-control/src/app/routes.tsx`
- Modify: `smd-process-control/src/app/App.tsx`
- Modify: `smd-process-control/src/styles/globals.css`
- Test: `smd-process-control/tests/integration/i18n-routes.test.tsx`
- Test: `smd-process-control/tests/e2e/responsive.spec.ts`

**Interfaces:**
- Produces: `TranslationKey = keyof typeof ko`
- Produces: `t(key: TranslationKey, params?: Record<string, string | number>): string`
- Produces routes `/login`, `/`, `/entry`, `/upload`, `/analysis`, `/admin`

- [ ] **Step 1: 번역 키 완전성 실패 테스트 작성**

```ts
expect(Object.keys(vi).sort()).toEqual(Object.keys(ko).sort());
expect(ko["process.xray"]).toBe("X-ray");
expect(vi["entry.save"]).toBe("Lưu");
```

- [ ] **Step 2: 번역 모듈과 사용자 언어 저장 구현**

언어는 profile에 저장하고 로그인 전에는 브라우저 언어, 로그인 후에는 profile 언어를 사용한다. 누락 키는 빌드 테스트에서 실패하게 한다.

- [ ] **Step 3: 전체 경로와 메뉴 연결**

역할에 따라 관리자 메뉴를 숨기되 RLS와 경로 가드도 유지한다. 현재 경로는 좌측 메뉴에서 명확히 표시한다.

- [ ] **Step 4: 1366px PC와 768px 태블릿 E2E 실패 테스트 작성**

수평 잘림 없이 메뉴, KPI, 수율표, 입력 폼을 사용할 수 있는지 검증한다. 태블릿에서는 좌측 메뉴를 접을 수 있어야 한다.

- [ ] **Step 5: 반응형·키보드·오류 포커스 구현**

모든 입력에 label을 연결하고 저장 실패 시 첫 오류 필드로 포커스를 이동한다. 색만으로 저수율과 정상 상태를 구분하지 않고 텍스트 또는 기호를 병행한다.

- [ ] **Step 6: 테스트와 빌드 확인**

Run: `cd smd-process-control && npm test && npm run build && npm run test:e2e -- responsive.spec.ts`

Expected: PASS.

- [ ] **Step 7: 커밋**

```bash
git add smd-process-control/src smd-process-control/tests
git commit -m "feat(smd): add bilingual responsive application shell"
```

---

### Task 14: 통합 E2E, 데이터 대조, 전용 배포

**Files:**
- Create: `smd-process-control/tests/e2e/operator-flow.spec.ts`
- Create: `smd-process-control/tests/e2e/admin-flow.spec.ts`
- Create: `smd-process-control/tests/e2e/viewer-flow.spec.ts`
- Create: `smd-process-control/tests/e2e/concurrency.spec.ts`
- Create: `smd-process-control/tests/integration/source-reconciliation.test.ts`
- Create: `smd-process-control/README.md`
- Create: `smd-process-control/.openai/hosting.json` only through the selected independent hosting project workflow

**Interfaces:**
- Consumes: all prior tasks
- Produces: 배포 가능한 독립 SMD 앱과 운영 절차

- [ ] **Step 1: 역할별 전체 흐름 E2E 작성**

작업자는 로그인→실적 입력→대시보드 반영, 관리자는 기준정보·ST→중복 업로드 교체, 조회자는 조회·보고서 다운로드를 수행한다. 금지된 버튼이 없고 직접 URL 접근도 차단되는지 확인한다.

- [ ] **Step 2: 동시성 E2E 작성**

두 브라우저 컨텍스트에서 같은 레코드를 연다. A가 저장한 뒤 B의 저장은 `record_version_conflict`로 실패하고 B의 초안은 유지돼야 한다. A의 신규 실적은 다른 대시보드에 5초 이내 반영돼야 한다.

- [ ] **Step 3: 원본 대표 데이터 대조 테스트 작성**

현재 5종 Excel에서 각 1개 날짜·모델·라인을 선정해 Input, OK, NG, 실적 합계를 importer 결과와 비교한다. 테스트 기대값은 원본의 표시 퍼센트가 아니라 수량으로 고정한다.

- [ ] **Step 4: 전체 검증 실행**

Run:

```bash
cd smd-process-control
npm test
npx supabase db reset
npx supabase test db
npm run build
npm run test:e2e
```

Expected: all commands PASS with no skipped critical tests.

- [ ] **Step 5: 운영 문서 작성**

`README.md`에 로컬 실행, 환경변수, Supabase migration, 관리자 최초 계정, 표준 양식, 원본 파일 보존, 백업·복구, 배포 검증 명령을 정확히 기록한다. 실제 비밀값은 기록하지 않는다.

- [ ] **Step 6: 독립 Supabase 프로젝트 적용**

새 프로젝트에 migration과 Edge Function을 배포하고 Auth 설정, Storage 버킷, Realtime publication을 확인한다. 기존 인력현황 Supabase 프로젝트에는 변경이 없어야 한다.

- [ ] **Step 7: 독립 호스팅 프로젝트에 배포**

새 SMD 앱 소스 상태를 저장한 버전만 배포하고 로그인, 실적 입력, 업로드 검증, 대시보드 실시간 갱신, 보고서 다운로드를 배포 URL에서 다시 확인한다.

- [ ] **Step 8: 최종 커밋**

```bash
git add smd-process-control
git commit -m "test(smd): verify end-to-end production workflows"
```

---

## Implementation Order and Review Gates

1. Tasks 1–4: 앱 기반과 데이터 안전성
2. Tasks 5–7: 인증, 기준정보, 수기 입력
3. Tasks 8–10: 기존·표준 Excel 처리
4. Tasks 11–13: 대시보드, 분석, 다국어 UI
5. Task 14: 통합 검증과 독립 배포

각 Task는 테스트 통과와 커밋 후 다음 Task로 이동한다. 데이터베이스 제약과 RLS 검토가 끝나기 전에 현장 입력 화면을 실데이터에 연결하지 않는다. Excel 어댑터는 각 형식의 fixture 테스트가 통과한 뒤에만 업로드 화면에 등록한다.
