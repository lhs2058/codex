# Round 3 Candidate Evidence Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely stage and review legitimate large candidate evidence while preventing numeric expansion attacks and enforcing the same completeness gate on every public commit entry point.

**Architecture:** Keep complete validated evidence in the existing candidate JSON columns under strict per-candidate and per-array limits. Return only a bounded first page from the main review RPC, add a separately authorized evidence-page RPC for expansion, and centralize the server commit predicate in one private function used by both public commit wrappers.

**Tech Stack:** PostgreSQL 17 / Supabase RPCs and RLS helpers, React 19, TypeScript, Vitest, Testing Library, pgTAP contract fixtures.

## Global Constraints

- The migration remains local-only and must not be applied.
- Do not create a git commit.
- Candidate JSON is at most 262,144 bytes; source/observation arrays are at most 500 elements; message arrays are at most 100 elements.
- Every projected number is range- and scale-validated before any text cast or response projection.
- Main review evidence page size is 20; evidence RPC limit is clamped to 1..50.
- First-page truncation is informational; malformed, oversized, unsafe, or more-than-100 candidate sets remain fail-closed.
- Preserve Task 26 operator/admin role, ownership, and existing-only semantics.

---

### Task 1: Numeric and evidence staging contracts

**Files:**
- Modify: `tests/unit/db-security-fix-contract.test.ts`
- Modify: `supabase/tests/legacy_master_detail_import.test.sql`
- Modify: `tests/unit/legacy-master-candidates.test.ts`
- Modify: `supabase/migrations/20260731010321_staged_upload_review.sql`

**Interfaces:**
- Consumes: existing `private.legacy_*_candidate_payload_is_safe(jsonb)` guards.
- Produces: safe-number helper semantics, 256 KiB candidate limit, 500 evidence and 100 message limits.

- [ ] Add RED SQL-contract and pgTAP cases for exponent-form numerics and 21 legitimate observations/sources.
- [ ] Run the focused tests and confirm failure because range/scale checks and larger evidence limits are absent.
- [ ] Add JSON-number validation that checks a bounded range before conversion and then enforces scale/integrality.
- [ ] Update both candidate guards and bounded response projections to use validated numerics.
- [ ] Run the focused tests and confirm GREEN.

### Task 2: Shared commit completeness gate

**Files:**
- Modify: `tests/unit/db-security-fix-contract.test.ts`
- Modify: `supabase/tests/legacy_master_detail_import.test.sql`
- Modify: `supabase/migrations/20260731010321_staged_upload_review.sql`

**Interfaces:**
- Produces: `private.legacy_upload_candidate_review_is_complete(uuid) returns boolean`.
- Preserves: Task 26 implementation as `private.commit_upload_batch_existing_validated(uuid, boolean)`.

- [ ] Add RED contracts proving both public commit signatures call the shared predicate and the zero-approval path rejects unsafe candidate state.
- [ ] Run the focused test and confirm failure because only the master-aware path is guarded.
- [ ] Move the Task 26 public wrapper to `private`, revoke its ACL, and create a non-recursive public wrapper that checks completeness before delegation.
- [ ] Refactor the master-aware wrapper to use the same predicate.
- [ ] Run the focused tests and confirm GREEN.

### Task 3: Bounded evidence paging and UI expansion

**Files:**
- Modify: `tests/unit/db-security-fix-contract.test.ts`
- Modify: `tests/integration/upload-flow.test.tsx`
- Modify: `src/domain/types.ts`
- Modify: `src/data/repositories/upload-repository.ts`
- Modify: `src/features/upload/UploadPage.tsx`
- Modify: `src/features/upload/UploadMasterReview.tsx`
- Modify: `src/features/upload/UploadStandardTimeReview.tsx`
- Modify: `src/i18n/ko.ts`
- Modify: `src/i18n/vi.ts`
- Modify: `supabase/migrations/20260731010321_staged_upload_review.sql`

**Interfaces:**
- Produces: `public.get_upload_candidate_evidence(uuid,text,text,text,integer,integer) returns jsonb`.
- Produces: repository `loadCandidateEvidencePage(batchId, candidateType, candidateKey, evidenceType, offset)`.
- Produces: candidate `sourceTotal`, `messageTotal`, and `observationTotal` metadata.

- [ ] Add RED repository/UI tests for displayed/total counts, pagewise loading, and commit remaining enabled for safe first-page truncation.
- [ ] Run focused tests and confirm failure because the RPC mapping and UI expansion controls do not exist.
- [ ] Add the authorized bounded paging RPC with `private.can_view_upload_batch`, no storage path, safe projection, and limit clamping.
- [ ] Map page results through the repository and append them to the matching candidate in `UploadPage`.
- [ ] Render localized displayed/total status and load-more controls in both review components.
- [ ] Remove informational truncation from incomplete-review blocking while retaining all unsafe flags.
- [ ] Run focused tests and confirm GREEN.

### Task 4: Verification and report

**Files:**
- Modify: `.superpowers/sdd/2026-07-29-legacy-workbook-master-import/task-8-report.md`

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: fresh verification evidence and explicit PostgreSQL runtime gap.

- [ ] Run focused Vitest suites.
- [ ] Run the full Vitest suite with the source workbook environment.
- [ ] Run both production builds.
- [ ] Run Playwright discovery and `git diff --check`.
- [ ] Attempt transaction-local SQL validation only if connector access is available; never apply the migration.
- [ ] Update the Task 8 report with Round 3 RED/GREEN counts and remaining blockers.
