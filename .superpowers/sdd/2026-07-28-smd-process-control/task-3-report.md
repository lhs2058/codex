# Task 3 Report — PostgreSQL schema, constraints, and indexes

## Summary

Implemented the independent SMD Process Control Supabase configuration and migrations. The schema includes all contracted master, operational, upload, and audit tables; UUID identifiers; audit/version fields; Asia/Bangkok business-date semantics; exact process seeds; and the required integrity constraints and filter indexes.

## Files

- `smd-process-control/supabase/config.toml`
- `smd-process-control/supabase/migrations/001_core_schema.sql`
- `smd-process-control/supabase/migrations/002_constraints_indexes.sql`
- `smd-process-control/supabase/migrations/005_seed_processes.sql`
- `smd-process-control/supabase/tests/schema.test.sql`

## RED evidence

1. Wrote `supabase/tests/schema.test.sql` before the migrations, using the corrected `select plan(7);` count.
2. Discovered CLI commands with:
   - `npx --no-install supabase --help`
   - `npx --no-install supabase test --help`
   - `npx --no-install supabase start --help`
   - `npx --no-install supabase test db --help`
   - `npx --no-install supabase db reset --help`
3. Ran the prescribed RED workflow:
   - `npx --no-install supabase start; npx --no-install supabase test db --local supabase/tests/schema.test.sql`
   - Result: failed before tests could connect, with `Docker Desktop is a prerequisite for local development` and missing Windows Docker pipe `//./pipe/docker_engine`.

## GREEN evidence

- Static schema-contract verification passed (`STATIC_SCHEMA_CONTRACTS_OK`): all 16 contracted tables, corrected pgTAP plan count, quality/ST/overlap/uniqueness constraints, RLS preparation, authenticated grant, and all five exact process codes are present.
- `git diff --check` passed.
- `npm test -- --run` passed: 3 files, 13 tests.

## Commands and results

| Command | Result |
| --- | --- |
| `npx --no-install supabase --help` and subcommand help | Passed; commands/flags discovered before use. |
| `npx --no-install supabase start; npx --no-install supabase test db --local supabase/tests/schema.test.sql` | Blocked before pgTAP by unavailable Docker daemon. |
| Static PowerShell schema-contract verification | Passed (`STATIC_SCHEMA_CONTRACTS_OK`). |
| `git diff --check` | Passed. |
| `npm test -- --run` | Passed: 13 tests. |

## Assumptions and blockers

- `production_date` is the Asia/Bangkok business date; time-zone conversion occurs at the application/API boundary, while the persisted business date remains a PostgreSQL `date`.
- All public business tables have RLS enabled, but Task 4 owns the role-specific policy definitions. Explicit `authenticated` grants prepare required Data API access; RLS denies direct row access until those policies are added.
- The local pgTAP GREEN run and `supabase db reset` could not be performed because Docker Desktop/the Docker daemon was unavailable. No database test result was fabricated.

## Commit

`8f4a49290060c9a13f06f156d72c970ab4efdf41` (`feat(smd): define process control database schema`)
