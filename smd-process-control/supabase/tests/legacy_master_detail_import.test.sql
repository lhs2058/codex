begin;

select no_plan();

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at
)
values
  (
    '23000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-operator@example.test',
    'not-used', now()
  ),
  (
    '23000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-admin@example.test',
    'not-used', now()
  ),
  (
    '23000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'legacy-viewer@example.test',
    'not-used', now()
  );

insert into public.profiles (
  id, employee_id, display_name, role, is_active
)
values
  (
    '23000000-0000-0000-0000-000000000001',
    'LEGACY-OPERATOR', 'Legacy operator', 'operator', true
  ),
  (
    '23000000-0000-0000-0000-000000000002',
    'LEGACY-ADMIN', 'Legacy admin', 'admin', true
  ),
  (
    '23000000-0000-0000-0000-000000000003',
    'LEGACY-VIEWER', 'Legacy viewer', 'viewer', true
  );

insert into public.models (id, code, name)
values
  (
    '23000000-0000-0000-0000-000000000101',
    'LEGACY-MODEL', 'Legacy Model'
  ),
  (
    '23000000-0000-0000-0000-000000000106',
    'CONFLICT-MODEL', 'Canonical model'
  ),
  (
    '23000000-0000-0000-0000-000000000107',
    'OVERLAP-MODEL', 'Overlap Model'
  );

insert into public.lines (id, code, name)
values (
  '23000000-0000-0000-0000-000000000102',
  'LEGACY-LINE', 'Legacy Line'
);

insert into public.shifts (id, code, name)
values (
  '23000000-0000-0000-0000-000000000103',
  'DAY', 'DAY'
);

insert into public.time_slots (
  id, shift_id, code, starts_at, ends_at, end_day_offset, sequence
)
values (
  '23000000-0000-0000-0000-000000000104',
  '23000000-0000-0000-0000-000000000103',
  'A', '07:30', '09:30', 0, 1
);

insert into public.downtime_reasons (id, code, name)
values (
  '23000000-0000-0000-0000-000000000105',
  'LEGACY-REASON', 'Planned downtime'
);

insert into public.standard_times (
  id, model_id, process_id, line_id, seconds_per_unit,
  effective_from, effective_to
)
values (
  '23000000-0000-0000-0000-000000000108',
  '23000000-0000-0000-0000-000000000107',
  (select id from public.processes where code = 'AOI'),
  '23000000-0000-0000-0000-000000000102',
  12, '2026-01-01', '2026-06-01'
);

insert into public.upload_batches (
  id, source_file_name, storage_path, workbook_kind, status, source_sha256,
  created_by, updated_by
)
values
  (
    '23000000-0000-0000-0000-000000000011',
    'operator.xlsx', 'private/operator.xlsx', 'standard', 'staged',
    repeat('0', 64),
    '23000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000001'
  ),
  (
    '23000000-0000-0000-0000-000000000012',
    'main.xlsx', 'private/main.xlsx', 'production', 'staged',
    repeat('a', 64),
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  ),
  (
    '23000000-0000-0000-0000-000000000013',
    'night-slot.xlsx', 'private/night-slot.xlsx', 'production', 'staged',
    repeat('b', 64),
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  ),
  (
    '23000000-0000-0000-0000-000000000014',
    'name-conflict.xlsx', 'private/name-conflict.xlsx', 'standard', 'staged',
    repeat('c', 64),
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  ),
  (
    '23000000-0000-0000-0000-000000000015',
    'overlap.xlsx', 'private/overlap.xlsx', 'production', 'staged',
    repeat('d', 64),
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  ),
  (
    '23000000-0000-0000-0000-000000000016',
    'deviation.xlsx', 'private/deviation.xlsx', 'production', 'staged',
    repeat('e', 64),
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  ),
  (
    '23000000-0000-0000-0000-000000000017',
    'rollback.xlsx', 'private/rollback.xlsx', 'production', 'staged',
    repeat('f', 64),
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  ),
  (
    '23000000-0000-0000-0000-000000000018',
    'fractional-slot.xlsx', 'private/fractional-slot.xlsx',
    'production', 'staged', repeat('1', 64),
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  );

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'upload_batches'
      and column_name = 'source_sha256'
  ),
  'upload batches persist the source SHA-256'
);
select ok(
  exists (
    select 1 from pg_tables
    where schemaname = 'public'
      and tablename = 'upload_master_candidates'
  ),
  'master candidate staging table exists'
);
select ok(
  exists (
    select 1 from pg_tables
    where schemaname = 'public'
      and tablename = 'upload_standard_time_candidates'
  ),
  'standard-time candidate staging table exists'
);
select ok(
  (
    select bool_and(rowsecurity)
    from pg_tables
    where schemaname = 'public'
      and tablename in (
        'upload_master_candidates',
        'upload_standard_time_candidates'
      )
  ),
  'RLS is enabled on both candidate staging tables'
);
select ok(
  to_regprocedure('public.find_completed_upload_by_hash(text)') is not null
  and to_regprocedure(
    'public.stage_upload_candidates(uuid,jsonb,jsonb)'
  ) is not null
  and to_regprocedure(
    'public.list_upload_detail_page(uuid,integer,integer,text)'
  ) is not null
  and to_regprocedure(
    'public.commit_upload_batch_with_masters(uuid,boolean,jsonb,jsonb)'
  ) is not null,
  'all four legacy import RPC signatures exist'
);
select ok(
  (
    select count(*) = 4
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'find_completed_upload_by_hash',
        'stage_upload_candidates',
        'list_upload_detail_page',
        'commit_upload_batch_with_masters'
      )
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=']
  ),
  'all legacy import RPCs fix an empty search path'
);
select ok(
  not exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in (
        'find_completed_upload_by_hash',
        'stage_upload_candidates',
        'list_upload_detail_page',
        'commit_upload_batch_with_masters'
      )
      and grantee in ('PUBLIC', 'anon')
      and privilege_type = 'EXECUTE'
  ),
  'PUBLIC and anon execute are revoked from legacy import RPCs'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.upload_master_candidates', 'INSERT'
  )
  and not has_table_privilege(
    'authenticated', 'public.upload_master_candidates', 'UPDATE'
  )
  and not has_table_privilege(
    'authenticated', 'public.upload_standard_time_candidates', 'DELETE'
  ),
  'authenticated clients have no direct candidate write privileges'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '23000000-0000-0000-0000-000000000001',
  true
);
select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000011',
      '[]'::jsonb,
      '[]'::jsonb
    )$$,
  'an operator can stage immutable candidates for their own batch'
);
select throws_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000011',
      false, '[]'::jsonb, '[]'::jsonb
    )$$,
  '42501', 'admin_required',
  'an operator cannot approve a staged upload'
);
select throws_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000012',
      true, '[]'::jsonb, '[]'::jsonb
    )$$,
  '42501', 'admin_required',
  'an operator cannot replace records from another upload'
);

select set_config(
  'request.jwt.claim.sub',
  '23000000-0000-0000-0000-000000000002',
  true
);

insert into public.upload_rows (
  id, batch_id, source_sheet, source_row, row_kind, payload, status,
  created_by, updated_by
)
values
  (
    '23000000-0000-0000-0000-000000000201',
    '23000000-0000-0000-0000-000000000012',
    'Production', 8, 'production',
    jsonb_build_object(
      'contractVersion', 2,
      'defects', jsonb_build_array(jsonb_build_object(
        'classification', 'real',
        'defectType', 'Scratch',
        'productionSourceRow', 8,
        'quantity', 1,
        'sourceRow', 3,
        'sourceSheet', 'Defects'
      )),
      'downtime', jsonb_build_object(
        'minutes', 60, 'reasonCode', 'LEGACY-REASON'
      ),
      'lineCode', 'LEGACY-LINE',
      'modelCode', 'LEGACY-MODEL',
      'note', 'linked production',
      'processCode', 'AOI',
      'production', jsonb_build_object('actualQty', 9, 'inputQty', 10),
      'productionDate', '2026-06-01',
      'quality', jsonb_build_object('inputQty', 10, 'ngQty', 1, 'okQty', 9),
      'shiftCode', 'DAY',
      'sourceTrace', jsonb_build_object('row', 8, 'sheet', 'Production'),
      'timeSlotCode', 'A',
      'warnings', '[]'::jsonb
    ),
    'new',
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  ),
  (
    '23000000-0000-0000-0000-000000000202',
    '23000000-0000-0000-0000-000000000012',
    'AOI', 5, 'daily_quality',
    jsonb_build_object(
      'contractVersion', 2,
      'defects', '[]'::jsonb,
      'downtime', null,
      'lineCode', 'LEGACY-LINE',
      'modelCode', 'LEGACY-MODEL',
      'note', 'daily quality without a fabricated slot',
      'processCode', 'AOI',
      'production', null,
      'productionDate', '2026-06-02',
      'quality', jsonb_build_object('inputQty', 20, 'ngQty', 1, 'okQty', 19),
      'shiftCode', 'DAY',
      'sourceTrace', jsonb_build_object('row', 5, 'sheet', 'AOI'),
      'timeSlotCode', null,
      'warnings', '[]'::jsonb
    ),
    'new',
    '23000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002'
  );

select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000012',
      jsonb_build_array(
        jsonb_build_object(
          'key','model|LEGACY-MODEL','entity','model',
          'code','LEGACY-MODEL','parentCode',null,
          'proposedName','Legacy Model','status','existing',
          'approved',true,'startsAt',null,'endsAt',null,
          'endDayOffset',null,'sequence',null,
          'messages','[]'::jsonb,
          'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',8))
        ),
        jsonb_build_object(
          'key','line|LEGACY-LINE','entity','line',
          'code','LEGACY-LINE','parentCode',null,
          'proposedName','Legacy Line','status','existing',
          'approved',true,'startsAt',null,'endsAt',null,
          'endDayOffset',null,'sequence',null,
          'messages','[]'::jsonb,
          'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',8))
        ),
        jsonb_build_object(
          'key','shift|DAY','entity','shift','code','DAY','parentCode',null,
          'proposedName','DAY','status','existing','approved',true,
          'startsAt',null,'endsAt',null,'endDayOffset',null,'sequence',null,
          'messages','[]'::jsonb,
          'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',8))
        ),
        jsonb_build_object(
          'key','time_slot|DAY|A','entity','time_slot','code','A',
          'parentCode','DAY','proposedName','A','status','existing',
          'approved',true,'startsAt','07:30','endsAt','09:30',
          'endDayOffset',0,'sequence',1,'messages','[]'::jsonb,
          'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',8))
        ),
        jsonb_build_object(
          'key','downtime_reason|LEGACY-REASON','entity','downtime_reason',
          'code','LEGACY-REASON','parentCode',null,
          'proposedName','Planned downtime','status','existing',
          'approved',true,'startsAt',null,'endsAt',null,
          'endDayOffset',null,'sequence',null,'messages','[]'::jsonb,
          'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',8))
        )
      ),
      jsonb_build_array(jsonb_build_object(
        'key','LEGACY-MODEL|LEGACY-LINE|AOI',
        'modelCode','LEGACY-MODEL','lineCode','LEGACY-LINE',
        'processCode','AOI','status','new','approved',false,
        'proposedSecondsPerUnit',10,'approvedSecondsPerUnit',null,
        'minimum',10,'median',10,'maximum',10,
        'effectiveFrom','2026-06-01','effectiveTo',null,
        'messages','[]'::jsonb,
        'observations',jsonb_build_array(jsonb_build_object(
          'sheet','Production','row',8,'productionDate','2026-06-01',
          'shiftCode','DAY','timeSlotCode','A','capacityQty',720,
          'plannedSeconds',7200,'secondsPerUnit',10
        ))
      ))
    )$$,
  'existing masters and a new ST candidate stage together'
);

select is(
  (
    select count(*)::integer
    from public.models where code = 'LEGACY-MODEL'
  ),
  1,
  'staging does not duplicate an existing master'
);

select lives_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000012',
      false,
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'key','LEGACY-MODEL|LEGACY-LINE|AOI',
        'approved',true,
        'approvedSecondsPerUnit',10,
        'effectiveFrom','2026-06-01',
        'effectiveTo',null
      ))
    )$$,
  'admin atomically commits existing masters, ST, and detail rows'
);

select is(
  (
    select count(*)::integer
    from public.models where code = 'LEGACY-MODEL'
  ),
  1,
  'commit reuses the existing model without a duplicate'
);
select ok(
  exists (
    select 1
    from public.production_records as production
    join public.quality_records as quality
      on quality.production_record_id = production.id
    join public.defect_records as defect
      on defect.quality_record_id = quality.id
    join public.downtime_records as downtime
      on downtime.production_record_id = production.id
    where production.note = 'linked production'
      and defect.defect_type = 'Scratch'
      and downtime.reason_id = '23000000-0000-0000-0000-000000000105'
  ),
  'production, linked quality, defect, and downtime retain foreign keys'
);
select ok(
  exists (
    select 1
    from public.quality_records
    where note = 'daily quality without a fabricated slot'
      and production_record_id is null
      and time_slot_id is null
  ),
  'daily quality commits without inventing a time slot'
);
select ok(
  exists (
    select 1
    from public.audit_logs
    where actor_id = '23000000-0000-0000-0000-000000000002'
      and table_name in ('standard_times', 'production_records')
      and action = 'insert'
  ),
  'master/detail audit rows contain the admin actor'
);

select results_eq(
  $$select
      (public.commit_upload_batch_with_masters(
        '23000000-0000-0000-0000-000000000012',
        false,
        '[]'::jsonb,
        '[]'::jsonb
      ) ->> 'status')::text,
      count(*)::integer
    from public.production_records
    where note = 'linked production'$$,
  $$values ('completed'::text, 1)$$,
  'completed rerun returns its saved result without extra detail rows'
);

select ok(
  public.find_completed_upload_by_hash(repeat('a', 64))
    @> jsonb_build_object(
      'id', '23000000-0000-0000-0000-000000000012'::uuid,
      'sourceFileName', 'main.xlsx',
      'workbookKind', 'production'
    ),
  'the same completed SHA-256 resolves to the accessible batch'
);
select ok(
  (
    public.list_upload_detail_page(
      '23000000-0000-0000-0000-000000000012',
      0, 500, null
    ) ->> 'total'
  )::integer = 2
  and not (
    public.list_upload_detail_page(
      '23000000-0000-0000-0000-000000000012',
      0, 500, null
    )::text like '%private/main.xlsx%'
  ),
  'detail paging clamps its limit and never returns private storage paths'
);

select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000013',
      jsonb_build_array(
        jsonb_build_object(
          'key','shift|NIGHT','entity','shift','code','NIGHT',
          'parentCode',null,'proposedName','NIGHT','status','new',
          'approved',false,'startsAt',null,'endsAt',null,
          'endDayOffset',null,'sequence',null,'messages','[]'::jsonb,
          'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',9))
        ),
        jsonb_build_object(
          'key','time_slot|NIGHT|B','entity','time_slot','code','B',
          'parentCode','NIGHT','proposedName','B','status','new',
          'approved',false,'startsAt','21:30','endsAt','01:00',
          'endDayOffset',1,'sequence',2,'messages','[]'::jsonb,
          'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',9))
        )
      ),
      '[]'::jsonb
    )$$,
  'fixed NIGHT/B candidates stage'
);
select lives_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000013',
      false,
      jsonb_build_array(
        jsonb_build_object(
          'key','shift|NIGHT','approved',true,'approvedName','NIGHT'
        ),
        jsonb_build_object(
          'key','time_slot|NIGHT|B','approved',true,'approvedName','B'
        )
      ),
      '[]'::jsonb
    )$$,
  'admin approves the fixed night shift and slot'
);
select ok(
  exists (
    select 1
    from public.time_slots as slot
    join public.shifts as shift on shift.id = slot.shift_id
    where shift.code = 'NIGHT'
      and slot.code = 'B'
      and slot.starts_at = '21:30'::time
      and slot.ends_at = '01:00'::time
      and slot.end_day_offset = 1
      and slot.sequence = 2
  ),
  'NIGHT/B preserves the required overnight day offset'
);

select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000014',
      jsonb_build_array(jsonb_build_object(
        'key','model|CONFLICT-MODEL','entity','model',
        'code','CONFLICT-MODEL','parentCode',null,
        'proposedName','Renamed model','status','conflict',
        'approved',false,'startsAt',null,'endsAt',null,
        'endDayOffset',null,'sequence',null,'messages',
        jsonb_build_array('Existing model name differs'),
        'sources',jsonb_build_array(jsonb_build_object('sheet','AOI','row',2))
      )),
      '[]'::jsonb
    )$$,
  'a code/name conflict stages for review'
);
select throws_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000014',
      false,
      jsonb_build_array(jsonb_build_object(
        'key','model|CONFLICT-MODEL',
        'approved',true,'approvedName','Renamed model'
      )),
      '[]'::jsonb
    )$$,
  '22023', 'existing_master_name_change_forbidden',
  'approval cannot rename an existing master'
);

select throws_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000015',
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'key','OVERLAP-MODEL|LEGACY-LINE|UNSUPPORTED',
        'modelCode','OVERLAP-MODEL','lineCode','LEGACY-LINE',
        'processCode','UNSUPPORTED','status','new','approved',false,
        'proposedSecondsPerUnit',10,'approvedSecondsPerUnit',null,
        'minimum',10,'median',10,'maximum',10,
        'effectiveFrom','2026-06-01','effectiveTo',null,
        'messages','[]'::jsonb,'observations','[]'::jsonb
      ))
    )$$,
  '22023', 'unsupported_process',
  'the process allowlist cannot be extended by staged JSON'
);

select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000015',
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'key','OVERLAP-MODEL|LEGACY-LINE|AOI',
        'modelCode','OVERLAP-MODEL','lineCode','LEGACY-LINE',
        'processCode','AOI','status','conflict','approved',false,
        'proposedSecondsPerUnit',null,'approvedSecondsPerUnit',null,
        'minimum',12,'median',12,'maximum',12,
        'effectiveFrom','2026-06-01','effectiveTo',null,
        'messages',jsonb_build_array('overlap'),
        'observations',jsonb_build_array(jsonb_build_object(
          'sheet','Production','row',4,'productionDate','2026-06-01',
          'shiftCode','DAY','timeSlotCode','A','capacityQty',600,
          'plannedSeconds',7200,'secondsPerUnit',12
        ))
      ))
    )$$,
  'an overlapping ST candidate stages for admin review'
);
select throws_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000015',
      false, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'key','OVERLAP-MODEL|LEGACY-LINE|AOI',
        'approved',true,'approvedSecondsPerUnit',12,
        'effectiveFrom','2026-06-01','effectiveTo',null
      ))
    )$$,
  '22023', 'standard_time_overlap',
  'inclusive ST overlap rejects a same-day boundary'
);

select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000016',
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'key','CONFLICT-MODEL|LEGACY-LINE|SPI',
        'modelCode','CONFLICT-MODEL','lineCode','LEGACY-LINE',
        'processCode','SPI','status','conflict','approved',false,
        'proposedSecondsPerUnit',null,'approvedSecondsPerUnit',null,
        'minimum',10,'median',10,'maximum',10.6,
        'effectiveFrom','2026-07-01','effectiveTo',null,
        'messages',jsonb_build_array('deviation'),
        'observations',jsonb_build_array(
          jsonb_build_object(
            'sheet','Production','row',5,'productionDate','2026-07-01',
            'shiftCode','DAY','timeSlotCode','A','capacityQty',720,
            'plannedSeconds',7200,'secondsPerUnit',10
          ),
          jsonb_build_object(
            'sheet','Production','row',6,'productionDate','2026-07-01',
            'shiftCode','DAY','timeSlotCode','A','capacityQty',679.245283,
            'plannedSeconds',7200,'secondsPerUnit',10.6
          )
        )
      ))
    )$$,
  'a greater-than-five-percent ST deviation stages for review'
);
select throws_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000016',
      false, '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'key','CONFLICT-MODEL|LEGACY-LINE|SPI',
        'approved',true,'approvedSecondsPerUnit',null,
        'effectiveFrom','2026-07-01','effectiveTo',null
      ))
    )$$,
  '22023', 'standard_time_conflict_unresolved',
  'a >5% ST conflict needs an explicit approved value'
);

insert into public.upload_rows (
  id, batch_id, source_sheet, source_row, row_kind, payload, status,
  created_by, updated_by
)
values (
  '23000000-0000-0000-0000-000000000203',
  '23000000-0000-0000-0000-000000000017',
  'Production', 10, 'production',
  jsonb_build_object(
    'contractVersion',2,'defects','[]'::jsonb,
    'downtime',jsonb_build_object('minutes',1,'reasonCode','MISSING-REASON'),
    'lineCode','LEGACY-LINE','modelCode','ROLLBACK-MODEL',
    'note','rollback detail','processCode','ROUTER',
    'production',jsonb_build_object('actualQty',1,'inputQty',1),
    'productionDate','2026-08-01','quality',null,'shiftCode','DAY',
    'sourceTrace',jsonb_build_object('row',10,'sheet','Production'),
    'timeSlotCode','A','warnings','[]'::jsonb
  ),
  'new',
  '23000000-0000-0000-0000-000000000002',
  '23000000-0000-0000-0000-000000000002'
);
select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000017',
      jsonb_build_array(jsonb_build_object(
        'key','model|ROLLBACK-MODEL','entity','model',
        'code','ROLLBACK-MODEL','parentCode',null,
        'proposedName','Rollback Model','status','new','approved',false,
        'startsAt',null,'endsAt',null,'endDayOffset',null,'sequence',null,
        'messages','[]'::jsonb,
        'sources',jsonb_build_array(jsonb_build_object('sheet','Production','row',10))
      )),
      jsonb_build_array(jsonb_build_object(
        'key','ROLLBACK-MODEL|LEGACY-LINE|ROUTER',
        'modelCode','ROLLBACK-MODEL','lineCode','LEGACY-LINE',
        'processCode','ROUTER','status','new','approved',false,
        'proposedSecondsPerUnit',11,'approvedSecondsPerUnit',null,
        'minimum',11,'median',11,'maximum',11,
        'effectiveFrom','2026-08-01','effectiveTo',null,
        'messages','[]'::jsonb,
        'observations',jsonb_build_array(jsonb_build_object(
          'sheet','Production','row',10,'productionDate','2026-08-01',
          'shiftCode','DAY','timeSlotCode','A','capacityQty',654.545454,
          'plannedSeconds',7200,'secondsPerUnit',11
        ))
      ))
    )$$,
  'rollback fixture candidates stage before final resolution'
);
select throws_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000017',
      false,
      jsonb_build_array(jsonb_build_object(
        'key','model|ROLLBACK-MODEL',
        'approved',true,'approvedName','Rollback Model'
      )),
      jsonb_build_array(jsonb_build_object(
        'key','ROLLBACK-MODEL|LEGACY-LINE|ROUTER',
        'approved',true,'approvedSecondsPerUnit',11,
        'effectiveFrom','2026-08-01','effectiveTo',null
      ))
    )$$,
  '22023',
  'an invalid final detail aborts the atomic commit'
);
select ok(
  not exists (
    select 1 from public.models where code = 'ROLLBACK-MODEL'
  )
  and not exists (
    select 1
    from public.standard_times as standard_time
    join public.models as model on model.id = standard_time.model_id
    where model.code = 'ROLLBACK-MODEL'
  ),
  'invalid detail rolls back the newly inserted model and ST'
);

select set_config(
  'request.jwt.claim.sub',
  '23000000-0000-0000-0000-000000000003',
  true
);
select ok(
  exists (
    select 1
    from public.upload_master_candidates
    where batch_id = '23000000-0000-0000-0000-000000000012'
  )
  and public.find_completed_upload_by_hash(repeat('a', 64)) is not null,
  'an active viewer can read visible candidate and completed-hash data'
);

reset role;

-- Exercise the superseding commit path against the historical rounding bug.
-- The production constraint currently requires minute-aligned slots, so this
-- test temporarily admits a 59m31s fixture inside the rolled-back test
-- transaction. The legacy resolver rounds it to 60; migration 023 must not.
alter table public.time_slots
  drop constraint time_slots_valid_duration;
update public.time_slots
set ends_at = '08:29:31'::time
where id = '23000000-0000-0000-0000-000000000104';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '23000000-0000-0000-0000-000000000002',
  true
);
insert into public.upload_rows (
  id, batch_id, source_sheet, source_row, row_kind, payload, status,
  created_by, updated_by
)
values (
  '23000000-0000-0000-0000-000000000204',
  '23000000-0000-0000-0000-000000000018',
  'Production', 20, 'production',
  jsonb_build_object(
    'contractVersion',2,'defects','[]'::jsonb,
    'downtime',jsonb_build_object(
      'minutes',60,'reasonCode','LEGACY-REASON'
    ),
    'lineCode','LEGACY-LINE','modelCode','LEGACY-MODEL',
    'note','fractional slot must roll back','processCode','ROUTER',
    'production',jsonb_build_object('actualQty',1,'inputQty',1),
    'productionDate','2026-09-01','quality',null,'shiftCode','DAY',
    'sourceTrace',jsonb_build_object('row',20,'sheet','Production'),
    'timeSlotCode','A','warnings','[]'::jsonb
  ),
  'new',
  '23000000-0000-0000-0000-000000000002',
  '23000000-0000-0000-0000-000000000002'
);
select lives_ok(
  $$select public.stage_upload_candidates(
      '23000000-0000-0000-0000-000000000018',
      '[]'::jsonb, '[]'::jsonb
    )$$,
  'fractional-slot detail reaches final database resolution'
);
select throws_ok(
  $$select public.commit_upload_batch_with_masters(
      '23000000-0000-0000-0000-000000000018',
      false, '[]'::jsonb, '[]'::jsonb
    )$$,
  '22023', 'downtime_exceeds_planned_time',
  '59m31s cannot authorize 60 downtime minutes'
);
select is_empty(
  $$select 1
    from public.production_records
    where note = 'fractional slot must roll back'$$,
  'exact-second downtime rejection leaves no production record'
);

select * from finish();
rollback;
