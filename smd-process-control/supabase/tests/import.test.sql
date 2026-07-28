begin;

select plan(19);

select has_function('public', 'current_app_role', array[]::text[], 'current_app_role exists');
select function_returns('public', 'current_app_role', array[]::text[], 'text', 'current_app_role returns text');
select has_function('public', 'save_production_record', array['jsonb', 'bigint'], 'save production RPC exists');
select function_returns('public', 'save_production_record', array['jsonb', 'bigint'], 'uuid', 'save production RPC returns UUID');
select has_function('public', 'commit_upload_batch', array['uuid', 'boolean'], 'upload batch RPC exists');
select function_returns('public', 'commit_upload_batch', array['uuid', 'boolean'], 'jsonb', 'upload batch RPC returns JSONB');
select is(
  has_function_privilege('anon', 'public.save_production_record(jsonb, bigint)', 'EXECUTE'),
  false,
  'anon cannot execute production RPC'
);
select is(
  has_function_privilege('anon', 'public.commit_upload_batch(uuid, boolean)', 'EXECUTE'),
  false,
  'anon cannot execute upload commit RPC'
);
select has_trigger('public', 'production_records', 'production_records_audit', 'production mutations are audited');
select has_trigger('public', 'upload_batches', 'upload_batches_guard', 'batch status transitions are guarded');
select has_trigger('public', 'upload_rows', 'upload_rows_guard', 'staged payload transitions are guarded');
select is(
  has_table_privilege('authenticated', 'public.production_records', 'DELETE'),
  false,
  'authenticated cannot physically delete production records'
);
select is(
  has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'),
  false,
  'authenticated cannot delete audit logs'
);
select is(
  has_column_privilege('authenticated', 'public.upload_batches', 'status', 'UPDATE'),
  false,
  'clients cannot mark a batch committed directly'
);
select is(
  has_table_privilege('authenticated', 'public.upload_batches', 'UPDATE'),
  false,
  'clients have no effective batch update privilege'
);
select is(
  has_table_privilege('authenticated', 'public.upload_rows', 'UPDATE'),
  false,
  'clients have no effective upload row update privilege'
);

-- Concurrent sessions are unavailable in the local pgTAP runner. The migration
-- contract is asserted statically: every upload natural key takes a transaction
-- scoped advisory lock before the existence check.
select like(
  pg_get_functiondef('public.commit_upload_batch(uuid, boolean)'::regprocedure),
  '%pg_advisory_xact_lock%',
  'upload commits serialize absent natural keys'
);
select like(
  pg_get_functiondef('public.commit_upload_batch(uuid, boolean)'::regprocedure),
  '%sourceSheet%',
  'upload RPC accepts the camelCase NormalizedImportRow contract'
);
select unlike(
  pg_get_functiondef('public.commit_upload_batch(uuid, boolean)'::regprocedure),
  '%model_code%',
  'upload RPC rejects the legacy snake_case payload contract'
);

select finish();
rollback;
