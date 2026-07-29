# Legacy Workbook Master and Detail Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the five preserved legacy SMD workbooks to stage missing master data and CAPA-derived ST candidates for admin approval, then atomically register approved masters, ST, and detailed production/quality records.

**Architecture:** Keep workbook parsing, candidate derivation, persistence, and approval UI as separate units. The browser extracts normalized detail rows and source evidence, while PostgreSQL stores immutable staging data and performs the final authorization, conflict checks, master resolution, and detail commit in one transaction. Large detail lists are inserted and read in chunks; only candidate summaries and one detail page are rendered at a time.

**Tech Stack:** React 19, TypeScript 5.9, Vite/Vinext, Vitest, Testing Library, read-excel-file, Supabase PostgreSQL/RLS/Storage, Playwright.

## Global Constraints

- Preserve the five source `.xlsx` files; never modify or overwrite them.
- Supported processes are exactly `SPI`, `AOI`, `XRAY`, `ICT`, and `ROUTER`; never create another process from a workbook.
- Workers may upload and inspect; only an active `admin` may approve new masters, approve ST, or replace duplicates.
- New master data is never committed automatically and existing master names or active state are never changed by import.
- Day slots are A `07:30–09:30`, B `09:30–13:00`, C `13:00–15:00`, D `15:00–17:00`, E `17:00–19:30`.
- Night slots are A `19:30–21:30`, B `21:30–01:00` with `end_day_offset=1`, C `01:00–03:00`, D `03:00–05:00`, E `05:00–07:30`; the night production date is the shift start date.
- Compute ST as `planned slot seconds / CAPA`, group by model + line + process, use the median, flag any observation with absolute relative deviation greater than 5%, round an unconflicted proposal to three decimals, and use the earliest observation date as `effective_from`.
- Do not create an ST candidate for blank or non-positive CAPA; retain a source-located warning instead.
- Quality workbooks without a time slot remain daily quality records and do not create a synthetic time slot.
- Preserve production, quality, defect, downtime, workbook kind, filename, SHA-256, sheet, and row trace.
- The final master/ST/detail operation is one database transaction and rolls back completely on any failure.
- Duplicate details default to skip; only an admin may explicitly replace them.
- A completed batch is immutable, and a re-upload with the same SHA-256 identifies the completed batch instead of duplicating it.
- Preserve source reconciliation counts: AOI 239, SPI 271, ICT 90, X-ray 262, production 14,708.

---

## File Map

- `src/excel/contracts.ts`: normalized CAPA evidence and candidate/review contracts shared by parser, repository, and UI.
- `src/excel/production-layout.ts`: locate the CAPA column for each A–E group.
- `src/excel/adapters/production-adapter.ts`: emit CAPA evidence without putting CAPA into production detail payloads.
- `src/upload/legacy-master-candidates.ts`: pure normalization, master candidate derivation, ST median/deviation calculation, and overlap classification.
- `src/data/repositories/upload-repository.ts`: hash, stage, page, approve, and commit orchestration.
- `src/features/upload/UploadPage.tsx`: two-stage upload/review workflow and role gates.
- `src/features/upload/UploadMasterReview.tsx`: editable master candidate table.
- `src/features/upload/UploadStandardTimeReview.tsx`: ST evidence and approval editor.
- `src/features/upload/UploadReviewTable.tsx`: server-paged detail/diagnostic table.
- `src/i18n/ko.ts`, `src/i18n/vi.ts`: all visible upload review copy.
- `src/styles/dashboard.css`: responsive upload review layout using existing application styling.
- `supabase/migrations/023_legacy_master_detail_import.sql`: hashes, candidate tables, RLS, staging guards, review RPCs, and atomic commit RPC.
- `supabase/tests/legacy_master_detail_import.test.sql`: database authorization, conflicts, idempotency, rollback, and relationship tests.
- `tests/unit/legacy-master-candidates.test.ts`: candidate and ST calculation boundaries.
- `tests/integration/legacy-excel-adapters.test.ts`: CAPA extraction and shift/slot behavior.
- `tests/integration/upload-flow.test.tsx`: repository and review UI integration.
- `tests/integration/source-reconciliation.test.ts`: preserved file hashes/counts and source-trace assertions.
- `tests/e2e/admin-flow.spec.ts`: admin approval and dashboard visibility.
- `README.md`: operator/admin workflow and deployment verification.

### Task 1: Extend the Parser Contract with CAPA Evidence

**Files:**
- Modify: `src/excel/contracts.ts`
- Modify: `src/excel/production-layout.ts`
- Modify: `src/excel/adapters/production-adapter.ts`
- Modify: `tests/integration/legacy-excel-adapters.test.ts`

**Interfaces:**
- Consumes: existing `NormalizedImportRow`, `ProductionGroupedLayout`, and `parseProductionWorkbook(sheets)`.
- Produces: `CapacityEvidence`, `ImportParseResult.capacityEvidence`, `ImportParseResult.stWarnings`, and `ProductionGroupedLayout.slots[].capacityColumn`.

- [ ] **Step 1: Write failing CAPA and time-slot tests**

Add tests that build one production row with CAPA values for all five slot groups and assert:

```ts
expect(result.capacityEvidence).toEqual([
  expect.objectContaining({
    sourceSheet: "01.7",
    sourceRow: 6,
    productionDate: "2026-07-01",
    shiftCode: "DAY",
    timeSlotCode: "A",
    modelCode: "MODEL-1",
    lineCode: "AOI-1",
    processCode: "AOI",
    capacityQty: 120,
  }),
]);
expect(result.rows[0].dimensions.production).toEqual({ inputQty: 0, actualQty: 100 });
```

Add a second assertion that blank, zero, and invalid CAPA do not emit evidence and produce non-blocking `stWarnings` with field `capacityQty`, while `diagnostics` remains empty. Rename the former “ignores CAPA as input” test to “keeps CAPA as ST evidence without adding it to detail quantities.”

- [ ] **Step 2: Run the focused parser test and confirm failure**

Run: `npm test -- tests/integration/legacy-excel-adapters.test.ts`

Expected: FAIL because `capacityEvidence` and `capacityColumn` do not exist.

- [ ] **Step 3: Add the contracts and CAPA column discovery**

In `src/excel/contracts.ts`, define:

```ts
export interface CapacityEvidence {
  sourceSheet: string;
  sourceRow: number;
  productionDate: string;
  shiftCode: string;
  timeSlotCode: "A" | "B" | "C" | "D" | "E";
  modelCode: string;
  lineCode: string;
  processCode: LegacyNormalizedImportRow["processCode"];
  capacityQty: number;
}

export interface ImportParseResult {
  kind: WorkbookKind;
  rows: NormalizedImportRow[];
  diagnostics: ImportDiagnostic[];
  capacityEvidence: CapacityEvidence[];
  stWarnings: ImportDiagnostic[];
}
```

Update every adapter return to include `capacityEvidence: []` and `stWarnings: []`. Extend each production slot layout with `capacityColumn: number` and discover the header normalized to `capa` within the same five-column group.

- [ ] **Step 4: Emit validated evidence from the production adapter**

For every actual production row, read the matching slot CAPA. Use `normalizeQuantity(rawCapacity, "capacityQty")`; emit evidence only when the result is greater than zero. For blank, invalid, or non-positive CAPA, append one source-located `invalid-count` entry to `stWarnings` with `field: "capacityQty"`. Do not add CAPA findings to blocking `diagnostics`; the production detail row remains valid.

Use the same normalized model, line, process, shift, date, slot, sheet, and row values as the corresponding production detail row.

- [ ] **Step 5: Run parser and type tests**

Run: `npm test -- tests/integration/legacy-excel-adapters.test.ts`

Expected: PASS, including the assertion that CAPA is absent from the staged production quantities.

- [ ] **Step 6: Commit the parser contract**

```bash
git add src/excel/contracts.ts src/excel/production-layout.ts src/excel/adapters/production-adapter.ts tests/integration/legacy-excel-adapters.test.ts
git commit -m "feat: extract legacy CAPA evidence"
```

### Task 2: Derive Master and Standard-Time Candidates

**Files:**
- Create: `src/upload/legacy-master-candidates.ts`
- Create: `tests/unit/legacy-master-candidates.test.ts`
- Modify: `src/excel/contracts.ts`
- Modify: `src/domain/types.ts`

**Interfaces:**
- Consumes: `deriveLegacyCandidates(parsed: ImportParseResult, master: MasterDataSnapshot)`.
- Produces: `UploadMasterCandidate[]`, `UploadStandardTimeCandidate[]`, and `CandidateDerivationResult`.

- [ ] **Step 1: Write failing master candidate tests**

Cover:

```ts
expect(result.masterCandidates).toEqual(expect.arrayContaining([
  expect.objectContaining({ entity: "model", code: "MODEL-1", status: "new", proposedName: "MODEL-1" }),
  expect.objectContaining({ entity: "line", code: "AOI-1", status: "new", proposedName: "AOI-1" }),
  expect.objectContaining({ entity: "shift", code: "DAY", status: "new" }),
  expect.objectContaining({ entity: "time_slot", code: "A", parentCode: "DAY", status: "new", startsAt: "07:30", endsAt: "09:30", endDayOffset: 0 }),
]));
```

Also assert:

- `NIGHT/B` is `21:30–01:00`, offset `1`.
- `NIGHT/C–E` retain the same production date.
- `LEGACY_UNSPECIFIED` is proposed only when downtime is positive and no reason text exists.
- an existing active code/name is `existing`;
- a matching code with a different name is `conflict`;
- an unsupported process and unknown shift become source-located errors and never master candidates.

- [ ] **Step 2: Write failing ST calculation tests**

Use observations `[10, 10.5, 11]` and assert median `10.5`, min `10`, max `11`, and no conflict because the boundary is not greater than 5%. Use `[10, 10.5, 11.1]` and assert `conflict`. Assert an even sample uses the mean of the two center values, proposals round to three decimals, blank/zero CAPA is excluded, `effectiveFrom` is the earliest date, and overlap with an existing open ST is `conflict`.

- [ ] **Step 3: Run the domain tests and confirm failure**

Run: `npm test -- tests/unit/legacy-master-candidates.test.ts`

Expected: FAIL because the module and candidate contracts do not exist.

- [ ] **Step 4: Add exact candidate contracts**

Add these contracts to `src/domain/types.ts`:

```ts
export type UploadCandidateStatus = "existing" | "new" | "conflict" | "error";
export type UploadMasterEntity = "model" | "line" | "shift" | "time_slot" | "downtime_reason";
export interface UploadSourceRef { sheet: string; row: number }
export interface UploadMasterCandidate {
  key: string;
  entity: UploadMasterEntity;
  code: string;
  parentCode: string | null;
  proposedName: string;
  status: UploadCandidateStatus;
  approved: boolean;
  startsAt: string | null;
  endsAt: string | null;
  endDayOffset: 0 | 1 | null;
  sequence: number | null;
  messages: string[];
  sources: UploadSourceRef[];
}
export interface StandardTimeObservation extends UploadSourceRef {
  productionDate: string;
  shiftCode: string;
  timeSlotCode: string;
  capacityQty: number;
  plannedSeconds: number;
  secondsPerUnit: number;
}
export interface UploadStandardTimeCandidate {
  key: string;
  modelCode: string;
  lineCode: string;
  processCode: ProcessCode;
  status: UploadCandidateStatus;
  approved: boolean;
  proposedSecondsPerUnit: number | null;
  approvedSecondsPerUnit: number | null;
  minimum: number;
  median: number;
  maximum: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  messages: string[];
  observations: StandardTimeObservation[];
}
```

Add `LegacyUploadReview extends UploadReview` with required `sourceFileName`, `sourceSha256`, `workbookKind`, `masterCandidates`, `standardTimeCandidates`, `detailTotal`, and `detailPage`.

- [ ] **Step 5: Implement the pure derivation module**

Export:

```ts
export function plannedSeconds(shiftCode: string, slotCode: string): number;
export function median(values: number[]): number;
export function deriveLegacyCandidates(
  parsed: ImportParseResult,
  master: MasterDataSnapshot,
): CandidateDerivationResult;
```

Use a fixed `SHIFT_SLOT_DEFINITIONS` constant containing all ten approved slots. Calculate deviation as `Math.abs(value - medianValue) / medianValue > 0.05`. Group ST evidence with `${modelCode}|${lineCode}|${processCode}`. Deduplicate source references by sheet and row. Compare ST periods using inclusive date overlap: `candidateFrom <= existingTo || existingTo === null`, and `existingFrom <= candidateTo || candidateTo === null`.

- [ ] **Step 6: Run domain and parser tests**

Run: `npm test -- tests/unit/legacy-master-candidates.test.ts tests/integration/legacy-excel-adapters.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit candidate derivation**

```bash
git add src/upload/legacy-master-candidates.ts tests/unit/legacy-master-candidates.test.ts src/excel/contracts.ts src/domain/types.ts
git commit -m "feat: derive import master and ST candidates"
```

### Task 3: Add Secure Candidate Staging and Atomic Commit SQL

**Files:**
- Create: `supabase/migrations/023_legacy_master_detail_import.sql`
- Create: `supabase/tests/legacy_master_detail_import.test.sql`

**Interfaces:**
- Consumes: upload batch/row contract v2, existing master and production tables, `auth.uid()`, `private.current_profile()`.
- Produces:
  - `public.find_completed_upload_by_hash(p_source_sha256 text)`
  - `public.stage_upload_candidates(p_batch_id uuid, p_master_candidates jsonb, p_standard_time_candidates jsonb)`
  - `public.list_upload_detail_page(p_batch_id uuid, p_offset integer, p_limit integer, p_status text default null)`
  - `public.commit_upload_batch_with_masters(p_batch_id uuid, p_replace_conflicts boolean, p_master_approvals jsonb, p_standard_time_approvals jsonb)`

- [ ] **Step 1: Write failing database behavior assertions**

In the SQL test, construct batches for an operator and an admin and assert non-admin approval raises `admin_required`. Query `information_schema.columns`, `pg_tables`, `pg_proc`, and `information_schema.routine_privileges` to assert the batch hash column, both candidate tables, all four RPC signatures, RLS enablement, and revoked public execution exist as runtime database objects.

- [ ] **Step 2: Run the SQL test before applying migration 023 and confirm failure**

Run `supabase/tests/legacy_master_detail_import.test.sql` through the isolated project SQL test runner before applying migration 023.

Expected: FAIL because the candidate tables and RPCs do not exist.

- [ ] **Step 3: Add batch hash and immutable candidate tables**

Migration 023 must:

- add `source_sha256 text`, `approved_by uuid`, `approved_at timestamptz`, and `duplicate_policy text` to `upload_batches`;
- add a partial unique index on `source_sha256` where `status='completed'`;
- create `upload_master_candidates` with entity, normalized key, proposed/approved JSON, status, messages, sources, audit columns, and unique `(batch_id, candidate_key)`;
- create `upload_standard_time_candidates` with codes, statistics, proposed/approved ST, dates, observations, status, audit columns, and unique `(batch_id, candidate_key)`;
- constrain candidate status to `existing/new/conflict/error`;
- add indexes on `(batch_id,status)` and foreign keys with `on delete cascade` only from staging candidates to batches.

Enable RLS. Allow batch creator, viewer, and admin to select through the same upload visibility helper; deny direct insert/update/delete to authenticated clients. Only security-definer RPCs write candidate tables.

- [ ] **Step 4: Split structural validation from final master resolution**

Replace the upload row staging guard so it validates contract version, source trace, dates, non-negative quantities, allowed process, and row kind without requiring master IDs to exist. Keep master existence, active state, time-slot/shift pairing, downtime reason, and duplicate target/version checks in the final RPC.

Explicitly allow daily quality with `timeSlotCode = null`, while production still requires a slot.

- [ ] **Step 5: Implement candidate and paging RPCs**

`stage_upload_candidates` must lock the batch, require the caller to own a non-completed batch, validate every candidate key/type/status against allowlists, and insert immutable server-staged JSON.

`list_upload_detail_page` must clamp limit to `1..200`, require batch visibility, sort by `(source_sheet, source_row, id)`, and return `{rows,total}` without returning private storage paths.

`find_completed_upload_by_hash` returns only an accessible completed batch’s `id`, filename, workbook kind, and completion timestamp.

- [ ] **Step 6: Implement the atomic admin commit RPC**

The security-definer RPC must set a safe `search_path`, revoke public execution, grant only `authenticated`, and execute in this order:

1. require an active admin and lock the batch `for update`;
2. return the previous counts if the same batch is already completed; reject other terminal states;
3. match approval JSON only to staged candidate keys and reject omitted new/conflict candidates;
4. reject error candidates, unsupported processes, name changes to existing masters, invalid slots, invalid ST, and overlapping ST dates;
5. insert approved models, lines, shifts, time slots, downtime reasons, then ST;
6. resolve every detail code against active masters after insertion;
7. apply skip/replace rules and insert production, daily quality, defects, and downtime using existing version checks;
8. mark rows committed/skipped, set batch completed with approver and duplicate policy, and return inserted/replaced/skipped/master/ST counts.

Do not catch errors inside the RPC; PostgreSQL must roll back all master and detail writes together.

- [ ] **Step 7: Add database behavior tests**

The SQL test must verify:

- existing master reuse without a duplicate;
- code/name conflict blocks commit;
- fixed process allowlist;
- DAY/NIGHT slot definitions including NIGHT/B offset;
- ST overlap and unresolved >5% conflict block commit;
- production, daily quality, defect, and downtime foreign-key linkage;
- operator cannot approve or replace;
- an injected invalid detail rolls back newly inserted model and ST;
- completed rerun returns the same result without extra rows;
- same completed SHA-256 is discoverable;
- audit rows contain the admin actor.

- [ ] **Step 8: Run database and application tests**

Apply migration 023 to the isolated Supabase project `habfnclspdaeshjrbqzn`, then run `supabase/tests/legacy_master_detail_import.test.sql` through the project SQL test runner.

Expected: the runtime schema, privilege, authorization, transaction, relationship, and idempotency assertions all pass.

Run: `npm test`

Expected: the existing application suite remains green.

- [ ] **Step 9: Commit the database contract**

```bash
git add supabase/migrations/023_legacy_master_detail_import.sql supabase/tests/legacy_master_detail_import.test.sql
git commit -m "feat: add atomic legacy master import transaction"
```

### Task 4: Stage Hashes, Candidates, and Large Detail Pages

**Files:**
- Modify: `src/data/repositories/upload-repository.ts`
- Modify: `tests/integration/upload-flow.test.tsx`

**Interfaces:**
- Consumes: `deriveLegacyCandidates`, migration 023 RPCs, and candidate contracts.
- Produces:

```ts
interface UploadApproval {
  masterCandidates: Array<{ key: string; approved: boolean; approvedName: string }>;
  standardTimeCandidates: Array<{
    key: string;
    approved: boolean;
    approvedSecondsPerUnit: number | null;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
}

interface UploadRepository {
  stageUpload(file: File): Promise<LegacyUploadReview>;
  loadDetailPage(batchId: string, page: number, status?: string): Promise<UploadDetailPage>;
  commitUpload(batchId: string, replaceConflicts: boolean, approval: UploadApproval): Promise<UploadCommitResult>;
}
```

- [ ] **Step 1: Write failing repository tests**

Assert the event order:

```ts
expect(events).toEqual([
  "hash-check",
  "storage",
  "upload_batches",
  "upload_rows",
  "stage-candidates",
]);
```

Assert the batch insert contains the lowercase 64-character SHA-256 and that a completed hash result returns the existing batch without another storage upload. Assert 14,708 rows still insert in chunks of at most 500. Assert `loadDetailPage(batchId, 2, "error")` calls offset `200`, limit `200`. Assert `commitUpload` calls `commit_upload_batch_with_masters` with the exact approval arrays.

- [ ] **Step 2: Run upload repository tests and confirm failure**

Run: `npm test -- tests/integration/upload-flow.test.tsx`

Expected: FAIL on missing hash, candidate RPC, paging method, and approval argument.

- [ ] **Step 3: Add deterministic browser hashing**

Export:

```ts
export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
```

Call `find_completed_upload_by_hash` before Storage upload. If found, load its review and first detail page and expose `duplicateCompletedBatch: true`; do not upload or create a new batch.

- [ ] **Step 4: Stage candidates without treating missing masters as row errors**

After parsing and loading master data:

1. call `deriveLegacyCandidates(parsed, masterData)`;
2. consume `parsed.stWarnings` as source-located ST warnings without adding them to detail-row diagnostics or error counts;
3. use existing IDs only for duplicate prefetch;
4. mark structurally valid rows as new even when their model/line/shift/slot/reason is an approved candidate;
5. stage rows in 500-row chunks;
6. call `stage_upload_candidates` after all rows exist;
7. return candidate counts separately from detail errors.

If candidate staging fails, surface the batch ID for retry; do not delete the original or partial staging records.

- [ ] **Step 5: Add paged detail and approval commit methods**

Use `DETAIL_PAGE_SIZE = 200`. Map server results into:

```ts
export interface UploadDetailPage {
  page: number;
  pageSize: 200;
  total: number;
  rows: UploadReviewV2["rows"];
  diagnostics: UploadReview["diagnostics"];
}
```

On commit, send only candidate keys and edited approval values; never send master IDs. Map returned `skipped`, `masters_inserted`, and `standard_times_inserted` into the extended `UploadCommitResult`.

- [ ] **Step 6: Run upload integration tests**

Run: `npm test -- tests/integration/upload-flow.test.tsx`

Expected: PASS, including hash idempotency, chunk size, and paging.

- [ ] **Step 7: Commit repository orchestration**

```bash
git add src/data/repositories/upload-repository.ts tests/integration/upload-flow.test.tsx
git commit -m "feat: stage and approve legacy import candidates"
```

### Task 5: Build the Admin Candidate Review UI

**Files:**
- Create: `src/features/upload/UploadMasterReview.tsx`
- Create: `src/features/upload/UploadStandardTimeReview.tsx`
- Modify: `src/features/upload/UploadPage.tsx`
- Modify: `src/features/upload/UploadReviewTable.tsx`
- Modify: `tests/integration/upload-flow.test.tsx`

**Interfaces:**
- Consumes: `UploadReview`, `UploadApproval`, `UploadRepository.loadDetailPage`, and authenticated `AppRole`.
- Produces: validated approval state passed to `commitUpload(batchId, replaceConflicts, approval)`.

- [ ] **Step 1: Write failing worker/admin UI tests**

For an operator, assert candidate rows and ST evidence are visible but text inputs, approval checkboxes, replacement checkbox, and final commit are disabled when new candidates exist.

For an admin, edit a proposed model name, approve it, select one ST observation after a >5% conflict, and assert:

```ts
expect(repository.commitUpload).toHaveBeenCalledWith(
  "batch-1",
  true,
  expect.objectContaining({
    masterCandidates: [expect.objectContaining({ key: "model|MODEL-1", approvedName: "Camera Main" })],
    standardTimeCandidates: [expect.objectContaining({ key: "MODEL-1|AOI-1|AOI", approvedSecondsPerUnit: 10.5 })],
  }),
);
```

Assert the commit button remains disabled for an unapproved new candidate, an unresolved ST conflict, any error candidate, or any detail error.

- [ ] **Step 2: Run UI tests and confirm failure**

Run: `npm test -- tests/integration/upload-flow.test.tsx`

Expected: FAIL because candidate review components and approval state do not exist.

- [ ] **Step 3: Implement `UploadMasterReview`**

Render entity, code, parent shift, proposed/approved name, status, messages, and source references. Admins may edit the name only for `new` or `conflict` candidates and toggle approval. Existing candidates are read-only and considered resolved. Error candidates cannot be approved.

Expose:

```ts
export function UploadMasterReview(props: {
  candidates: UploadMasterCandidate[];
  role: AppRole;
  approvals: UploadApproval["masterCandidates"];
  onChange(next: UploadApproval["masterCandidates"]): void;
}): React.JSX.Element;
```

- [ ] **Step 4: Implement `UploadStandardTimeReview`**

Render model, line, process, status, min/median/max, effective dates, formula, and a collapsible evidence table with slot, planned seconds, CAPA, calculated ST, sheet, and row. For conflicts, require either a numeric value selected from an observation or a manual positive value. Existing/overlapping ST remains blocked; import does not edit the existing period.

- [ ] **Step 5: Integrate the two-stage page and server paging**

`UploadPage` must display:

1. filename, kind, hash, and duplicate-completed notice;
2. master status counts;
3. master review;
4. ST review;
5. detail status counts and filters;
6. `UploadReviewTable` for the current server page;
7. admin duplicate policy and final approval.

Replace “show more” slicing with previous/next controls that call `loadDetailPage`. Reset to page 1 when status changes. Disable the entire approval form while committing and preserve entered approvals if paging details.

- [ ] **Step 6: Run UI integration tests**

Run: `npm test -- tests/integration/upload-flow.test.tsx`

Expected: PASS for role gating, candidate editing, ST resolution, paging, and commit payload.

- [ ] **Step 7: Commit the review workflow**

```bash
git add src/features/upload/UploadMasterReview.tsx src/features/upload/UploadStandardTimeReview.tsx src/features/upload/UploadPage.tsx src/features/upload/UploadReviewTable.tsx tests/integration/upload-flow.test.tsx
git commit -m "feat: add admin legacy import review"
```

### Task 6: Add Korean/Vietnamese Copy and Responsive Styling

**Files:**
- Modify: `src/i18n/ko.ts`
- Modify: `src/i18n/vi.ts`
- Modify: `src/styles/dashboard.css`
- Modify: `tests/integration/upload-flow.test.tsx`

**Interfaces:**
- Consumes: all `upload.*` keys used by Task 5.
- Produces: complete Korean/Vietnamese translations and accessible responsive review panels.

- [ ] **Step 1: Add a failing translation coverage test**

Render the upload page under Korean and Vietnamese locales and assert no visible label falls back to the English `legacy` map. Include filename/hash, existing/new/conflict/error, approve, ST formula, evidence, duplicate policy, previous/next page, and commit result counts.

- [ ] **Step 2: Run the UI test and confirm failure**

Run: `npm test -- tests/integration/upload-flow.test.tsx`

Expected: FAIL on missing translation keys.

- [ ] **Step 3: Add exact Korean and Vietnamese messages**

Use manufacturing terms consistently:

- 기준정보 / Dữ liệu chuẩn
- 표준시간(ST) / Thời gian chuẩn (ST)
- 기존 / Đã có
- 신규 / Mới
- 충돌 / Xung đột
- 원본 근거 / Nguồn dữ liệu
- 중복 건너뛰기 / Bỏ qua bản ghi trùng
- 중복 교체 / Thay thế bản ghi trùng
- 최종 승인 및 반영 / Phê duyệt và ghi dữ liệu

Add parameterized commit copy for inserted, replaced, skipped, master, and ST counts.

- [ ] **Step 4: Add responsive styles**

Use existing colors and spacing. Candidate cards stack below 900px, tables retain horizontal scroll, numeric inputs remain at least 8rem wide, status badges include text in addition to color, and pagination buttons have visible focus styles. Do not add a new UI dependency.

- [ ] **Step 5: Run UI and build checks**

Run: `npm test -- tests/integration/upload-flow.test.tsx`

Run: `npm run build:vite`

Expected: both PASS.

- [ ] **Step 6: Commit localization and styles**

```bash
git add src/i18n/ko.ts src/i18n/vi.ts src/styles/dashboard.css tests/integration/upload-flow.test.tsx
git commit -m "feat: localize legacy import approval"
```

### Task 7: Reconcile All Five Preserved Workbooks

**Files:**
- Modify: `tests/integration/source-reconciliation.test.ts`
- Modify: `tests/integration/legacy-excel-adapters.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the five read-only workbooks under `SMD 공정 관리`, parser results, and candidate derivation.
- Produces: permanent regression evidence for source hashes, row counts, trace, daily quality behavior, and production candidates.

- [ ] **Step 1: Extend the source reconciliation test**

Keep the existing SHA-256 assertions and exact counts:

```ts
expect(counts).toEqual({
  aoi: 239,
  spi: 271,
  ict: 90,
  xray: 262,
  production: 14708,
});
```

Add assertions that every parsed detail row has a sheet and positive row number, daily quality has `timeSlotCode === null`, every CAPA observation maps to A–E, and every production candidate process is in the fixed allowlist.

- [ ] **Step 2: Run reconciliation and inspect any mismatch**

Run: `npm test -- tests/integration/source-reconciliation.test.ts tests/integration/legacy-excel-adapters.test.ts`

Expected: PASS with the exact preserved counts; any mismatch blocks release and must be corrected in parsing rather than by changing expected counts.

- [ ] **Step 3: Document the operating workflow**

In `README.md`, document:

- worker upload and review;
- admin master/ST approval;
- DAY/NIGHT slot definitions and night production date;
- ST formula, median, and >5% conflict rule;
- duplicate skip/replace behavior;
- completed hash behavior;
- private original retention;
- transactional rollback;
- how to retry a failed staged batch without re-uploading.

- [ ] **Step 4: Run the full unit/integration suite**

Run: `npm test`

Expected: all tests pass with no changed source reconciliation count.

- [ ] **Step 5: Commit source reconciliation**

```bash
git add tests/integration/source-reconciliation.test.ts tests/integration/legacy-excel-adapters.test.ts README.md
git commit -m "test: reconcile legacy import source files"
```

### Task 8: Verify Database Security, End-to-End Approval, and Rollback

**Files:**
- Modify: `tests/e2e/admin-flow.spec.ts`
- Modify: `scripts/seed-e2e.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: deployed migration 023, admin/operator profiles, one small deterministic workbook fixture.
- Produces: end-to-end proof that the browser workflow and atomic database contract agree.

- [ ] **Step 1: Add deterministic E2E seed data**

Seed a unique model/line namespace such as `E2E-LEGACY-MODEL` and `E2E-LEGACY-LINE`, one duplicate target, and no ST for the candidate period. Generate or reuse a small fixture containing DAY/A and NIGHT/B evidence, quality, defect, and downtime rows; never alter a preserved source workbook.

- [ ] **Step 2: Write the failing Playwright scenario**

Test:

1. operator uploads and can inspect but cannot approve;
2. admin opens the staged batch;
3. admin approves the new model/line/shift/slot/reason and ST;
4. admin chooses duplicate replacement and commits;
5. the result shows inserted/replaced/skipped/master/ST counts;
6. dashboard filters show the committed model, line, process yield, and utilization;
7. re-upload shows the completed SHA-256 notice and creates no second batch.

- [ ] **Step 3: Run E2E and confirm initial failure**

Run: `npm run seed:e2e`

Run: `npm run test:e2e -- tests/e2e/admin-flow.spec.ts`

Expected before completing fixture/selector wiring: FAIL at candidate approval. Expected after wiring: PASS.

- [ ] **Step 4: Run the SQL rollback and RLS suite**

Run the existing `supabase/tests/rls.test.sql`, `supabase/tests/db_security_fix.test.sql`, `supabase/tests/import.test.sql`, and new `supabase/tests/legacy_master_detail_import.test.sql` against the isolated project.

Expected: all SQL assertions pass, including operator denial and all-or-nothing rollback.

- [ ] **Step 5: Run complete verification**

Run: `npm test`

Run: `npm run build`

Run: `npm run build:vite`

Run: `npm run test:e2e`

Expected: every command exits 0; both Vinext/Sites and Vite/Vercel builds type-check.

- [ ] **Step 6: Commit end-to-end verification**

```bash
git add tests/e2e/admin-flow.spec.ts scripts/seed-e2e.mjs README.md
git commit -m "test: verify legacy import approval end to end"
```

### Task 9: Deploy and Verify Production

**Files:**
- Modify only if required by verified deployment behavior: `README.md`

**Interfaces:**
- Consumes: a clean, tested branch and saved Vercel/Sites project configuration.
- Produces: production deployment with migration 023 and a recorded smoke-test result.

- [ ] **Step 1: Confirm release state**

Run: `git status --short`

Run: `git log -8 --oneline`

Expected: no uncommitted application changes and the eight feature commits are present.

- [ ] **Step 2: Apply migration 023 before frontend deployment**

Apply `supabase/migrations/023_legacy_master_detail_import.sql` to project `habfnclspdaeshjrbqzn`. Query `supabase_migrations.schema_migrations` and confirm version `023` exists exactly once.

- [ ] **Step 3: Re-run production database smoke checks**

As an operator, verify candidate staging is allowed and approval is denied. As admin employee `06032`, verify candidate approval succeeds on a disposable unique fixture. Verify an invalid detail rolls back its new master and ST. Remove only the disposable test records through the approved cleanup routine.

- [ ] **Step 4: Deploy the Vite SPA**

Deploy the verified commit to the existing Vercel project `smd-process-control-public`. Do not create a new project. Confirm the production alias remains:

`https://smd-process-control-public.vercel.app`

- [ ] **Step 5: Perform browser production smoke testing**

Verify:

- the site opens without a ChatGPT account;
- the login screen does not flicker on repeated auth events;
- worker upload/review and admin approval role gates;
- one legacy fixture’s master/ST/detail commit;
- detail pagination;
- dashboard yield and utilization reflect the committed record;
- no browser console errors or failed API requests.

- [ ] **Step 6: Record the release evidence**

Append to `README.md` the migration version, deployed commit SHA, production URL, UTC deployment time, tests run, and disposable fixture identifier. Do not record credentials, tokens, service keys, or the temporary password.

- [ ] **Step 7: Commit documentation if it changed**

```bash
git add README.md
git commit -m "docs: record legacy import release verification"
```

## Final Acceptance Checklist

- [ ] The five preserved workbook hashes and row counts still match.
- [ ] Missing models, lines, shifts, time slots, and downtime reasons appear as reviewable candidates instead of detail-row unknown-master errors.
- [ ] Unsupported processes and unknown shifts remain blocking errors.
- [ ] DAY/NIGHT slot times and night production-date semantics match the approved design.
- [ ] ST evidence shows planned seconds, CAPA, calculated value, min/median/max, and source trace.
- [ ] Median and strict `>5%` conflict behavior pass boundary tests.
- [ ] Existing ST overlap cannot be auto-created.
- [ ] Workers can inspect but cannot approve, replace, or commit new candidates.
- [ ] Admin approval creates masters/ST before resolving details, in one transaction.
- [ ] Daily quality stays without a time slot and defects/downtime stay linked.
- [ ] Duplicate default is skip; replacement requires admin choice.
- [ ] Completed batch/hash paths are idempotent and completed batches are immutable.
- [ ] 14,708 production rows stage in chunks and render through 200-row server pages.
- [ ] Original files remain private and traceable by filename, SHA-256, kind, sheet, and row.
- [ ] Database RLS, audit, rollback, and end-to-end tests pass.
- [ ] Vinext/Sites and Vite/Vercel builds pass and production remains publicly reachable without ChatGPT authentication.
