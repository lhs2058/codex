begin;

select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db-viewer@example.test', 'not-used', now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db-operator@example.test', 'not-used', now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db-admin@example.test', 'not-used', now()),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db-inactive@example.test', 'not-used', now()),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db-profileless@example.test', 'not-used', now()),
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'db-edge-created@example.test', 'not-used', now());

insert into public.profiles (id, employee_id, display_name, role, is_active)
values
  ('10000000-0000-0000-0000-000000000001', 'DB-VIEWER', 'DB Viewer', 'viewer', true),
  ('10000000-0000-0000-0000-000000000002', 'DB-OPERATOR', 'DB Operator', 'operator', true),
  ('10000000-0000-0000-0000-000000000003', 'DB-ADMIN', 'DB Admin', 'admin', true),
  ('10000000-0000-0000-0000-000000000004', 'DB-INACTIVE', 'DB Inactive', 'admin', false);

insert into public.models (id, code, name, is_active)
values
  ('10000000-0000-0000-0000-000000000101', 'DB-MODEL', 'DB Model', true),
  ('10000000-0000-0000-0000-000000000102', 'DB-MODEL-INACTIVE', 'Inactive DB Model', false),
  ('10000000-0000-0000-0000-000000000103', 'DB-MODEL-DELETED', 'Deleted DB Model', false);
update public.models
set deleted_at = now(), deleted_by = '10000000-0000-0000-0000-000000000003'
where id = '10000000-0000-0000-0000-000000000103';

insert into public.lines (id, code, name, is_active)
values
  ('10000000-0000-0000-0000-000000000104', 'DB-LINE', 'DB Line', true),
  ('10000000-0000-0000-0000-000000000105', 'DB-LINE-INACTIVE', 'Inactive DB Line', false);
insert into public.shifts (id, code, name, is_active)
values
  ('10000000-0000-0000-0000-000000000106', 'DB-SHIFT', 'DB Shift', true),
  ('10000000-0000-0000-0000-000000000107', 'DB-SHIFT-INACTIVE', 'Inactive DB Shift', false);
insert into public.time_slots (id, shift_id, code, starts_at, ends_at, sequence, is_active)
values
  ('10000000-0000-0000-0000-000000000108', '10000000-0000-0000-0000-000000000106', 'DB-SLOT', '08:00', '09:00', 1, true),
  ('10000000-0000-0000-0000-000000000109', '10000000-0000-0000-0000-000000000106', 'DB-SLOT-INACTIVE', '09:00', '10:00', 2, false);
insert into public.downtime_reasons (id, code, name, is_active)
values
  ('10000000-0000-0000-0000-000000000110', 'DB-DT', 'DB downtime', true),
  ('10000000-0000-0000-0000-000000000111', 'DB-DT-INACTIVE', 'Inactive DB downtime', false);

insert into public.production_records (
  id, production_date, shift_id, time_slot_id, line_id, model_id, process_id,
  input_qty, actual_qty, note, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000112',
  (now() at time zone 'Asia/Bangkok')::date,
  '10000000-0000-0000-0000-000000000106',
  '10000000-0000-0000-0000-000000000108',
  '10000000-0000-0000-0000-000000000104',
  '10000000-0000-0000-0000-000000000101',
  (select id from public.processes where code = 'SPI'),
  10, 9, 'existing', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'
);

insert into public.quality_records (
  id, production_record_id, production_date, shift_id, time_slot_id, line_id,
  model_id, process_id, input_qty, ok_qty, ng_qty, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000113',
  '10000000-0000-0000-0000-000000000112',
  (now() at time zone 'Asia/Bangkok')::date,
  '10000000-0000-0000-0000-000000000106',
  '10000000-0000-0000-0000-000000000108',
  '10000000-0000-0000-0000-000000000104',
  '10000000-0000-0000-0000-000000000101',
  (select id from public.processes where code = 'SPI'),
  10, 9, 1, '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'
);

insert into public.upload_batches (
  id, source_file_name, storage_path, workbook_kind, status, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000114', 'null-replace.xlsx',
  '10000000-0000-0000-0000-000000000002/null-replace.xlsx', 'standard', 'validated',
  '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'
);

-- Every effective authenticated SELECT policy must start with the active,
-- allow-listed application-role gate. One permissive legacy policy would reopen
-- all RLS predicates, so inspect the cumulative catalog rather than one file.
select is_empty(
  $$select tablename || ':' || policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'profiles','models','processes','lines','shifts','time_slots',
        'downtime_reasons','yield_targets','standard_times','production_records',
        'quality_records','defect_records','downtime_records','upload_batches',
        'upload_rows','audit_logs'
      ])
      and cmd = 'SELECT'
      and coalesce(qual, '') not like '%current_app_role() = ANY (ARRAY[''viewer''::text, ''operator''::text, ''admin''::text])%'$$,
  'every cumulative business SELECT policy requires an active allow-listed profile'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select results_eq(
  $$select
      (select count(*) from public.profiles),
      (select count(*) from public.models),
      (select count(*) from public.production_records),
      (select count(*) from public.quality_records),
      (select count(*) from public.upload_batches),
      (select count(*) from public.audit_logs)$$,
  $$values (0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint)$$,
  'profile-less authenticated callers read no profile, master, business, upload, or audit rows'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select results_eq(
  $$select
      (select count(*) from public.profiles),
      (select count(*) from public.models),
      (select count(*) from public.production_records),
      (select count(*) from public.quality_records),
      (select count(*) from public.upload_batches),
      (select count(*) from public.audit_logs)$$,
  $$values (0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint)$$,
  'inactive authenticated callers read no profile, master, business, upload, or audit rows'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select ok(
  exists (select 1 from public.models where code = 'DB-MODEL')
  and not exists (select 1 from public.models where code in ('DB-MODEL-INACTIVE', 'DB-MODEL-DELETED'))
  and exists (select 1 from public.production_records where id = '10000000-0000-0000-0000-000000000112')
  and not exists (select 1 from public.audit_logs),
  'viewer sees active operational rows but no inactive/deleted master or audit rows'
);
select throws_ok(
  $$insert into public.models(code, name) values ('VIEWER-BYPASS', 'Viewer bypass')$$,
  '42501',
  'viewer cannot bypass hardened master RPCs'
);
select throws_ok(
  $$select public.admin_list_operational_data()$$,
  '42501',
  'insufficient_privilege',
  'viewer cannot read the admin operational snapshot'
);
select throws_ok(
  $$select public.admin_manage_configuration(
      'model','create',null,0,'{"code":"VIEWER-RPC","name":"Viewer RPC"}'::jsonb
    )$$,
  '42501',
  'insufficient_privilege',
  'viewer cannot call the admin configuration RPC'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
insert into public.upload_rows (
  batch_id, source_sheet, source_row, row_kind, payload, status,
  target_record_id, expected_target_version, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000114', 'Production', 2, 'production',
  jsonb_build_object(
    'contractVersion',2,
    'defects','[]'::jsonb,
    'downtime',null,
    'lineCode','DB-LINE',
    'modelCode','DB-MODEL',
    'note','operator staged',
    'processCode','SPI',
    'production',jsonb_build_object('inputQty',20,'actualQty',18),
    'productionDate',(now() at time zone 'Asia/Bangkok')::date,
    'quality',jsonb_build_object('inputQty',20,'okQty',18,'ngQty',2),
    'shiftCode','DB-SHIFT',
    'sourceTrace',jsonb_build_object('sheet','Production','row',2),
    'timeSlotCode','DB-SLOT',
    'warnings','[]'::jsonb
  ),
  'conflict', '10000000-0000-0000-0000-000000000112', 1, auth.uid(), auth.uid()
);
select throws_ok(
  $$select public.commit_upload_batch(
      '10000000-0000-0000-0000-000000000114', null
    )$$,
  '22023',
  'upload_batch_has_conflicts',
  'NULL replacement approval fails closed'
);
select is(
  (select actual_qty from public.production_records where id = '10000000-0000-0000-0000-000000000112'),
  9,
  'NULL replacement approval cannot mutate the target'
);
select throws_ok(
  $$select public.commit_upload_batch(
      '10000000-0000-0000-0000-000000000114', true
    )$$,
  '42501',
  'insufficient_privilege',
  'server keeps replacement admin-only'
);

insert into public.upload_batches (
  id, source_file_name, storage_path, workbook_kind, status, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000115', 'too-long.xlsx',
  '10000000-0000-0000-0000-000000000002/too-long.xlsx', 'standard', 'validated',
  auth.uid(), auth.uid()
);
select throws_ok(
  $$insert into public.upload_rows (
      batch_id, source_sheet, source_row, row_kind, payload, status, created_by, updated_by
    ) values (
      '10000000-0000-0000-0000-000000000115', 'Production', 2, 'production',
      jsonb_build_object(
        'contractVersion',2,
        'defects','[]'::jsonb,
        'downtime',jsonb_build_object('minutes',61,'reasonCode','DB-DT'),
        'lineCode','DB-LINE',
        'modelCode','DB-MODEL',
        'note','too long',
        'processCode','AOI',
        'production',jsonb_build_object('inputQty',10,'actualQty',9),
        'productionDate',(now() at time zone 'Asia/Bangkok')::date,
        'quality',jsonb_build_object('inputQty',10,'okQty',9,'ngQty',1),
        'shiftCode','DB-SHIFT',
        'sourceTrace',jsonb_build_object('sheet','Production','row',2),
        'timeSlotCode','DB-SLOT',
        'warnings','[]'::jsonb
      ),
      'new', auth.uid(), auth.uid()
    )$$,
  '22023',
  'downtime_exceeds_planned_time',
  'staging guard rejects total downtime beyond the selected slot'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$select public.commit_upload_batch(
      '10000000-0000-0000-0000-000000000114', true
    )$$,
  'admin replaces the exact staged target without ambiguous-column error 42702'
);
select is(
  (select actual_qty from public.production_records where id = '10000000-0000-0000-0000-000000000112'),
  18,
  'admin replacement updates the exact target'
);

insert into public.upload_batches (
  id, source_file_name, storage_path, workbook_kind, status, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000116', 'stale.xlsx',
  '10000000-0000-0000-0000-000000000003/stale.xlsx', 'standard', 'validated',
  auth.uid(), auth.uid()
);
insert into public.upload_rows (
  batch_id, source_sheet, source_row, row_kind, payload, status,
  target_record_id, expected_target_version, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000116', 'Production', 2, 'production',
  jsonb_build_object(
    'contractVersion',2,
    'defects','[]'::jsonb,
    'downtime',null,
    'lineCode','DB-LINE',
    'modelCode','DB-MODEL',
    'note','stale',
    'processCode','SPI',
    'production',jsonb_build_object('inputQty',30,'actualQty',29),
    'productionDate',(now() at time zone 'Asia/Bangkok')::date,
    'quality',jsonb_build_object('inputQty',30,'okQty',29,'ngQty',1),
    'shiftCode','DB-SHIFT',
    'sourceTrace',jsonb_build_object('sheet','Production','row',2),
    'timeSlotCode','DB-SLOT',
    'warnings','[]'::jsonb
  ),
  'conflict', '10000000-0000-0000-0000-000000000112',
  (select version from public.production_records where id = '10000000-0000-0000-0000-000000000112'),
  auth.uid(), auth.uid()
);
reset role;
update public.production_records
set actual_qty = actual_qty + 1, version = version + 1
where id = '10000000-0000-0000-0000-000000000112';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select throws_ok(
  $$select public.commit_upload_batch(
      '10000000-0000-0000-0000-000000000116', true
    )$$,
  '40001',
  'stale_upload_target',
  'commit rejects a replacement target changed after staging'
);

insert into public.upload_batches (
  id, source_file_name, storage_path, workbook_kind, status, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000117', 'daily-quality.xlsx',
  '10000000-0000-0000-0000-000000000003/daily-quality.xlsx', 'aoi', 'validated',
  auth.uid(), auth.uid()
);
insert into public.upload_rows (
  id, batch_id, source_sheet, source_row, row_kind, payload, status, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000118',
  '10000000-0000-0000-0000-000000000117', 'AOI', 7, 'daily_quality',
  jsonb_build_object(
    'contractVersion',2,
    'defects',jsonb_build_array(
      jsonb_build_object(
        'sourceSheet','Defects','sourceRow',2,'productionSourceRow',7,
        'defectType','Bridge','classification','real','quantity',2
      ),
      jsonb_build_object(
        'sourceSheet','Defects','sourceRow',3,'productionSourceRow',7,
        'defectType','Missing','classification','scrap','quantity',1
      )
    ),
    'downtime',null,
    'lineCode','DB-LINE',
    'modelCode','DB-MODEL',
    'note','daily',
    'processCode','AOI',
    'production',null,
    'productionDate',(now() at time zone 'Asia/Bangkok')::date,
    'quality',jsonb_build_object('inputQty',100,'okQty',97,'ngQty',3),
    'shiftCode','DB-SHIFT',
    'sourceTrace',jsonb_build_object('sheet','AOI','row',7),
    'timeSlotCode',null,
    'warnings','[]'::jsonb
  ),
  'new', auth.uid(), auth.uid()
);
select lives_ok(
  $$select public.commit_upload_batch(
      '10000000-0000-0000-0000-000000000117', false
    )$$,
  'daily quality and its defects commit atomically without a production slot'
);
select is(
  (select count(*)::integer
   from public.quality_records
   where production_record_id is null
     and time_slot_id is null
     and process_id = (select id from public.processes where code = 'AOI')
     and deleted_at is null),
  1,
  'daily AOI quality persists without fabricated production'
);
select is(
  (select count(*)::integer
   from public.production_records
   where process_id = (select id from public.processes where code = 'AOI')
     and line_id = '10000000-0000-0000-0000-000000000104'
     and deleted_at is null),
  0,
  'daily quality commit does not fabricate production'
);
select is(
  (select count(*)::integer
   from public.defect_records d
    join public.quality_records q on q.id = d.quality_record_id
    where q.production_record_id is null and d.deleted_at is null),
  2,
  'all nested daily-quality defects are inserted against the committed quality row'
);
select is(
  (select count(*)::integer
   from public.defect_records
   where source_upload_row_id =
     '10000000-0000-0000-0000-000000000118'
     and deleted_at is null),
  2,
  'multiple nested defects retain the same parent upload source trace'
);
select is(
  (select sum(ok_qty)::integer from public.quality_records
   where production_record_id is null and deleted_at is null),
  97,
  'daily quality stores count inputs used for weighted yield'
);
select ok(
  exists (
    select 1 from public.quality_records q
    join public.upload_rows u on u.id = q.source_upload_row_id
    where u.id = '10000000-0000-0000-0000-000000000118'
  ),
  'daily quality preserves upload source trace'
);

select throws_ok(
  $$select public.save_production_record(jsonb_build_object(
      'production_date',(now() at time zone 'Asia/Bangkok')::date,
      'shift_id','10000000-0000-0000-0000-000000000106',
      'time_slot_id','10000000-0000-0000-0000-000000000108',
      'line_id','10000000-0000-0000-0000-000000000104',
      'model_id','10000000-0000-0000-0000-000000000102',
      'process_id',(select id from public.processes where code = 'SPI'),
      'input_qty',1,'actual_qty',1,'ok_qty',1,'ng_qty',0,'note','inactive model',
      'downtime','[]'::jsonb
    ), 0)$$,
  '22023',
  'inactive_master_data',
  'manual save rejects an inactive model'
);
select throws_ok(
  $$select public.save_production_record(jsonb_build_object(
      'production_date',(now() at time zone 'Asia/Bangkok')::date,
      'shift_id','10000000-0000-0000-0000-000000000106',
      'time_slot_id','10000000-0000-0000-0000-000000000108',
      'line_id','10000000-0000-0000-0000-000000000104',
      'model_id','10000000-0000-0000-0000-000000000101',
      'process_id',(select id from public.processes where code = 'ICT'),
      'input_qty',1,'actual_qty',1,'ok_qty',1,'ng_qty',0,'note','inactive reason',
      'downtime',jsonb_build_array(jsonb_build_object(
        'reason_id','10000000-0000-0000-0000-000000000111','minutes',1,'note','inactive'
      ))
    ), 0)$$,
  '22023',
  'inactive_master_data',
  'manual save rejects an inactive downtime reason'
);

select throws_ok(
  $$insert into public.models(code, name) values ('ADMIN-BYPASS', 'Admin bypass')$$,
  '42501',
  'admin cannot bypass optimistic master RPCs with direct DML'
);
select lives_ok(
  $$select public.admin_manage_configuration(
      'model','create',null,0,
      '{"code":"RPC-MODEL","name":"RPC Model"}'::jsonb
    )$$,
  'admin creates a model through the hardened RPC'
);
select lives_ok(
  $$select public.admin_manage_configuration(
      'model','update',
      (select id from public.models where code = 'RPC-MODEL'),1,
      jsonb_build_object('code','RPC-MODEL','name','RPC Model Updated')
    )$$,
  'admin updates a model with optimistic locking'
);
select lives_ok(
  $$select public.admin_manage_configuration(
      'model','deactivate',
      (select id from public.models where code = 'RPC-MODEL'),2,'{}'::jsonb
    )$$,
  'admin deactivates a model through the hardened RPC'
);
select lives_ok(
  $$select public.admin_manage_configuration(
      'model','reactivate',
      (select id from public.models where code = 'RPC-MODEL'),3,'{}'::jsonb
    )$$,
  'admin reactivates a model through the hardened RPC'
);
select throws_ok(
  $$select public.admin_manage_configuration(
      'model','update',
      (select id from public.models where code = 'RPC-MODEL'),1,
      jsonb_build_object('code','RPC-MODEL','name','Stale')
    )$$,
  '40001',
  'record_version_conflict',
  'admin master update rejects a stale version'
);
select lives_ok(
  $$select public.admin_manage_profile(
      '10000000-0000-0000-0000-000000000001','operator',false,1
    )$$,
  'admin changes user role and deactivates through a hardened RPC'
);
select ok(
  (snapshot -> 'models') @> '[{"code":"DB-MODEL-DELETED"}]'::jsonb
  and jsonb_typeof(snapshot -> 'profiles') = 'array'
  and jsonb_typeof(snapshot -> 'upload_batches') = 'array'
  and jsonb_typeof(snapshot -> 'audit_logs') = 'array'
  and jsonb_typeof(snapshot -> 'production_records') = 'array',
  'admin operational snapshot includes inactive/deleted masters and administrative history'
)
from (select public.admin_list_operational_data() as snapshot) as operational;

reset role;
insert into public.production_records (
  id, production_date, shift_id, time_slot_id, line_id, model_id, process_id,
  input_qty, actual_qty, created_by, updated_by
)
values (
  '10000000-0000-0000-0000-000000000120',
  (now() at time zone 'Asia/Bangkok')::date,
  '10000000-0000-0000-0000-000000000106',
  '10000000-0000-0000-0000-000000000108',
  '10000000-0000-0000-0000-000000000104',
  '10000000-0000-0000-0000-000000000101',
  (select id from public.processes where code = 'ICT'),
  1, 1, '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select ok(
  (deleted_result ->> 'id')::uuid =
    '10000000-0000-0000-0000-000000000120'::uuid
  and (deleted_result ->> 'version')::bigint = 2,
  'admin soft-delete returns the deleted production id and incremented version'
)
from (
  select public.admin_soft_delete_production(
    '10000000-0000-0000-0000-000000000120',1
  ) as deleted_result
) as deletion;
select ok(
  exists (
    select 1 from public.production_records
    where id = '10000000-0000-0000-0000-000000000120'
      and deleted_at is not null
  ),
  'admin retains soft-deleted production for historical visibility'
);
select throws_ok(
  $$select public.admin_create_profile(
      '10000000-0000-0000-0000-000000000006',
      '9001','DB Edge','viewer',auth.uid()
    )$$,
  '42501',
  'authenticated clients cannot spoof the verified Edge actor'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select lives_ok(
  $$select public.admin_create_profile(
      '10000000-0000-0000-0000-000000000006',
      '9001','DB Edge','viewer',
      '10000000-0000-0000-0000-000000000003'
    )$$,
  'service-role Edge contract propagates a previously verified active admin actor'
);
reset role;
select is(
  (select actor_id
   from public.audit_logs
   where table_name = 'profiles'
     and record_id = '10000000-0000-0000-0000-000000000006'
   order by created_at desc
   limit 1),
  '10000000-0000-0000-0000-000000000003'::uuid,
  'Edge-created profile audit records the verified caller actor'
);

select ok(
  not has_function_privilege('anon', 'public.commit_upload_batch(uuid,boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.commit_upload_batch(uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.admin_create_profile(uuid,text,text,text,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.admin_create_profile(uuid,text,text,text,uuid)', 'EXECUTE'),
  'RPC grants deny anon and reserve the Edge actor contract for service_role'
);
select ok(
  not has_table_privilege('anon', 'public.models', 'SELECT')
  and not has_table_privilege('authenticated', 'public.models', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.production_records', 'DELETE'),
  'table grants enforce RLS reads, RPC-only admin writes, and soft deletion'
);
select ok(
  exists (
    select 1
    from public.downtime_reasons
    where code = 'LEGACY_UNSPECIFIED'
      and is_active
      and deleted_at is null
  ),
  'legacy unspecified downtime reason is active and available'
);
select ok(
  not exists (
    select 1
    from pg_publication_tables publication
    join pg_policies policy
      on policy.schemaname = publication.schemaname
     and policy.tablename = publication.tablename
    where publication.pubname = 'supabase_realtime'
      and publication.schemaname = 'public'
      and publication.tablename in ('production_records','quality_records')
      and policy.cmd = 'SELECT'
      and coalesce(policy.qual, '') not like '%current_app_role() = ANY (ARRAY[''viewer''::text, ''operator''::text, ''admin''::text])%'
  ),
  'business realtime source tables inherit the same active-profile SELECT gate'
);

select * from finish();
rollback;
