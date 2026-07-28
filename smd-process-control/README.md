# SMD Process Control

Independent React/Vite and Supabase application for SMD production entry, quality/import workflows, dashboards, analysis, and role-based administration.

## Safety boundary

Deploy this repository to a **new, dedicated Supabase project and a new, dedicated hosting project**. Do not link it to the personnel-status application or reuse that application's database, Storage, Auth users, service-role key, hosting project, or deployment metadata. A project reference, URL, or token from another system is a stop condition.

Never commit `.env`, passwords, database URLs, JWTs, service-role keys, source workbooks, database dumps, or generated hosting metadata. `.openai/hosting.json` may be created only by the selected connected Sites workflow; do not write it by hand.

## Local prerequisites and environment

Use Node.js 22 or newer, npm, the Supabase CLI, Docker Desktop (for the local Supabase stack), and Playwright Chromium.

```powershell
npm ci
Copy-Item .env.example .env.local
npx supabase start
```

Copy the local API URL and publishable/anon key reported by `supabase start` into `.env.local`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local publishable key>
```

`VITE_SUPABASE_ANON_KEY` is legacy compatibility only. Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `VITE_` variable. Start the app with `npm run dev`; the default URL is `http://127.0.0.1:5173`.

The responsive fixture is intentionally limited to a Vite development build, `VITE_RESPONSIVE_TEST=true`, and an explicit `responsive-test` query. It is not a production authentication mechanism.

## Database, Storage, Realtime, and Edge Function

Rebuild local state and run database tests:

```powershell
npx supabase db reset
npx supabase test db
```

The ordered files in `supabase/migrations` are the source of truth. In particular, migration `012_upload_originals_storage.sql` creates the private `smd-upload-originals` bucket and owner/admin policies, while `013_dashboard_realtime.sql` adds `production_records` and `quality_records` to `supabase_realtime`. After every target deployment, verify:

```sql
select id, public from storage.buckets where id = 'smd-upload-originals';
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('production_records', 'quality_records')
order by tablename;
```

Link and deploy only after checking that the printed project reference is the new SMD project:

```powershell
npx supabase link --project-ref <NEW_SMD_PROJECT_REF>
npx supabase db push --linked
npx supabase functions deploy admin-create-user --project-ref <NEW_SMD_PROJECT_REF>
```

The `admin-create-user` function validates the caller's JWT and active admin profile itself. Its runtime needs `SUPABASE_URL`, a publishable/anon key, and `SUPABASE_SERVICE_ROLE_KEY`; keep those only in the Supabase project secret store. Configure the production Auth site URL and allowed redirect URLs to the final SMD hosting origin. Anonymous sign-in remains disabled.

## First administrator

The first admin is the only bootstrap exception because no in-app admin exists yet:

1. In the new SMD Supabase project, create and confirm an Auth user whose email is `<employee-id>@smd.internal`; use a temporary password delivered out of band.
2. Copy that Auth user's UUID.
3. In the project SQL editor, insert its profile using placeholders, not real values in source control:

```sql
insert into public.profiles
  (id, employee_id, display_name, role, is_active, created_by, updated_by)
values
  ('<AUTH_USER_UUID>', '<EMPLOYEE_ID>', '<DISPLAY_NAME>', 'admin', true,
   '<AUTH_USER_UUID>', '<AUTH_USER_UUID>');
```

4. Sign in through the application and create subsequent viewer/operator/admin users from the admin page. Rotate the bootstrap password immediately.

## Standard template and original preservation

Download the supported import template from **엑셀 업로드 → 표준 양식 다운로드**. Do not edit an original legacy workbook in place. Copy it to a working location, upload the copy, review every diagnostic and duplicate, and retain the original read-only with its filename, modification time, and checksum.

Successful uploads preserve the received workbook in the private `smd-upload-originals` bucket. Database rows do not replace the original file. Do not commit any source workbook or copy it into test fixtures.

The five-source reconciliation test uses anonymized SHA-256 prefixes for filenames, models, and lines and literal quantity expectations—never displayed percentage cells. It is critical and deliberately fails when its explicit source directory is missing:

```powershell
$env:SMD_SOURCE_WORKBOOK_DIR='X:\read-only\SMD source workbooks'
npx vitest run tests/integration/source-reconciliation.test.ts
```

The directory must contain exactly the five preserved `.xlsx` originals.

## Backup and restore

Before a migration or release:

1. Confirm the project reference is the dedicated SMD project.
2. Take a managed Supabase database backup (or an encrypted `pg_dump` using the project's direct database connection).
3. Export the private `smd-upload-originals` objects and record object paths/checksums separately; database backup does not substitute for Storage backup.
4. Store database and object backups encrypted outside the repository and test restoration on an isolated SMD recovery project.

Restore into an empty, isolated recovery project: restore the database dump with the PostgreSQL tools matching the server major version, restore Storage objects to the same paths, apply any later migrations with `supabase db push`, deploy the Edge Function, then run the SQL checks above and the full verification suite. Never rehearse a restore against production.

## E2E fixture and verification

The checked-in seed workflow is deliberately local-only. It refuses remote URLs, requires the standard local API endpoint (`http://127.0.0.1:54321`), requires an explicit confirmation phrase, and permits its generated workbook only under `.e2e`. It uses the local service-role key only in the Node seed process; that key is never exposed to Vite, written to the manifest, or committed.

After `npx supabase db reset`, set fresh local-only secrets and run:

```powershell
$env:SUPABASE_URL='http://127.0.0.1:54321'
$env:SUPABASE_SERVICE_ROLE_KEY='<service-role key printed by local Supabase>'
$env:E2E_OPERATOR_PASSWORD='<local test password>'
$env:E2E_ADMIN_PASSWORD='<local test password>'
$env:E2E_VIEWER_PASSWORD='<local test password>'
$env:E2E_DUPLICATE_WORKBOOK='.e2e\duplicate-upload.xlsx'
$env:E2E_SEED_CONFIRM='local-only-smd-e2e'
npm run seed:e2e
```

The script is idempotent for its fixture scope. It creates or updates employee IDs `910001` (operator), `910002` (admin), and `910003` (viewer); their Auth UUIDs are resolved and recorded without credentials in `.e2e/seed-manifest.json`. It creates fixed-ID `E2E-MODEL`, `LINE-1`, `LINE-2`, `E2E-DAY`, `E2E-08`, `E2E-09`, `E2E-WAIT`, standard-time, target, production, quality, and downtime fixtures. AOI is the migration-owned process and its resolved UUID is written to the manifest.

For the Bangkok current day, the fixed concurrency record
`e2000000-0000-4000-8000-000000000101` is version 3 with input/actual/OK/NG `100/100/99/1` and 5 downtime minutes. A second report record contributes actual 200, so the `LINE-1` dashboard baseline is exactly 300. The concurrency edit is `110/110/109/1`, advances the first record to version 4, and makes the exact dashboard total 310. The generated workbook duplicates the separate report record (`E2E-09`) so admin replacement cannot invalidate the concurrency version.

Load the public E2E variables from that contract:

```powershell
$manifest = Get-Content '.e2e\seed-manifest.json' -Raw | ConvertFrom-Json
$env:E2E_OPERATOR_EMPLOYEE_ID='910001'
$env:E2E_ADMIN_EMPLOYEE_ID='910002'
$env:E2E_VIEWER_EMPLOYEE_ID='910003'
$env:E2E_SHIFT_LABEL='E2E Day Shift'
$env:E2E_TIME_SLOT_LABEL='E2E-08'
$env:E2E_LINE_LABEL='E2E Operator Line'
$env:E2E_CONCURRENCY_TIME_SLOT_LABEL='E2E-08'
$env:E2E_CONCURRENCY_LINE_LABEL='E2E Line 1'
$env:E2E_MODEL_LABEL='E2E Model'
$env:E2E_PROCESS_LABEL='AOI'
$env:E2E_OPERATOR_DATE=$manifest.productionDate
$env:E2E_OPERATOR_ACTUAL='47'
$env:E2E_CONCURRENCY_DATE=$manifest.productionDate
$env:E2E_ADMIN_MODEL_CODE='E2E-ADMIN-MODEL'
$env:E2E_ADMIN_MODEL_NAME='E2E Admin Model'
$env:E2E_ST_SECONDS='11'
$env:E2E_ST_EFFECTIVE_FROM='2020-01-01'
```

The three password variables remain in the current shell for Playwright. Do not put them in a tracked file. Missing E2E configuration is an error, not a skipped critical test. Re-run `npm run seed:e2e` before a fresh full browser suite; the seed removes only prior records in its fixed local fixture scope and does not weaken RLS or add a production bypass.

Run the release gate:

```powershell
$env:SMD_SOURCE_WORKBOOK_DIR='X:\read-only\SMD source workbooks'
npm test
npx supabase db reset
npm run seed:e2e
npx supabase test db
npm run build
npx playwright test --list
npm run test:e2e
```

The E2E suite verifies operator/admin/viewer navigation and direct-route guards, admin-only duplicate replacement, report downloads, two-context `record_version_conflict` draft retention, and dashboard Realtime refresh within five seconds. No critical test may be skipped.

## Independent hosting deployment

Build with the new SMD project's public client values:

```powershell
npm ci
npm run build
```

Use the connected Sites workflow to create or select a dedicated SMD hosting project, push the exact reviewed source state, save a version from that commit, and deploy only that saved version. The workflow—not a developer—owns `.openai/hosting.json`. Do not reuse deployment metadata from another application.

At the production URL, repeat login for all roles, operator entry, admin upload validation/replacement, dashboard Realtime refresh, analysis Excel/PDF downloads, forbidden direct URLs, Storage preservation, and Auth redirects. Record the source commit, migration set, Edge Function version, saved hosting version, production URL, backup identifier, and verification results in the release record.
