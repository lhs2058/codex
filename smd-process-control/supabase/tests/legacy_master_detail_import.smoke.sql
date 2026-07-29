begin;

-- Plain PostgreSQL runtime smoke suite for legacy import migrations.
-- Requirements: migrations through 026 applied; execute as the project database owner.
-- Every fixture and assertion is contained by this transaction and rolled back.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at
)
values
  (
    '23900000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'smoke-operator-023@example.test',
    'not-used', now()
  ),
  (
    '23900000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'smoke-admin-023@example.test',
    'not-used', now()
  );

insert into public.profiles (
  id, employee_id, display_name, role, is_active
)
values
  (
    '23900000-0000-0000-0000-000000000001',
    'SMOKE-OP-023', 'Smoke operator 023', 'operator', true
  ),
  (
    '23900000-0000-0000-0000-000000000002',
    'SMOKE-ADMIN-023', 'Smoke admin 023', 'admin', true
  );

insert into public.models (id, code, name)
values (
  '23900000-0000-0000-0000-000000000107',
  'SMOKE-OVERLAP-MODEL-023', 'Smoke Overlap Model 023'
);

insert into public.lines (id, code, name)
values (
  '23900000-0000-0000-0000-000000000102',
  'SMOKE-LINE-023', 'Smoke Line 023'
);

-- Reuse the fixed DAY/A catalog when present; supply its canonical definition
-- only when the target has not seeded it yet.
insert into public.shifts (id, code, name)
select
  '23900000-0000-0000-0000-000000000103',
  'DAY', 'DAY'
where not exists (
  select 1 from public.shifts where code = 'DAY' and deleted_at is null
);

insert into public.time_slots (
  id, shift_id, code, starts_at, ends_at, end_day_offset, sequence
)
select
  '23900000-0000-0000-0000-000000000104',
  shift.id, 'A', '07:30', '09:30', 0, 1
from public.shifts as shift
where shift.code = 'DAY'
  and shift.deleted_at is null
  and not exists (
    select 1
    from public.time_slots as slot
    where slot.shift_id = shift.id
      and slot.code = 'A'
      and slot.deleted_at is null
  );

insert into public.downtime_reasons (id, code, name)
values (
  '23900000-0000-0000-0000-000000000105',
  'SMOKE-REASON-023', 'Smoke Reason 023'
);

insert into public.standard_times (
  id, model_id, process_id, line_id, seconds_per_unit,
  effective_from, effective_to
)
values (
  '23900000-0000-0000-0000-000000000108',
  '23900000-0000-0000-0000-000000000107',
  (
    select id
    from public.processes
    where code = 'AOI' and is_active and deleted_at is null
  ),
  '23900000-0000-0000-0000-000000000102',
  12, '2026-01-01', '2026-06-01'
);

insert into public.upload_batches (
  id, source_file_name, storage_path, workbook_kind, status, source_sha256,
  created_by, updated_by
)
values
  (
    '23900000-0000-0000-0000-000000000011',
    'smoke-operator-023.xlsx', 'private/smoke-operator-023.xlsx',
    'standard', 'staged', repeat('2', 64),
    '23900000-0000-0000-0000-000000000001',
    '23900000-0000-0000-0000-000000000001'
  ),
  (
    '23900000-0000-0000-0000-000000000012',
    'smoke-main-023.xlsx', 'private/smoke-main-023.xlsx',
    'production', 'staged', repeat('3', 64),
    '23900000-0000-0000-0000-000000000002',
    '23900000-0000-0000-0000-000000000002'
  ),
  (
    '23900000-0000-0000-0000-000000000013',
    'smoke-overlap-023.xlsx', 'private/smoke-overlap-023.xlsx',
    'standard', 'staged', repeat('4', 64),
    '23900000-0000-0000-0000-000000000002',
    '23900000-0000-0000-0000-000000000002'
  ),
  (
    '23900000-0000-0000-0000-000000000014',
    'smoke-seconds-023.xlsx', 'private/smoke-seconds-023.xlsx',
    'production', 'staged', repeat('5', 64),
    '23900000-0000-0000-0000-000000000002',
    '23900000-0000-0000-0000-000000000002'
  ),
  (
    '23900000-0000-0000-0000-000000000015',
    'smoke-rollback-023.xlsx', 'private/smoke-rollback-023.xlsx',
    'production', 'staged', repeat('6', 64),
    '23900000-0000-0000-0000-000000000002',
    '23900000-0000-0000-0000-000000000002'
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '23900000-0000-0000-0000-000000000001',
  true
);

select public.stage_upload_candidates(
  '23900000-0000-0000-0000-000000000011',
  '[]'::jsonb,
  '[]'::jsonb
);

do $smoke$
declare
  caught_expected boolean := false;
begin
  begin
    perform public.commit_upload_batch_with_masters(
      '23900000-0000-0000-0000-000000000011',
      false, '[]'::jsonb, '[]'::jsonb
    );
  exception when sqlstate '42501' then
    if sqlerrm <> 'admin_required' then
      raise;
    end if;
    caught_expected := true;
  end;

  if not caught_expected then
    raise exception
      'SMOKE_ASSERT: operator approval denial expected 42501 admin_required';
  end if;
end
$smoke$;

select public.stage_upload_candidates(
  '23900000-0000-0000-0000-000000000011',
  jsonb_build_array(jsonb_build_object(
    'key', 'model|SMOKE-OPERATOR-NEW-023',
    'entity', 'model',
    'code', 'SMOKE-OPERATOR-NEW-023',
    'parentCode', null,
    'proposedName', 'SMOKE-OPERATOR-NEW-023',
    'status', 'new',
    'messages', '[]'::jsonb,
    'sources', jsonb_build_array(jsonb_build_object(
      'sheet', 'Production', 'row', 2
    ))
  )),
  '[]'::jsonb
);

do $smoke$
declare
  caught_expected boolean := false;
begin
  begin
    perform public.commit_upload_batch(
      '23900000-0000-0000-0000-000000000011',
      false
    );
  exception when sqlstate '42501' then
    if sqlerrm <> 'upload_candidates_require_admin' then
      raise;
    end if;
    caught_expected := true;
  end;

  if not caught_expected then
    raise exception
      'SMOKE_ASSERT: operator candidate bypass denial expected 42501 upload_candidates_require_admin';
  end if;
end
$smoke$;

select set_config(
  'request.jwt.claim.sub',
  '23900000-0000-0000-0000-000000000002',
  true
);

insert into public.upload_rows (
  id, batch_id, source_sheet, source_row, row_kind, payload, status,
  created_by, updated_by
)
values
  (
    '23900000-0000-0000-0000-000000000201',
    '23900000-0000-0000-0000-000000000012',
    'Production', 8, 'production',
    jsonb_build_object(
      'contractVersion', 2,
      'defects', '[]'::jsonb,
      'downtime', jsonb_build_object(
        'minutes', 60, 'reasonCode', 'SMOKE-REASON-023'
      ),
      'lineCode', 'SMOKE-LINE-023',
      'modelCode', 'SMOKE-NEW-MODEL-023',
      'note', 'smoke atomic detail 023',
      'processCode', 'AOI',
      'production', jsonb_build_object('actualQty', 9, 'inputQty', 10),
      'productionDate', '2026-06-02',
      'quality', jsonb_build_object('inputQty', 10, 'ngQty', 1, 'okQty', 9),
      'shiftCode', 'DAY',
      'sourceTrace', jsonb_build_object('row', 8, 'sheet', 'Production'),
      'timeSlotCode', 'A',
      'warnings', '[]'::jsonb
    ),
    'new',
    '23900000-0000-0000-0000-000000000002',
    '23900000-0000-0000-0000-000000000002'
  ),
  (
    '23900000-0000-0000-0000-000000000203',
    '23900000-0000-0000-0000-000000000015',
    'Production', 30, 'production',
    jsonb_build_object(
      'contractVersion', 2,
      'defects', '[]'::jsonb,
      'downtime', jsonb_build_object(
        'minutes', 1, 'reasonCode', 'SMOKE-MISSING-REASON-023'
      ),
      'lineCode', 'SMOKE-LINE-023',
      'modelCode', 'SMOKE-ROLLBACK-MODEL-023',
      'note', 'smoke invalid detail rollback 023',
      'processCode', 'ROUTER',
      'production', jsonb_build_object('actualQty', 1, 'inputQty', 1),
      'productionDate', '2026-08-01',
      'quality', null,
      'shiftCode', 'DAY',
      'sourceTrace', jsonb_build_object('row', 30, 'sheet', 'Production'),
      'timeSlotCode', 'A',
      'warnings', '[]'::jsonb
    ),
    'new',
    '23900000-0000-0000-0000-000000000002',
    '23900000-0000-0000-0000-000000000002'
  );

-- SLOT_GUARD_REGRESSION_START
select public.stage_upload_candidates(
  '23900000-0000-0000-0000-000000000012',
  jsonb_build_array(
    jsonb_build_object(
      'key', 'model|SMOKE-NEW-MODEL-023',
      'entity', 'model',
      'code', 'SMOKE-NEW-MODEL-023',
      'parentCode', null,
      'proposedName', 'Smoke New Model 023',
      'status', 'new',
      'approved', false,
      'startsAt', null,
      'endsAt', null,
      'endDayOffset', null,
      'sequence', null,
      'messages', '[]'::jsonb,
      'sources', jsonb_build_array(
        jsonb_build_object('sheet', 'Production', 'row', 8)
      )
    ),
    jsonb_build_object(
      'key', 'line|SMOKE-LINE-023',
      'entity', 'line',
      'code', 'SMOKE-LINE-023',
      'parentCode', null,
      'proposedName', 'Smoke Line 023',
      'status', 'existing',
      'approved', true,
      'startsAt', null,
      'endsAt', null,
      'endDayOffset', null,
      'sequence', null,
      'messages', '[]'::jsonb,
      'sources', jsonb_build_array(
        jsonb_build_object('sheet', 'Production', 'row', 8)
      )
    ),
    jsonb_build_object(
      'key', 'shift|DAY',
      'entity', 'shift',
      'code', 'DAY',
      'parentCode', null,
      'proposedName', 'DAY',
      'status', 'existing',
      'approved', true,
      'startsAt', null,
      'endsAt', null,
      'endDayOffset', null,
      'sequence', null,
      'messages', '[]'::jsonb,
      'sources', jsonb_build_array(
        jsonb_build_object('sheet', 'Production', 'row', 8)
      )
    ),
    jsonb_build_object(
      'key', 'time_slot|DAY|A',
      'entity', 'time_slot',
      'code', 'A',
      'parentCode', 'DAY',
      'proposedName', 'A',
      'status', 'existing',
      'approved', true,
      'startsAt', '07:30',
      'endsAt', '09:30',
      'endDayOffset', 0,
      'sequence', 1,
      'messages', '[]'::jsonb,
      'sources', jsonb_build_array(
        jsonb_build_object('sheet', 'Production', 'row', 8)
      )
    ),
    jsonb_build_object(
      'key', 'downtime_reason|SMOKE-REASON-023',
      'entity', 'downtime_reason',
      'code', 'SMOKE-REASON-023',
      'parentCode', null,
      'proposedName', 'Smoke Reason 023',
      'status', 'existing',
      'approved', true,
      'startsAt', null,
      'endsAt', null,
      'endDayOffset', null,
      'sequence', null,
      'messages', '[]'::jsonb,
      'sources', jsonb_build_array(
        jsonb_build_object('sheet', 'Production', 'row', 8)
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'key', 'SMOKE-NEW-MODEL-023|SMOKE-LINE-023|AOI',
      'modelCode', 'SMOKE-NEW-MODEL-023',
      'lineCode', 'SMOKE-LINE-023',
      'processCode', 'AOI',
      'status', 'new',
      'approved', false,
      'proposedSecondsPerUnit', 10,
      'approvedSecondsPerUnit', null,
      'minimum', 10,
      'median', 10,
      'maximum', 10,
      'effectiveFrom', '2026-06-01',
      'effectiveTo', null,
      'messages', '[]'::jsonb,
      'observations', jsonb_build_array(
        jsonb_build_object(
          'sheet', 'Production',
          'row', 8,
          'productionDate', '2026-06-02',
          'shiftCode', 'DAY',
          'timeSlotCode', 'A',
          'capacityQty', 720,
          'plannedSeconds', 7200,
          'secondsPerUnit', 10
        )
      )
    )
  )
);

do $smoke$
declare
  commit_result jsonb;
begin
  select public.commit_upload_batch_with_masters(
    '23900000-0000-0000-0000-000000000012',
    false,
    jsonb_build_array(
      jsonb_build_object(
        'key', 'model|SMOKE-NEW-MODEL-023',
        'approved', true,
        'approvedName', 'Smoke New Model 023'
      )
    ),
    jsonb_build_array(
      jsonb_build_object(
        'key', 'SMOKE-NEW-MODEL-023|SMOKE-LINE-023|AOI',
        'approved', true,
        'approvedSecondsPerUnit', 10,
        'effectiveFrom', '2026-06-01',
        'effectiveTo', null
      )
    )
  )
  into commit_result;

  if commit_result ->> 'status' <> 'completed'
    or not exists (
      select 1
      from public.models
      where code = 'SMOKE-NEW-MODEL-023'
    ) then
    raise exception
      'SMOKE_ASSERT: new model candidate slot guard regression failed';
  end if;

  if not exists (
      select 1
      from public.models as model
      join public.standard_times as standard_time
        on standard_time.model_id = model.id
      join public.lines as line on line.id = standard_time.line_id
      join public.processes as process on process.id = standard_time.process_id
      where model.code = 'SMOKE-NEW-MODEL-023'
        and line.code = 'SMOKE-LINE-023'
        and process.code = 'AOI'
        and standard_time.seconds_per_unit = 10
        and standard_time.effective_from = '2026-06-01'
    )
    or not exists (
      select 1
      from public.production_records as production
      join public.downtime_records as downtime
        on downtime.production_record_id = production.id
      where production.note = 'smoke atomic detail 023'
        and downtime.reason_id =
          '23900000-0000-0000-0000-000000000105'
    ) then
    raise exception
      'SMOKE_ASSERT: atomic master ST detail commit failed';
  end if;
end
$smoke$;
-- SLOT_GUARD_REGRESSION_END

do $smoke$
declare
  rerun_result jsonb;
  detail_count integer;
begin
  select public.commit_upload_batch_with_masters(
    '23900000-0000-0000-0000-000000000012',
    false, '[]'::jsonb, '[]'::jsonb
  )
  into rerun_result;

  select count(*)
  into detail_count
  from public.production_records
  where note = 'smoke atomic detail 023';

  if rerun_result ->> 'status' <> 'completed' or detail_count <> 1 then
    raise exception
      'SMOKE_ASSERT: same batch idempotency failed';
  end if;
end
$smoke$;

select public.stage_upload_candidates(
  '23900000-0000-0000-0000-000000000013',
  '[]'::jsonb,
  jsonb_build_array(
    jsonb_build_object(
      'key', 'SMOKE-OVERLAP-MODEL-023|SMOKE-LINE-023|AOI',
      'modelCode', 'SMOKE-OVERLAP-MODEL-023',
      'lineCode', 'SMOKE-LINE-023',
      'processCode', 'AOI',
      'status', 'conflict',
      'approved', false,
      'proposedSecondsPerUnit', null,
      'approvedSecondsPerUnit', null,
      'minimum', 12,
      'median', 12,
      'maximum', 12,
      'effectiveFrom', '2026-06-01',
      'effectiveTo', null,
      'messages', jsonb_build_array('overlap'),
      'observations', jsonb_build_array(
        jsonb_build_object(
          'sheet', 'Standard Time',
          'row', 4,
          'productionDate', '2026-06-01',
          'shiftCode', 'DAY',
          'timeSlotCode', 'A',
          'capacityQty', 600,
          'plannedSeconds', 7200,
          'secondsPerUnit', 12
        )
      )
    )
  )
);

do $smoke$
declare
  caught_expected boolean := false;
begin
  begin
    perform public.commit_upload_batch_with_masters(
      '23900000-0000-0000-0000-000000000013',
      false,
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'key', 'SMOKE-OVERLAP-MODEL-023|SMOKE-LINE-023|AOI',
          'approved', true,
          'approvedSecondsPerUnit', 12,
          'effectiveFrom', '2026-06-01',
          'effectiveTo', null
        )
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'standard_time_overlap' then
      raise;
    end if;
    caught_expected := true;
  end;

  if not caught_expected then
    raise exception
      'SMOKE_ASSERT: inclusive ST overlap rejection expected 22023 standard_time_overlap';
  end if;
end
$smoke$;

-- DAY/A is exactly 7,200 seconds. Structural validation must reject the 7,260
-- requested seconds at upload-row insertion, before staging or final commit.
-- EXACT_SECOND_BOUNDARY_START
do $smoke$
declare
  caught_expected boolean := false;
begin
  begin
    insert into public.upload_rows (
      id, batch_id, source_sheet, source_row, row_kind, payload, status,
      created_by, updated_by
    )
    values (
      '23900000-0000-0000-0000-000000000202',
      '23900000-0000-0000-0000-000000000014',
      'Production', 20, 'production',
      jsonb_build_object(
        'contractVersion', 2,
        'defects', '[]'::jsonb,
        'downtime', jsonb_build_object(
          'minutes', 121, 'reasonCode', 'SMOKE-REASON-023'
        ),
        'lineCode', 'SMOKE-LINE-023',
        'modelCode', 'SMOKE-NEW-MODEL-023',
        'note', 'smoke seconds rejection 023',
        'processCode', 'AOI',
        'production', jsonb_build_object('actualQty', 1, 'inputQty', 1),
        'productionDate', '2026-07-01',
        'quality', null,
        'shiftCode', 'DAY',
        'sourceTrace', jsonb_build_object('row', 20, 'sheet', 'Production'),
        'timeSlotCode', 'A',
        'warnings', '[]'::jsonb
      ),
      'new',
      '23900000-0000-0000-0000-000000000002',
      '23900000-0000-0000-0000-000000000002'
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'downtime_exceeds_planned_time' then
      raise;
    end if;
    caught_expected := true;
  end;

  if not caught_expected
    or exists (
      select 1
      from public.production_records
      where note = 'smoke seconds rejection 023'
    ) then
    raise exception
      'SMOKE_ASSERT: exact second downtime rejection failed';
  end if;
end
$smoke$;
-- EXACT_SECOND_BOUNDARY_END

select public.stage_upload_candidates(
  '23900000-0000-0000-0000-000000000015',
  jsonb_build_array(
    jsonb_build_object(
      'key', 'model|SMOKE-ROLLBACK-MODEL-023',
      'entity', 'model',
      'code', 'SMOKE-ROLLBACK-MODEL-023',
      'parentCode', null,
      'proposedName', 'Smoke Rollback Model 023',
      'status', 'new',
      'approved', false,
      'startsAt', null,
      'endsAt', null,
      'endDayOffset', null,
      'sequence', null,
      'messages', '[]'::jsonb,
      'sources', jsonb_build_array(
        jsonb_build_object('sheet', 'Production', 'row', 30)
      )
    )
  ),
  jsonb_build_array(
    jsonb_build_object(
      'key', 'SMOKE-ROLLBACK-MODEL-023|SMOKE-LINE-023|ROUTER',
      'modelCode', 'SMOKE-ROLLBACK-MODEL-023',
      'lineCode', 'SMOKE-LINE-023',
      'processCode', 'ROUTER',
      'status', 'new',
      'approved', false,
      'proposedSecondsPerUnit', 11,
      'approvedSecondsPerUnit', null,
      'minimum', 11,
      'median', 11,
      'maximum', 11,
      'effectiveFrom', '2026-08-01',
      'effectiveTo', null,
      'messages', '[]'::jsonb,
      'observations', jsonb_build_array(
        jsonb_build_object(
          'sheet', 'Production',
          'row', 30,
          'productionDate', '2026-08-01',
          'shiftCode', 'DAY',
          'timeSlotCode', 'A',
          'capacityQty', 654.545454,
          'plannedSeconds', 7200,
          'secondsPerUnit', 11
        )
      )
    )
  )
);

do $smoke$
declare
  caught_expected boolean := false;
begin
  begin
    perform public.commit_upload_batch_with_masters(
      '23900000-0000-0000-0000-000000000015',
      false,
      jsonb_build_array(
        jsonb_build_object(
          'key', 'model|SMOKE-ROLLBACK-MODEL-023',
          'approved', true,
          'approvedName', 'Smoke Rollback Model 023'
        )
      ),
      jsonb_build_array(
        jsonb_build_object(
          'key', 'SMOKE-ROLLBACK-MODEL-023|SMOKE-LINE-023|ROUTER',
          'approved', true,
          'approvedSecondsPerUnit', 11,
          'effectiveFrom', '2026-08-01',
          'effectiveTo', null
        )
      )
    );
  exception when sqlstate '22023' then
    if sqlerrm <> 'upload_batch_has_errors' then
      raise;
    end if;
    caught_expected := true;
  end;

  if not caught_expected
    or exists (
      select 1
      from public.models
      where code = 'SMOKE-ROLLBACK-MODEL-023'
    )
    or exists (
      select 1
      from public.standard_times as standard_time
      join public.models as model on model.id = standard_time.model_id
      where model.code = 'SMOKE-ROLLBACK-MODEL-023'
    ) then
    raise exception
      'SMOKE_ASSERT: invalid detail atomic rollback failed';
  end if;
end
$smoke$;

select 'legacy master/detail runtime smoke passed' as smoke_result;

reset role;
rollback;
