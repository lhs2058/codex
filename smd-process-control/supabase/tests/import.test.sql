begin;

select plan(8);

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

select finish();
rollback;
