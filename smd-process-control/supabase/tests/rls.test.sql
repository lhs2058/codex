begin;

select plan(12);

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

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select is(public.current_app_role(), 'viewer', 'viewer role is read-only');
select throws_ok(
  $$insert into public.models(code, name) values ('PE-35', 'PE-35')$$,
  '42501',
  'viewer cannot write master data'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select is(public.current_app_role(), 'operator', 'operator role is resolved from profiles');
select throws_ok(
  $$insert into public.models(code, name) values ('PE-36', 'PE-36')$$,
  '42501',
  'operator cannot write master data'
);
select lives_ok(
  $$insert into public.production_records (production_date, shift_id, time_slot_id, line_id, model_id, process_id, created_by, updated_by)
    values ((now() at time zone 'Asia/Bangkok')::date, '00000000-0000-0000-0000-000000000203',
      '00000000-0000-0000-0000-000000000204', '00000000-0000-0000-0000-000000000202',
      '00000000-0000-0000-0000-000000000201', (select id from public.processes where code = 'SPI'), auth.uid(), auth.uid())$$,
  'operator can create own production record'
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
  '40001', 'record_version_conflict', 'NULL expected version is rejected for create'
);
select throws_ok(
  $$update public.production_records set line_id = '00000000-0000-0000-0000-000000000205' where created_by = auth.uid()$$,
  '22023', 'production_record_dimensions_immutable', 'direct production dimension edits are rejected'
);
select is_empty(
  $$select * from public.production_records where deleted_at is not null$$,
  'active-only reader does not receive soft-deleted production data'
);
select throws_ok(
  $$delete from public.production_records where created_by = auth.uid()$$,
  '42501', 'operators cannot physically delete production records'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
select is(public.current_app_role(), 'admin', 'admin role is resolved from profiles');
select lives_ok(
  $$insert into public.models(code, name) values ('PE-37', 'PE-37')$$,
  'admin can write master data'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select is_empty(
  $$select * from public.audit_logs$$,
  'operators cannot read audit logs'
);

reset role;
select finish();
rollback;
