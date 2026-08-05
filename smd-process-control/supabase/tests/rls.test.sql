begin;

select plan(44);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@example.test', 'not-used', now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'operator@example.test', 'not-used', now()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@example.test', 'not-used', now());

insert into public.profiles (id, employee_id, display_name, role)
values
  ('00000000-0000-0000-0000-000000000101', 'VIEWER-1', 'Viewer', 'viewer'),
  ('00000000-0000-0000-0000-000000000102', 'OPERATOR-1', 'Operator', 'operator'),
  ('00000000-0000-0000-0000-000000000103', 'ADMIN-1', 'Admin', 'admin');

insert into public.models (id, code, name)
values ('00000000-0000-0000-0000-000000000201', 'TEST-MODEL', 'Test model');
insert into public.lines (id, code, name)
values
  ('00000000-0000-0000-0000-000000000202', 'TEST-LINE', 'Test line'),
  ('00000000-0000-0000-0000-000000000205', 'TEST-LINE-2', 'Second test line');
insert into public.shifts (id, code, name)
values ('00000000-0000-0000-0000-000000000203', 'TEST-SHIFT', 'Test shift');
insert into public.time_slots (id, shift_id, code, starts_at, ends_at, sequence)
values ('00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000203', 'TEST-SLOT', '08:00', '09:00', 1);
insert into public.downtime_reasons (id, code, name)
values ('00000000-0000-0000-0000-000000000209', 'TEST-DT', 'Test downtime');

insert into public.models (id, code, name, is_active)
values ('00000000-0000-0000-0000-000000000301', 'HIST-MODEL', 'Historical model', false);
update public.processes set is_active = false where code = 'ICT';
insert into public.lines (id, code, name, is_active)
values ('00000000-0000-0000-0000-000000000302', 'HIST-LINE', 'Historical line', false);
insert into public.shifts (id, code, name, is_active)
values ('00000000-0000-0000-0000-000000000303', 'HIST-SHIFT', 'Historical shift', false);
insert into public.time_slots (id, shift_id, code, starts_at, ends_at, sequence, is_active)
values ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000303', 'HIST-SLOT', '09:00', '10:00', 99, false);
insert into public.downtime_reasons (id, code, name, is_active)
values ('00000000-0000-0000-0000-000000000305', 'HIST-DT', 'Historical downtime', false);
insert into public.standard_times (
  id, model_id, process_id, line_id, seconds_per_unit, effective_from, effective_to
)
values (
  '00000000-0000-0000-0000-000000000306',
  '00000000-0000-0000-0000-000000000301',
  (select id from public.processes where code = 'ICT'),
  '00000000-0000-0000-0000-000000000302',
  60, '2025-01-01', null
);

set local role anon;
select throws_ok(
  $$select public.list_historical_master_data()$$,
  '42501',
  'anonymous callers cannot execute the historical master RPC'
);
select throws_ok(
  $$select public.set_my_language('vi')$$,
  '42501',
  'anonymous callers cannot execute the self-service language RPC'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000199', true);
select throws_ok(
  $$select public.list_historical_master_data()$$,
  '42501',
  'authenticated callers without an active application profile are denied'
);
select throws_ok(
  $$select public.set_my_language('vi')$$,
  '42501',
  'authenticated callers without an active application profile are denied language changes'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select is(public.current_app_role(), 'viewer', 'viewer role is read-only');
select lives_ok(
  $$select public.set_my_language('vi')$$,
  'viewer can call the self-service language RPC'
);
select is(
  (select language from public.profiles where id = auth.uid()),
  'vi',
  'viewer updates their own language through the self-service RPC'
);
reset role;
select is(
  (select language from public.profiles where id = '00000000-0000-0000-0000-000000000102'),
  'ko',
  'viewer language RPC cannot update another profile'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select ok(
  (snapshot -> 'models') @> '[{"code":"HIST-MODEL","is_active":false}]'::jsonb
  and (snapshot -> 'processes') @> '[{"code":"ICT","is_active":false}]'::jsonb
  and (snapshot -> 'lines') @> '[{"code":"HIST-LINE","is_active":false}]'::jsonb
  and (snapshot -> 'shifts') @> '[{"code":"HIST-SHIFT","is_active":false}]'::jsonb
  and (snapshot -> 'time_slots') @> '[{"code":"HIST-SLOT"}]'::jsonb
  and (snapshot -> 'downtime_reasons') @> '[{"code":"HIST-DT","is_active":false}]'::jsonb
  and (snapshot -> 'standard_times') @> '[{"seconds_per_unit":60}]'::jsonb,
  'viewer reads inactive historical labels, slots, reasons, and standard times only through the RPC'
)
from (select public.list_historical_master_data() snapshot) history;
select is_empty(
  $$select code from public.models where code = 'HIST-MODEL'
    union all select code from public.processes where code = 'ICT'
    union all select code from public.lines where code = 'HIST-LINE'
    union all select code from public.shifts where code = 'HIST-SHIFT'
    union all select code from public.time_slots where code = 'HIST-SLOT'
    union all select code from public.downtime_reasons where code = 'HIST-DT'$$,
  'viewer normal master reads remain active-only'
);
select throws_ok(
  $$insert into public.models(code, name) values ('PE-35', 'PE-35')$$,
  '42501',
  'viewer cannot write master data'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select is(public.current_app_role(), 'operator', 'operator role is resolved from profiles');
select lives_ok(
  $$select public.set_my_language('vi')$$,
  'operator can call the self-service language RPC'
);
select is(
  (select language from public.profiles where id = auth.uid()),
  'vi',
  'operator updates their own language through the self-service RPC'
);
select throws_ok(
  $$select public.set_my_language('en')$$,
  '22023',
  'invalid_language',
  'self-service language RPC rejects values outside the allowlist'
);
select ok(
  (snapshot -> 'models') @> '[{"code":"HIST-MODEL","is_active":false}]'::jsonb
  and (snapshot -> 'processes') @> '[{"code":"ICT","is_active":false}]'::jsonb
  and (snapshot -> 'lines') @> '[{"code":"HIST-LINE","is_active":false}]'::jsonb
  and (snapshot -> 'shifts') @> '[{"code":"HIST-SHIFT","is_active":false}]'::jsonb
  and (snapshot -> 'time_slots') @> '[{"code":"HIST-SLOT"}]'::jsonb
  and (snapshot -> 'downtime_reasons') @> '[{"code":"HIST-DT","is_active":false}]'::jsonb
  and (snapshot -> 'standard_times') @> '[{"seconds_per_unit":60}]'::jsonb,
  'operator reads inactive historical labels, slots, reasons, and standard times only through the RPC'
)
from (select public.list_historical_master_data() snapshot) history;
select is_empty(
  $$select code from public.models where code = 'HIST-MODEL'
    union all select code from public.processes where code = 'ICT'
    union all select code from public.lines where code = 'HIST-LINE'
    union all select code from public.shifts where code = 'HIST-SHIFT'
    union all select code from public.time_slots where code = 'HIST-SLOT'
    union all select code from public.downtime_reasons where code = 'HIST-DT'$$,
  'operator normal master reads remain active-only'
);
select throws_ok(
  $$insert into public.models(code, name) values ('PE-36', 'PE-36')$$,
  '42501',
  'operator cannot write master data'
);
select throws_ok(
  $$insert into public.production_records (production_date, shift_id, time_slot_id, line_id, model_id, process_id, created_by, updated_by)
    values ((now() at time zone 'Asia/Bangkok')::date, '00000000-0000-0000-0000-000000000203',
      '00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000202',
      '00000000-0000-0000-0000-000000000201', (select id from public.processes where code = 'SPI'), auth.uid(), auth.uid())$$,
  '42501', 'operator cannot bypass atomic production RPC'
);
select throws_ok(
  $$select public.save_production_record(jsonb_build_object(
      'production_date', (now() at time zone 'Asia/Bangkok')::date,
      'shift_id', '00000000-0000-0000-0000-000000000203',
      'time_slot_id', '00000000-0000-0000-0000-000000000204',
      'line_id', '00000000-0000-0000-0000-000000000202',
      'model_id', '00000000-0000-0000-0000-000000000201',
      'process_id', (select id from public.processes where code = 'SPI'),
      'input_qty', 1, 'actual_qty', 1), null)$$,
  'PT409', 'record_version_conflict', 'NULL expected version is rejected for create'
);
select throws_ok(
  $$select public.save_production_record(jsonb_build_object(
    'production_date', (now() at time zone 'Asia/Bangkok')::date,
    'shift_id', '00000000-0000-0000-0000-000000000203',
    'time_slot_id', '00000000-0000-0000-0000-000000000204',
    'line_id', '00000000-0000-0000-0000-000000000202',
    'model_id', '00000000-0000-0000-0000-000000000201',
    'process_id', (select id from public.processes where code = 'SPI'),
    'input_qty', 1, 'actual_qty', 1, 'ok_qty', 1, 'ng_qty', 0, 'note', 'seconds-range',
    'downtime', jsonb_build_array(jsonb_build_object('reason_id', '00000000-0000-0000-0000-000000000209', 'start_time', '08:00:30', 'end_time', '08:01:30', 'note', 'fractional minute'))), 0)$$,
  '22023', 'invalid_downtime_duration', 'second-level downtime range is rejected'
);
select is_empty(
  $$select * from public.production_records where note = 'seconds-range'$$,
  'invalid downtime range leaves no production record'
);
select throws_ok(
  $$update public.production_records set line_id = '00000000-0000-0000-0000-000000000205' where created_by = auth.uid()$$,
  '42501', 'direct production edits are denied'
);
select is_empty(
  $$select * from public.production_records where deleted_at is not null$$,
  'active-only reader does not receive soft-deleted production data'
);
select throws_ok(
  $$delete from public.production_records where created_by = auth.uid()$$,
  '42501', 'operators cannot physically delete production records'
);
insert into public.upload_batches (id, source_file_name, storage_path, workbook_kind, created_by, updated_by)
values ('00000000-0000-0000-0000-000000000206', 'test.xlsx', 'test/test.xlsx', 'standard', auth.uid(), auth.uid());
select throws_ok(
  $$update public.upload_batches set status = 'committed' where id = '00000000-0000-0000-0000-000000000206'$$,
  '42501', 'clients cannot forge a committed upload batch'
);
select throws_ok(
  $$insert into public.upload_rows (batch_id, source_sheet, source_row, row_kind, payload, status, production_record_id, created_by, updated_by)
    select '00000000-0000-0000-0000-000000000206', 'Production', 2, 'production', '{}'::jsonb, 'new', id, auth.uid(), auth.uid()
    from public.production_records where created_by = auth.uid() limit 1$$,
  '42501', 'clients cannot forge a staged row target record'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
select is(public.current_app_role(), 'admin', 'admin role is resolved from profiles');
select lives_ok(
  $$select public.set_my_language('vi')$$,
  'admin can call the self-service language RPC'
);
select is(
  (select language from public.profiles where id = auth.uid()),
  'vi',
  'admin updates their own language through the self-service RPC'
);
select throws_ok(
  $$update public.profiles
    set display_name = 'Viewer managed by admin'
    where id = '00000000-0000-0000-0000-000000000101'$$,
  '42501',
  'admin profile writes are restricted to hardened RPCs'
);
select ok(
  (snapshot -> 'models') @> '[{"code":"HIST-MODEL","is_active":false}]'::jsonb
  and (snapshot -> 'processes') @> '[{"code":"ICT","is_active":false}]'::jsonb
  and (snapshot -> 'lines') @> '[{"code":"HIST-LINE","is_active":false}]'::jsonb
  and (snapshot -> 'shifts') @> '[{"code":"HIST-SHIFT","is_active":false}]'::jsonb
  and (snapshot -> 'time_slots') @> '[{"code":"HIST-SLOT"}]'::jsonb
  and (snapshot -> 'downtime_reasons') @> '[{"code":"HIST-DT","is_active":false}]'::jsonb
  and (snapshot -> 'standard_times') @> '[{"seconds_per_unit":60}]'::jsonb,
  'admin reads inactive historical labels, slots, reasons, and standard times through the RPC'
)
from (select public.list_historical_master_data() snapshot) history;
select throws_ok(
  $$insert into public.models(code, name) values ('PE-37', 'PE-37')$$,
  '42501',
  'admin master writes are restricted to hardened RPCs'
);
insert into public.upload_batches (id, source_file_name, storage_path, workbook_kind, created_by, updated_by)
values ('00000000-0000-0000-0000-000000000207', 'camel.xlsx', 'test/camel.xlsx', 'standard', auth.uid(), auth.uid());
insert into public.upload_rows (batch_id, source_sheet, source_row, row_kind, payload, status, created_by, updated_by)
values ('00000000-0000-0000-0000-000000000207', 'Production', 2,
  'production',
  jsonb_build_object(
    'contractVersion',2,'defects','[]'::jsonb,'downtime',null,
    'lineCode','TEST-LINE-2','modelCode','TEST-MODEL','note','camel','processCode','SPI',
    'production',jsonb_build_object('inputQty',2,'actualQty',2),
    'productionDate',(now() at time zone 'Asia/Bangkok')::date,
    'quality',jsonb_build_object('inputQty',2,'okQty',2,'ngQty',0),
    'shiftCode','TEST-SHIFT','sourceTrace',jsonb_build_object('sheet','Production','row',2),
    'timeSlotCode','TEST-SLOT','warnings','[]'::jsonb),
  'new', auth.uid(), auth.uid());
select lives_ok($$select public.commit_upload_batch('00000000-0000-0000-0000-000000000207', false)$$, 'exact V2 normalized payload commits');
select ok(
  exists (select 1 from public.audit_logs where actor_id = auth.uid() and table_name = 'production_records' and action = 'insert' and after_data ? 'input_qty'),
  'audit records actor, action, and after data for committed production'
);
-- Privileged fixture setup: authenticated roles cannot directly mutate protected records.
reset role;
insert into public.defect_records (quality_record_id, defect_type, classification, quantity, created_by, updated_by)
select id, 'Test defect', 'real', 1, auth.uid(), auth.uid()
from public.quality_records where production_record_id = (
  select id from public.production_records where line_id = '00000000-0000-0000-0000-000000000205' and deleted_at is null
) and deleted_at is null;
insert into public.downtime_records (production_record_id, reason_id, minutes, created_by, updated_by)
select id, '00000000-0000-0000-0000-000000000209', 5, auth.uid(), auth.uid()
from public.production_records where line_id = '00000000-0000-0000-0000-000000000205' and deleted_at is null;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
insert into public.upload_batches (id, source_file_name, storage_path, workbook_kind, created_by, updated_by)
values ('00000000-0000-0000-0000-000000000210', 'replace-zero.xlsx', 'test/replace-zero.xlsx', 'standard', auth.uid(), auth.uid());
insert into public.upload_rows (
  batch_id, source_sheet, source_row, row_kind, payload, status,
  target_record_id, expected_target_version, created_by, updated_by
)
values ('00000000-0000-0000-0000-000000000210', 'Production', 4, 'production',
  jsonb_build_object(
    'contractVersion',2,'defects','[]'::jsonb,'downtime',null,
    'lineCode','TEST-LINE-2','modelCode','TEST-MODEL','note','replace zero','processCode','SPI',
    'production',jsonb_build_object('inputQty',4,'actualQty',4),
    'productionDate',(now() at time zone 'Asia/Bangkok')::date,
    'quality',jsonb_build_object('inputQty',4,'okQty',3,'ngQty',1),
    'shiftCode','TEST-SHIFT','sourceTrace',jsonb_build_object('sheet','Production','row',4),
    'timeSlotCode','TEST-SLOT','warnings','[]'::jsonb),
  'conflict',
  (select id from public.production_records
   where line_id='00000000-0000-0000-0000-000000000205' and deleted_at is null),
  (select version from public.production_records
   where line_id='00000000-0000-0000-0000-000000000205' and deleted_at is null),
  auth.uid(), auth.uid());
select lives_ok($$select public.commit_upload_batch('00000000-0000-0000-0000-000000000210', true)$$, 'admin replaces a conflicting normalized row');
select is((select count(*)::integer from public.quality_records q join public.production_records p on p.id=q.production_record_id where p.line_id='00000000-0000-0000-0000-000000000205' and q.deleted_at is null), 1, 'replacement leaves exactly one active quality record');
select is((select count(*)::integer from public.downtime_records d join public.production_records p on p.id=d.production_record_id where p.line_id='00000000-0000-0000-0000-000000000205' and d.deleted_at is null), 0, 'zero incoming downtime retires all active downtime');
select is((select count(*)::integer from public.defect_records d join public.quality_records q on q.id=d.quality_record_id join public.production_records p on p.id=q.production_record_id where p.line_id='00000000-0000-0000-0000-000000000205' and d.deleted_at is not null), 1, 'replacement retires defects attached to retired quality');
insert into public.upload_batches (id, source_file_name, storage_path, workbook_kind, created_by, updated_by)
values ('00000000-0000-0000-0000-000000000211', 'replace-downtime.xlsx', 'test/replace-downtime.xlsx', 'standard', auth.uid(), auth.uid());
insert into public.upload_rows (
  batch_id, source_sheet, source_row, row_kind, payload, status,
  target_record_id, expected_target_version, created_by, updated_by
)
values ('00000000-0000-0000-0000-000000000211', 'Production', 5, 'production',
  jsonb_build_object(
    'contractVersion',2,'defects','[]'::jsonb,
    'downtime',jsonb_build_object('minutes',3,'reasonCode','TEST-DT'),
    'lineCode','TEST-LINE-2','modelCode','TEST-MODEL','note','replace downtime','processCode','SPI',
    'production',jsonb_build_object('inputQty',4,'actualQty',4),
    'productionDate',(now() at time zone 'Asia/Bangkok')::date,
    'quality',jsonb_build_object('inputQty',4,'okQty',4,'ngQty',0),
    'shiftCode','TEST-SHIFT','sourceTrace',jsonb_build_object('sheet','Production','row',5),
    'timeSlotCode','TEST-SLOT','warnings','[]'::jsonb),
  'conflict',
  (select id from public.production_records
   where line_id='00000000-0000-0000-0000-000000000205' and deleted_at is null),
  (select version from public.production_records
   where line_id='00000000-0000-0000-0000-000000000205' and deleted_at is null),
  auth.uid(), auth.uid());
select lives_ok($$select public.commit_upload_batch('00000000-0000-0000-0000-000000000211', true)$$, 'admin replaces conflict with downtime');
select is((select count(*)::integer from public.downtime_records d join public.production_records p on p.id=d.production_record_id where p.line_id='00000000-0000-0000-0000-000000000205' and d.deleted_at is null), 1, 'nonzero replacement leaves exactly one active downtime record');
insert into public.upload_batches (id, source_file_name, storage_path, workbook_kind, created_by, updated_by)
values ('00000000-0000-0000-0000-000000000208', 'snake.xlsx', 'test/snake.xlsx', 'standard', auth.uid(), auth.uid());
select throws_ok(
  $$insert into public.upload_rows (
      batch_id, source_sheet, source_row, row_kind, payload, status,
      created_by, updated_by
    )
    values (
      '00000000-0000-0000-0000-000000000208', 'Production', 3,
      'production', jsonb_build_object('source_sheet','Production'), 'new',
      auth.uid(), auth.uid()
    )$$,
  '22023',
  'upload_batch_has_errors',
  'snake_case or unknown payload keys are rejected'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select is_empty(
  $$select * from public.audit_logs$$,
  'operators cannot read audit logs'
);

reset role;
select ok(
  not has_function_privilege('anon', 'public.list_historical_master_data()', 'execute')
  and has_function_privilege('authenticated', 'public.list_historical_master_data()', 'execute')
  and not has_function_privilege('anon', 'public.set_my_language(text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_my_language(text)', 'execute'),
  'hardened RPC execute privileges are restricted to authenticated'
);
select finish();
rollback;
