alter table public.upload_batches
  add column source_sha256 text,
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz,
  add column duplicate_policy text,
  add column commit_result jsonb;

alter table public.upload_batches
  drop constraint if exists upload_batches_status_check;
alter table public.upload_batches
  add constraint upload_batches_status_check
  check (
    status in (
      'staged', 'validated', 'committed', 'completed', 'failed'
    )
  );
alter table public.upload_batches
  add constraint upload_batches_source_sha256_format
  check (
    source_sha256 is null
    or source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint upload_batches_duplicate_policy_check
  check (
    duplicate_policy is null
    or duplicate_policy in ('skip', 'replace')
  ),
  add constraint upload_batches_completion_metadata
  check (
    (
      status = 'completed'
      and approved_by is not null
      and approved_at is not null
      and duplicate_policy is not null
      and commit_result is not null
    )
    or status <> 'completed'
  );

create unique index upload_batches_completed_source_sha256_unique
  on public.upload_batches (source_sha256)
  where status = 'completed'
    and source_sha256 is not null;

alter table public.upload_rows
  drop constraint if exists upload_rows_status_check;
alter table public.upload_rows
  add constraint upload_rows_status_check
  check (status in ('new', 'conflict', 'error', 'committed', 'skipped'));

create table public.upload_master_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.upload_batches(id) on delete cascade,
  candidate_key text not null,
  entity text not null
    check (
      entity in (
        'model', 'line', 'shift', 'time_slot', 'downtime_reason'
      )
    ),
  normalized_code text not null,
  parent_code text,
  proposed_data jsonb not null,
  approved_data jsonb,
  status text not null
    check (status in ('existing', 'new', 'conflict', 'error')),
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sources) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  version bigint not null default 1,
  unique (batch_id, candidate_key)
);

create index upload_master_candidates_batch_status_idx
  on public.upload_master_candidates (batch_id, status);

create table public.upload_standard_time_candidates (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.upload_batches(id) on delete cascade,
  candidate_key text not null,
  model_code text not null,
  line_code text not null,
  process_code text not null
    check (process_code in ('SPI', 'AOI', 'XRAY', 'ICT', 'ROUTER')),
  minimum_seconds_per_unit numeric not null,
  median_seconds_per_unit numeric not null,
  maximum_seconds_per_unit numeric not null,
  proposed_seconds_per_unit numeric,
  approved_seconds_per_unit numeric,
  effective_from date not null,
  effective_to date,
  approved_effective_from date,
  approved_effective_to date,
  observations jsonb not null
    check (jsonb_typeof(observations) = 'array'),
  status text not null
    check (status in ('existing', 'new', 'conflict', 'error')),
  messages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id),
  version bigint not null default 1,
  unique (batch_id, candidate_key),
  check (effective_to is null or effective_to >= effective_from),
  check (
    approved_effective_to is null
    or approved_effective_from is null
    or approved_effective_to >= approved_effective_from
  )
);

create index upload_standard_time_candidates_batch_status_idx
  on public.upload_standard_time_candidates (batch_id, status);

alter table public.upload_master_candidates enable row level security;
alter table public.upload_standard_time_candidates enable row level security;

create or replace function private.current_profile()
returns table (
  profile_id uuid,
  app_role text,
  profile_is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.id, profile.role, profile.is_active
  from public.profiles as profile
  where profile.id = auth.uid()
$$;

revoke all on function private.current_profile()
  from public, anon, authenticated;

create or replace function private.can_view_upload_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.current_profile() as caller
    join public.upload_batches as batch
      on batch.id = p_batch_id
    where caller.profile_id = auth.uid()
      and caller.profile_is_active
      and caller.app_role in ('viewer', 'operator', 'admin')
      and batch.deleted_at is null
      and (
        caller.app_role in ('viewer', 'admin')
        or batch.created_by = caller.profile_id
      )
  )
$$;

revoke all on function private.can_view_upload_batch(uuid)
  from public, anon, authenticated;
grant execute on function private.can_view_upload_batch(uuid)
  to authenticated;

drop policy if exists upload_batches_active_profile_select
  on public.upload_batches;
create policy upload_batches_active_profile_select
on public.upload_batches
for select
to authenticated
using (private.can_view_upload_batch(id));

drop policy if exists upload_rows_active_profile_select
  on public.upload_rows;
create policy upload_rows_active_profile_select
on public.upload_rows
for select
to authenticated
using (
  deleted_at is null
  and private.can_view_upload_batch(batch_id)
);

create policy upload_master_candidates_visible_select
on public.upload_master_candidates
for select
to authenticated
using (private.can_view_upload_batch(batch_id));

create policy upload_standard_time_candidates_visible_select
on public.upload_standard_time_candidates
for select
to authenticated
using (private.can_view_upload_batch(batch_id));

revoke all on table public.upload_master_candidates
  from anon, authenticated;
revoke all on table public.upload_standard_time_candidates
  from anon, authenticated;
grant select on table public.upload_master_candidates
  to authenticated;
grant select on table public.upload_standard_time_candidates
  to authenticated;

create trigger upload_master_candidates_audit
after insert or update or delete on public.upload_master_candidates
for each row execute function private.audit_business_mutation();

create trigger upload_standard_time_candidates_audit
after insert or update or delete on public.upload_standard_time_candidates
for each row execute function private.audit_business_mutation();

create or replace function private.legacy_slot_definition(
  p_shift_code text,
  p_slot_code text
)
returns table (
  expected_starts_at time,
  expected_ends_at time,
  expected_end_day_offset smallint,
  expected_sequence integer
)
language sql
immutable
set search_path = ''
as $$
  select definition.starts_at,
         definition.ends_at,
         definition.end_day_offset,
         definition.sequence
  from (
    values
      ('DAY', 'A', '07:30'::time, '09:30'::time, 0::smallint, 1),
      ('DAY', 'B', '09:30'::time, '13:00'::time, 0::smallint, 2),
      ('DAY', 'C', '13:00'::time, '15:00'::time, 0::smallint, 3),
      ('DAY', 'D', '15:00'::time, '17:00'::time, 0::smallint, 4),
      ('DAY', 'E', '17:00'::time, '19:30'::time, 0::smallint, 5),
      ('NIGHT', 'A', '19:30'::time, '21:30'::time, 0::smallint, 1),
      ('NIGHT', 'B', '21:30'::time, '01:00'::time, 1::smallint, 2),
      ('NIGHT', 'C', '01:00'::time, '03:00'::time, 0::smallint, 3),
      ('NIGHT', 'D', '03:00'::time, '05:00'::time, 0::smallint, 4),
      ('NIGHT', 'E', '05:00'::time, '07:30'::time, 0::smallint, 5)
  ) as definition(
    shift_code, slot_code, starts_at, ends_at, end_day_offset, sequence
  )
  where definition.shift_code = p_shift_code
    and definition.slot_code = p_slot_code
$$;

revoke all on function private.legacy_slot_definition(text, text)
  from public, anon, authenticated;

create or replace function private.validate_legacy_upload_v2_structure(
  p_payload jsonb,
  p_source_sheet text,
  p_source_row integer
)
returns table (
  validated_row_kind text,
  validated_production_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expected_root_keys text[] := array[
    'contractVersion', 'defects', 'downtime', 'lineCode', 'modelCode',
    'note', 'processCode', 'production', 'productionDate', 'quality',
    'shiftCode', 'sourceTrace', 'timeSlotCode', 'warnings'
  ];
  actual_keys text[];
  contract_version integer;
  trace_row integer;
  production_payload jsonb;
  quality_payload jsonb;
  downtime_payload jsonb;
  defect_payload jsonb;
  warning_payload jsonb;
  production_input integer;
  actual_qty integer;
  quality_input integer;
  ok_qty integer;
  ng_qty integer;
  downtime_minutes integer := 0;
  defect_source_row integer;
  defect_parent_row integer;
  defect_quantity integer;
  defect_total integer := 0;
  slot_definition record;
  slot_seconds numeric;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  select array_agg(key_name order by key_name)
  into actual_keys
  from jsonb_object_keys(p_payload) as key_name;

  if actual_keys is distinct from expected_root_keys
    or jsonb_typeof(p_payload -> 'sourceTrace') <> 'object'
    or jsonb_typeof(p_payload -> 'defects') <> 'array'
    or jsonb_typeof(p_payload -> 'warnings') <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  begin
    contract_version := (p_payload ->> 'contractVersion')::integer;
    trace_row := (p_payload #>> '{sourceTrace,row}')::integer;
    validated_production_date := (p_payload ->> 'productionDate')::date;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
  end;

  select array_agg(key_name order by key_name)
  into actual_keys
  from jsonb_object_keys(p_payload -> 'sourceTrace') as key_name;

  if contract_version <> 2
    or actual_keys is distinct from array['row', 'sheet']
    or trace_row is distinct from p_source_row
    or p_payload #>> '{sourceTrace,sheet}' is distinct from p_source_sheet
    or validated_production_date is null
    or nullif(btrim(p_payload ->> 'modelCode'), '') is null
    or nullif(btrim(p_payload ->> 'lineCode'), '') is null
    or p_payload ->> 'processCode'
      not in ('SPI', 'AOI', 'XRAY', 'ICT', 'ROUTER')
    or p_payload ->> 'shiftCode' not in ('DAY', 'NIGHT')
    or jsonb_typeof(p_payload -> 'note') <> 'string'
    or length(p_payload ->> 'note') > 1000 then
    if p_payload ->> 'processCode'
      not in ('SPI', 'AOI', 'XRAY', 'ICT', 'ROUTER') then
      raise exception using
        errcode = '22023',
        message = 'unsupported_process';
    end if;
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  production_payload := p_payload -> 'production';
  quality_payload := p_payload -> 'quality';
  downtime_payload := p_payload -> 'downtime';

  if jsonb_typeof(production_payload) = 'null' then
    production_payload := null;
    validated_row_kind := 'daily_quality';
  elsif jsonb_typeof(production_payload) = 'object' then
    validated_row_kind := 'production';
    select array_agg(key_name order by key_name)
    into actual_keys
    from jsonb_object_keys(production_payload) as key_name;
    begin
      production_input := (production_payload ->> 'inputQty')::integer;
      actual_qty := (production_payload ->> 'actualQty')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;
    if actual_keys is distinct from array['actualQty', 'inputQty']
      or production_input < 0
      or actual_qty < 0 then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  if jsonb_typeof(quality_payload) = 'null' then
    quality_payload := null;
  elsif jsonb_typeof(quality_payload) = 'object' then
    select array_agg(key_name order by key_name)
    into actual_keys
    from jsonb_object_keys(quality_payload) as key_name;
    begin
      quality_input := (quality_payload ->> 'inputQty')::integer;
      ok_qty := (quality_payload ->> 'okQty')::integer;
      ng_qty := (quality_payload ->> 'ngQty')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;
    if actual_keys is distinct from array['inputQty', 'ngQty', 'okQty']
      or quality_input < 0
      or ok_qty < 0
      or ng_qty < 0
      or ok_qty > quality_input
      or ok_qty + ng_qty > quality_input then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  if production_payload is null and quality_payload is null then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;
  if production_payload is not null
    and quality_payload is not null
    and production_input is distinct from quality_input then
    raise exception using
      errcode = '22023',
      message = 'invalid_linked_quality_input';
  end if;

  if validated_row_kind = 'daily_quality' then
    if quality_payload is null
      or p_payload ->> 'processCode' not in ('SPI', 'AOI', 'XRAY', 'ICT')
      or jsonb_typeof(downtime_payload) <> 'null' then
      raise exception using
        errcode = '22023',
        message = 'invalid_daily_quality_payload';
    end if;
  elsif nullif(p_payload ->> 'timeSlotCode', '') is null then
    raise exception using
      errcode = '22023',
      message = 'upload_row_requires_time_slot';
  end if;

  if validated_row_kind = 'production' then
    select *
    into slot_definition
    from private.legacy_slot_definition(
      p_payload ->> 'shiftCode',
      p_payload ->> 'timeSlotCode'
    );
    if not found then
      raise exception using
        errcode = '22023',
        message = 'invalid_time_slot';
    end if;
  end if;

  if jsonb_typeof(downtime_payload) = 'null' then
    downtime_minutes := 0;
  elsif validated_row_kind = 'production'
    and jsonb_typeof(downtime_payload) = 'object' then
    select array_agg(key_name order by key_name)
    into actual_keys
    from jsonb_object_keys(downtime_payload) as key_name;
    begin
      downtime_minutes := (downtime_payload ->> 'minutes')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;
    if actual_keys is distinct from array['minutes', 'reasonCode']
      or downtime_minutes <= 0
      or nullif(btrim(downtime_payload ->> 'reasonCode'), '') is null then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  if validated_row_kind = 'production' then
    slot_seconds := extract(
      epoch from (
        date '2000-01-01'
        + slot_definition.expected_ends_at
        + slot_definition.expected_end_day_offset * interval '1 day'
        - (
          date '2000-01-01'
          + slot_definition.expected_starts_at
        )
      )
    );
    if downtime_minutes * 60 > slot_seconds then
      raise exception using
        errcode = '22023',
        message = 'downtime_exceeds_planned_time';
    end if;
  end if;

  for warning_payload in
    select warning.value
    from jsonb_array_elements(p_payload -> 'warnings') as warning(value)
  loop
    if jsonb_typeof(warning_payload) <> 'string'
      or warning_payload #>> '{}' <>
        'legacy-downtime-reason-unspecified' then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;
  end loop;

  for defect_payload in
    select defect.value
    from jsonb_array_elements(p_payload -> 'defects') as defect(value)
  loop
    if jsonb_typeof(defect_payload) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'invalid_defect_payload';
    end if;
    select array_agg(key_name order by key_name)
    into actual_keys
    from jsonb_object_keys(defect_payload) as key_name;
    begin
      defect_source_row := (defect_payload ->> 'sourceRow')::integer;
      defect_parent_row :=
        (defect_payload ->> 'productionSourceRow')::integer;
      defect_quantity := (defect_payload ->> 'quantity')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'invalid_defect_payload';
    end;
    if quality_payload is null
      or actual_keys is distinct from array[
        'classification', 'defectType', 'productionSourceRow',
        'quantity', 'sourceRow', 'sourceSheet'
      ]
      or defect_payload ->> 'sourceSheet' <> 'Defects'
      or defect_source_row <= 0
      or defect_parent_row is distinct from p_source_row
      or nullif(btrim(defect_payload ->> 'defectType'), '') is null
      or length(btrim(defect_payload ->> 'defectType')) > 200
      or btrim(defect_payload ->> 'defectType') ~ '^[=+@-]'
      or defect_payload ->> 'classification'
        not in ('pseudo', 'real', 'scrap')
      or defect_quantity <= 0 then
      raise exception using
        errcode = '22023',
        message = 'invalid_defect_payload';
    end if;
    defect_total := defect_total + defect_quantity;
  end loop;

  if defect_total > coalesce(ng_qty, 0)
    or exists (
      select 1
      from jsonb_array_elements(p_payload -> 'defects')
        with ordinality as left_defect(value, ordinal)
      join jsonb_array_elements(p_payload -> 'defects')
        with ordinality as right_defect(value, ordinal)
        on left_defect.ordinal < right_defect.ordinal
       and lower(btrim(left_defect.value ->> 'defectType'))
         = lower(btrim(right_defect.value ->> 'defectType'))
       and left_defect.value ->> 'classification'
         = right_defect.value ->> 'classification'
    ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_defect_payload';
  end if;

  return next;
end
$$;

revoke all on function private.validate_legacy_upload_v2_structure(
  jsonb, text, integer
) from public, anon, authenticated;

create or replace function private.enforce_upload_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  commit_mode boolean :=
    coalesce(current_setting('app.commit_upload_mode', true), 'off') = 'on';
  actor_id uuid := auth.uid();
  actor_role text := public.current_app_role();
  validated record;
begin
  if tg_table_name = 'upload_batches' then
    if tg_op = 'INSERT' and new.status not in ('staged', 'validated') then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_invalid_initial_status';
    end if;
    if tg_op = 'UPDATE' and not commit_mode then
      raise exception using
        errcode = '42501',
        message = 'upload_batch_status_managed_by_rpc';
    end if;
    return new;
  end if;

  if commit_mode then
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '42501',
      message = 'upload_row_commit_fields_managed_by_rpc';
  end if;
  if actor_id is null
    or actor_role not in ('operator', 'admin')
    or new.status not in ('new', 'conflict', 'error')
    or new.production_record_id is not null
    or new.quality_record_id is not null
    or new.defect_record_id is not null
    or new.parent_upload_row_id is not null
    or new.deleted_at is not null
    or not exists (
      select 1
      from public.upload_batches as batch
      where batch.id = new.batch_id
        and batch.created_by = actor_id
        and batch.deleted_at is null
        and batch.status in ('staged', 'validated')
    ) then
    raise exception using
      errcode = '42501',
      message = 'upload_row_invalid_initial_state';
  end if;

  if new.status = 'conflict' then
    if new.target_record_id is null
      or new.expected_target_version is null
      or new.expected_target_version <= 0 then
      raise exception using
        errcode = '22023',
        message = 'upload_target_metadata_required';
    end if;
  elsif new.target_record_id is not null
    or new.expected_target_version is not null then
    raise exception using
      errcode = '22023',
      message = 'upload_target_metadata_forbidden';
  end if;

  if new.status = 'error' then
    if new.row_kind <> 'diagnostic' then
      raise exception using
        errcode = '22023',
        message = 'invalid_diagnostic_row';
    end if;
    return new;
  end if;

  select *
  into validated
  from private.validate_legacy_upload_v2_structure(
    new.payload, new.source_sheet, new.source_row
  );
  if new.row_kind is distinct from validated.validated_row_kind then
    raise exception using
      errcode = '22023',
      message = 'invalid_upload_row_kind';
  end if;
  return new;
end
$$;

drop trigger if exists upload_batches_guard on public.upload_batches;
create trigger upload_batches_guard
before insert or update on public.upload_batches
for each row execute function private.enforce_upload_workflow();

drop trigger if exists upload_rows_guard on public.upload_rows;
create trigger upload_rows_guard
before insert or update on public.upload_rows
for each row execute function private.enforce_upload_workflow();

create or replace function public.find_completed_upload_by_hash(
  p_source_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
begin
  if auth.uid() is null
    or p_source_sha256 !~ '^[0-9a-f]{64}$' then
    if auth.uid() is null then
      raise exception using
        errcode = '42501',
        message = 'authentication_required';
    end if;
    raise exception using
      errcode = '22023',
      message = 'invalid_source_sha256';
  end if;

  select jsonb_build_object(
    'id', batch.id,
    'sourceFileName', batch.source_file_name,
    'workbookKind', batch.workbook_kind,
    'completedAt', batch.approved_at
  )
  into result_value
  from public.upload_batches as batch
  where batch.source_sha256 = p_source_sha256
    and batch.status = 'completed'
    and private.can_view_upload_batch(batch.id)
  order by batch.approved_at desc, batch.id
  limit 1;
  return result_value;
end
$$;

create or replace function public.list_upload_detail_page(
  p_batch_id uuid,
  p_offset integer,
  p_limit integer,
  p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := greatest(least(coalesce(p_limit, 200), 200), 1);
  total_count bigint;
  page_rows jsonb;
begin
  if auth.uid() is null
    or not private.can_view_upload_batch(p_batch_id) then
    raise exception using
      errcode = '42501',
      message = 'upload_batch_not_visible';
  end if;
  if p_status is not null
    and p_status not in (
      'new', 'conflict', 'error', 'committed', 'skipped'
    ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_upload_status';
  end if;

  select count(*)
  into total_count
  from public.upload_rows as detail
  where detail.batch_id = p_batch_id
    and detail.deleted_at is null
    and (p_status is null or detail.status = p_status);

  select coalesce(jsonb_agg(page.row_data order by page.ordinal), '[]'::jsonb)
  into page_rows
  from (
    select jsonb_build_object(
      'id', detail.id,
      'batchId', detail.batch_id,
      'sourceSheet', detail.source_sheet,
      'sourceRow', detail.source_row,
      'rowKind', detail.row_kind,
      'payload', detail.payload,
      'status', detail.status,
      'messages', detail.messages,
      'targetRecordId', detail.target_record_id,
      'expectedTargetVersion', detail.expected_target_version,
      'productionRecordId', detail.production_record_id,
      'qualityRecordId', detail.quality_record_id,
      'defectRecordId', detail.defect_record_id
    ) as row_data,
    row_number() over (
      order by detail.source_sheet, detail.source_row, detail.id
    ) as ordinal
    from public.upload_rows as detail
    where detail.batch_id = p_batch_id
      and detail.deleted_at is null
      and (p_status is null or detail.status = p_status)
    order by detail.source_sheet, detail.source_row, detail.id
    offset safe_offset
    limit safe_limit
  ) as page;

  return jsonb_build_object('rows', page_rows, 'total', total_count);
end
$$;

create or replace function public.stage_upload_candidates(
  p_batch_id uuid,
  p_master_candidates jsonb,
  p_standard_time_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_profile record;
  batch public.upload_batches%rowtype;
  candidate jsonb;
  candidate_key text;
  candidate_entity text;
  candidate_code text;
  candidate_parent text;
  candidate_status text;
  st_min numeric;
  st_median numeric;
  st_max numeric;
  st_proposed numeric;
  st_from date;
  st_to date;
  master_count integer := 0;
  standard_time_count integer := 0;
begin
  select *
  into actor_profile
  from private.current_profile();
  if actor_id is null
    or actor_profile.profile_id is distinct from actor_id
    or not actor_profile.profile_is_active
    or actor_profile.app_role not in ('operator', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'candidate_staging_forbidden';
  end if;

  select candidate_batch.*
  into batch
  from public.upload_batches as candidate_batch
  where candidate_batch.id = p_batch_id
    and candidate_batch.deleted_at is null
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'upload_batch_not_found';
  end if;
  if batch.created_by <> actor_id
    or batch.status not in ('staged', 'validated') then
    raise exception using
      errcode = '42501',
      message = 'candidate_staging_forbidden';
  end if;
  if jsonb_typeof(p_master_candidates) <> 'array'
    or jsonb_typeof(p_standard_time_candidates) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'invalid_candidate_payload';
  end if;
  if (
    jsonb_array_length(p_master_candidates) > 0
    or jsonb_array_length(p_standard_time_candidates) > 0
  ) and (
    exists (
      select 1 from public.upload_master_candidates
      where batch_id = p_batch_id
    )
    or exists (
      select 1 from public.upload_standard_time_candidates
      where batch_id = p_batch_id
    )
  ) then
    raise exception using
      errcode = '23505',
      message = 'upload_candidates_already_staged';
  end if;

  for candidate in
    select item.value
    from jsonb_array_elements(p_master_candidates) as item(value)
  loop
    if jsonb_typeof(candidate) <> 'object'
      or jsonb_typeof(candidate -> 'messages') <> 'array'
      or jsonb_typeof(candidate -> 'sources') <> 'array' then
      raise exception using
        errcode = '22023',
        message = 'invalid_master_candidate';
    end if;
    candidate_key := candidate ->> 'key';
    candidate_entity := candidate ->> 'entity';
    candidate_code := candidate ->> 'code';
    candidate_parent := nullif(candidate ->> 'parentCode', '');
    candidate_status := candidate ->> 'status';
    if candidate_entity not in (
        'model', 'line', 'shift', 'time_slot', 'downtime_reason'
      )
      or candidate_status not in ('existing', 'new', 'conflict', 'error')
      or candidate_code is distinct from btrim(candidate_code)
      or candidate_code = ''
      or length(candidate_code) > 100
      or candidate_code ~ '^[=+@-]'
      or (
        candidate_entity = 'time_slot'
        and (
          candidate_parent not in ('DAY', 'NIGHT')
          or candidate_code not in ('A', 'B', 'C', 'D', 'E')
          or candidate_key <>
            'time_slot|' || candidate_parent || '|' || candidate_code
        )
      )
      or (
        candidate_entity <> 'time_slot'
        and (
          candidate_parent is not null
          or candidate_key <> (
            candidate_entity || '|' || candidate_code
          )
        )
      )
      or (
        candidate_entity = 'shift'
        and candidate_code not in ('DAY', 'NIGHT')
      ) then
      raise exception using
        errcode = '22023',
        message = 'invalid_master_candidate';
    end if;

    insert into public.upload_master_candidates (
      batch_id, candidate_key, entity, normalized_code, parent_code,
      proposed_data, status, messages, sources, created_by, updated_by
    )
    values (
      p_batch_id, candidate_key, candidate_entity, candidate_code,
      candidate_parent, candidate, candidate_status,
      candidate -> 'messages', candidate -> 'sources', actor_id, actor_id
    );
    master_count := master_count + 1;
  end loop;

  for candidate in
    select item.value
    from jsonb_array_elements(p_standard_time_candidates) as item(value)
  loop
    if jsonb_typeof(candidate) <> 'object'
      or jsonb_typeof(candidate -> 'messages') <> 'array'
      or jsonb_typeof(candidate -> 'observations') <> 'array' then
      raise exception using
        errcode = '22023',
        message = 'invalid_standard_time_candidate';
    end if;
    if candidate ->> 'processCode'
      not in ('SPI', 'AOI', 'XRAY', 'ICT', 'ROUTER') then
      raise exception using
        errcode = '22023',
        message = 'unsupported_process';
    end if;
    begin
      candidate_key := candidate ->> 'key';
      candidate_status := candidate ->> 'status';
      st_min := (candidate ->> 'minimum')::numeric;
      st_median := (candidate ->> 'median')::numeric;
      st_max := (candidate ->> 'maximum')::numeric;
      st_proposed := nullif(
        candidate ->> 'proposedSecondsPerUnit', ''
      )::numeric;
      st_from := (candidate ->> 'effectiveFrom')::date;
      st_to := nullif(candidate ->> 'effectiveTo', '')::date;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'invalid_standard_time_candidate';
    end;
    if candidate_status not in ('existing', 'new', 'conflict', 'error')
      or candidate_key <> (
        (candidate ->> 'modelCode') || '|' ||
        (candidate ->> 'lineCode') || '|' ||
        (candidate ->> 'processCode')
      )
      or nullif(btrim(candidate ->> 'modelCode'), '') is null
      or nullif(btrim(candidate ->> 'lineCode'), '') is null
      or st_min::text = 'NaN'
      or st_median::text = 'NaN'
      or st_max::text = 'NaN'
      or st_min <= 0
      or st_min > st_median
      or st_median > st_max
      or (
        st_proposed is not null
        and (st_proposed::text = 'NaN' or st_proposed <= 0)
      )
      or (candidate_status = 'new' and st_proposed is null)
      or st_from is null
      or (st_to is not null and st_to < st_from)
      or jsonb_array_length(candidate -> 'observations') = 0 then
      raise exception using
        errcode = '22023',
        message = 'invalid_standard_time_candidate';
    end if;

    insert into public.upload_standard_time_candidates (
      batch_id, candidate_key, model_code, line_code, process_code,
      minimum_seconds_per_unit, median_seconds_per_unit,
      maximum_seconds_per_unit, proposed_seconds_per_unit,
      effective_from, effective_to, observations, status, messages,
      created_by, updated_by
    )
    values (
      p_batch_id, candidate_key,
      candidate ->> 'modelCode',
      candidate ->> 'lineCode',
      candidate ->> 'processCode',
      st_min, st_median, st_max, st_proposed,
      st_from, st_to, candidate -> 'observations',
      candidate_status, candidate -> 'messages', actor_id, actor_id
    );
    standard_time_count := standard_time_count + 1;
  end loop;

  return jsonb_build_object(
    'batchId', p_batch_id,
    'masterCandidateCount', master_count,
    'standardTimeCandidateCount', standard_time_count
  );
end
$$;

create or replace function public.commit_upload_batch_with_masters(
  p_batch_id uuid,
  p_replace_conflicts boolean,
  p_master_approvals jsonb,
  p_standard_time_approvals jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_profile record;
  allow_replacement boolean := coalesce(p_replace_conflicts, false);
  batch public.upload_batches%rowtype;
  master_candidate public.upload_master_candidates%rowtype;
  standard_time_candidate
    public.upload_standard_time_candidates%rowtype;
  staged_row public.upload_rows%rowtype;
  production_target public.production_records%rowtype;
  quality_target public.quality_records%rowtype;
  validated record;
  approval jsonb;
  defect_payload jsonb;
  slot_definition record;
  existing_id uuid;
  existing_name text;
  existing_active boolean;
  existing_starts_at time;
  existing_ends_at time;
  existing_end_day_offset smallint;
  existing_sequence integer;
  resolved_model_id uuid;
  resolved_line_id uuid;
  resolved_process_id uuid;
  resolved_shift_id uuid;
  quality_id uuid;
  defect_id uuid;
  first_defect_id uuid;
  final_seconds numeric;
  final_from date;
  final_to date;
  exact_slot_seconds numeric;
  has_explicit_standard_time boolean;
  has_deviation_conflict boolean;
  inserted_count integer := 0;
  replaced_count integer := 0;
  skipped_count integer := 0;
  quality_inserted_count integer := 0;
  quality_replaced_count integer := 0;
  defect_inserted_count integer := 0;
  master_inserted_count integer := 0;
  standard_time_inserted_count integer := 0;
  staged_new_count integer := 0;
  staged_conflict_count integer := 0;
  staged_error_count integer := 0;
  result_value jsonb;
begin
  select *
  into actor_profile
  from private.current_profile();
  if actor_id is null
    or actor_profile.profile_id is distinct from actor_id
    or not actor_profile.profile_is_active
    or actor_profile.app_role <> 'admin' then
    raise exception using
      errcode = '42501',
      message = 'admin_required';
  end if;

  select candidate_batch.*
  into batch
  from public.upload_batches as candidate_batch
  where candidate_batch.id = p_batch_id
    and candidate_batch.deleted_at is null
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'upload_batch_not_found';
  end if;

  if batch.status = 'completed' then
    return batch.commit_result;
  end if;
  if batch.status not in ('staged', 'validated') then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_not_committable';
  end if;
  perform set_config('app.commit_upload_mode', 'on', true);
  if jsonb_typeof(p_master_approvals) <> 'array'
    or jsonb_typeof(p_standard_time_approvals) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'invalid_approval_payload';
  end if;

  if exists (
    select 1
    from public.upload_master_candidates
    where batch_id = p_batch_id
      and status = 'error'
  ) or exists (
    select 1
    from public.upload_standard_time_candidates
    where batch_id = p_batch_id
      and status = 'error'
  ) then
    raise exception using
      errcode = '22023',
      message = 'upload_candidate_has_errors';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_master_approvals)
      with ordinality as left_approval(value, ordinal)
    join jsonb_array_elements(p_master_approvals)
      with ordinality as right_approval(value, ordinal)
      on left_approval.ordinal < right_approval.ordinal
     and left_approval.value ->> 'key'
       = right_approval.value ->> 'key'
  ) or exists (
    select 1
    from jsonb_array_elements(p_standard_time_approvals)
      with ordinality as left_approval(value, ordinal)
    join jsonb_array_elements(p_standard_time_approvals)
      with ordinality as right_approval(value, ordinal)
      on left_approval.ordinal < right_approval.ordinal
     and left_approval.value ->> 'key'
       = right_approval.value ->> 'key'
  ) then
    raise exception using
      errcode = '22023',
      message = 'duplicate_candidate_approval';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_master_approvals) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or not exists (
        select 1
        from public.upload_master_candidates as candidate
        where candidate.batch_id = p_batch_id
          and candidate.candidate_key = item.value ->> 'key'
      )
  ) or exists (
    select 1
    from jsonb_array_elements(p_standard_time_approvals) as item(value)
    where jsonb_typeof(item.value) <> 'object'
      or not exists (
        select 1
        from public.upload_standard_time_candidates as candidate
        where candidate.batch_id = p_batch_id
          and candidate.candidate_key = item.value ->> 'key'
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'unknown_candidate_approval';
  end if;

  if exists (
    select 1
    from public.upload_master_candidates as candidate
    where candidate.batch_id = p_batch_id
      and candidate.status in ('new', 'conflict')
      and not exists (
        select 1
        from jsonb_array_elements(p_master_approvals) as item(value)
        where item.value ->> 'key' = candidate.candidate_key
      )
  ) or exists (
    select 1
    from public.upload_standard_time_candidates as candidate
    where candidate.batch_id = p_batch_id
      and candidate.status in ('new', 'conflict')
      and not exists (
        select 1
        from jsonb_array_elements(p_standard_time_approvals) as item(value)
        where item.value ->> 'key' = candidate.candidate_key
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'candidate_approval_required';
  end if;

  for master_candidate in
    select candidate.*
    from public.upload_master_candidates as candidate
    where candidate.batch_id = p_batch_id
    order by
      case candidate.entity
        when 'model' then 1
        when 'line' then 2
        when 'shift' then 3
        when 'time_slot' then 4
        when 'downtime_reason' then 5
      end,
      candidate.candidate_key
    for update
  loop
    approval := null;
    if master_candidate.status in ('new', 'conflict') then
      select item.value
      into approval
      from jsonb_array_elements(p_master_approvals) as item(value)
      where item.value ->> 'key' = master_candidate.candidate_key;
      if coalesce((approval ->> 'approved')::boolean, false) is not true
        or nullif(btrim(approval ->> 'approvedName'), '') is null then
        raise exception using
          errcode = '22023',
          message = 'candidate_not_approved';
      end if;
    end if;

    existing_id := null;
    existing_name := null;
    existing_active := null;
    existing_starts_at := null;
    existing_ends_at := null;
    existing_end_day_offset := null;
    existing_sequence := null;

    if master_candidate.entity = 'model' then
      select model.id, model.name, model.is_active
      into existing_id, existing_name, existing_active
      from public.models as model
      where model.code = master_candidate.normalized_code
        and model.deleted_at is null;
    elsif master_candidate.entity = 'line' then
      select line.id, line.name, line.is_active
      into existing_id, existing_name, existing_active
      from public.lines as line
      where line.code = master_candidate.normalized_code
        and line.deleted_at is null;
    elsif master_candidate.entity = 'shift' then
      if master_candidate.normalized_code not in ('DAY', 'NIGHT') then
        raise exception using
          errcode = '22023',
          message = 'invalid_shift';
      end if;
      select shift.id, shift.name, shift.is_active
      into existing_id, existing_name, existing_active
      from public.shifts as shift
      where shift.code = master_candidate.normalized_code
        and shift.deleted_at is null;
    elsif master_candidate.entity = 'downtime_reason' then
      select reason.id, reason.name, reason.is_active
      into existing_id, existing_name, existing_active
      from public.downtime_reasons as reason
      where reason.code = master_candidate.normalized_code
        and reason.deleted_at is null;
    else
      select *
      into slot_definition
      from private.legacy_slot_definition(
        master_candidate.parent_code,
        master_candidate.normalized_code
      );
      if not found
        or (master_candidate.proposed_data ->> 'startsAt')::time
          is distinct from slot_definition.expected_starts_at
        or (master_candidate.proposed_data ->> 'endsAt')::time
          is distinct from slot_definition.expected_ends_at
        or (master_candidate.proposed_data ->> 'endDayOffset')::smallint
          is distinct from slot_definition.expected_end_day_offset
        or (master_candidate.proposed_data ->> 'sequence')::integer
          is distinct from slot_definition.expected_sequence then
        raise exception using
          errcode = '22023',
          message = 'invalid_time_slot';
      end if;
      select shift.id
      into resolved_shift_id
      from public.shifts as shift
      where shift.code = master_candidate.parent_code
        and shift.is_active
        and shift.deleted_at is null;
      if resolved_shift_id is null then
        raise exception using
          errcode = '22023',
          message = 'inactive_master_data';
      end if;
      select
        slot.id, slot.code, slot.is_active, slot.starts_at, slot.ends_at,
        slot.end_day_offset, slot.sequence
      into
        existing_id, existing_name, existing_active, existing_starts_at,
        existing_ends_at, existing_end_day_offset, existing_sequence
      from public.time_slots as slot
      where slot.shift_id = resolved_shift_id
        and slot.code = master_candidate.normalized_code
        and slot.deleted_at is null;
    end if;

    if master_candidate.status = 'existing' then
      if existing_id is null
        or not existing_active
        or (
          master_candidate.entity <> 'time_slot'
          and existing_name is distinct from
            master_candidate.proposed_data ->> 'proposedName'
        )
        or (
          master_candidate.entity = 'time_slot'
          and (
            existing_starts_at is distinct from
              slot_definition.expected_starts_at
            or existing_ends_at is distinct from
              slot_definition.expected_ends_at
            or existing_end_day_offset is distinct from
              slot_definition.expected_end_day_offset
            or existing_sequence is distinct from
              slot_definition.expected_sequence
          )
        ) then
        raise exception using
          errcode = '22023',
          message = 'staged_master_changed';
      end if;
    elsif master_candidate.status = 'conflict' then
      if existing_id is null or not existing_active then
        raise exception using
          errcode = '22023',
          message = 'inactive_master_data';
      end if;
      if master_candidate.entity <> 'time_slot'
        and approval ->> 'approvedName' is distinct from existing_name then
        raise exception using
          errcode = '22023',
          message = 'existing_master_name_change_forbidden';
      end if;
      if master_candidate.entity = 'time_slot'
        and (
          existing_starts_at is distinct from
            slot_definition.expected_starts_at
          or existing_ends_at is distinct from
            slot_definition.expected_ends_at
          or existing_end_day_offset is distinct from
            slot_definition.expected_end_day_offset
          or existing_sequence is distinct from
            slot_definition.expected_sequence
        ) then
        raise exception using
          errcode = '22023',
          message = 'invalid_time_slot';
      end if;
    elsif master_candidate.status = 'new' then
      if existing_id is not null then
        raise exception using
          errcode = '22023',
          message = 'staged_master_changed';
      end if;
      if master_candidate.entity = 'model' then
        insert into public.models (
          code, name, created_by, updated_by
        ) values (
          master_candidate.normalized_code,
          btrim(approval ->> 'approvedName'),
          actor_id, actor_id
        );
      elsif master_candidate.entity = 'line' then
        insert into public.lines (
          code, name, created_by, updated_by
        ) values (
          master_candidate.normalized_code,
          btrim(approval ->> 'approvedName'),
          actor_id, actor_id
        );
      elsif master_candidate.entity = 'shift' then
        insert into public.shifts (
          code, name, created_by, updated_by
        ) values (
          master_candidate.normalized_code,
          btrim(approval ->> 'approvedName'),
          actor_id, actor_id
        );
      elsif master_candidate.entity = 'time_slot' then
        insert into public.time_slots (
          shift_id, code, starts_at, ends_at, end_day_offset, sequence,
          created_by, updated_by
        ) values (
          resolved_shift_id,
          master_candidate.normalized_code,
          slot_definition.expected_starts_at,
          slot_definition.expected_ends_at,
          slot_definition.expected_end_day_offset,
          slot_definition.expected_sequence,
          actor_id, actor_id
        );
      else
        insert into public.downtime_reasons (
          code, name, created_by, updated_by
        ) values (
          master_candidate.normalized_code,
          btrim(approval ->> 'approvedName'),
          actor_id, actor_id
        );
      end if;
      master_inserted_count := master_inserted_count + 1;
    else
      raise exception using
        errcode = '22023',
        message = 'upload_candidate_has_errors';
    end if;

    update public.upload_master_candidates
    set approved_data = coalesce(
          approval,
          jsonb_build_object(
            'key', master_candidate.candidate_key,
            'approved', true,
            'approvedName', coalesce(
              existing_name,
              master_candidate.proposed_data ->> 'proposedName'
            )
          )
        ),
        updated_at = now(),
        updated_by = actor_id,
        version = version + 1
    where id = master_candidate.id;
  end loop;

  for standard_time_candidate in
    select candidate.*
    from public.upload_standard_time_candidates as candidate
    where candidate.batch_id = p_batch_id
    order by candidate.candidate_key
    for update
  loop
    approval := null;
    if standard_time_candidate.status in ('new', 'conflict') then
      select item.value
      into approval
      from jsonb_array_elements(p_standard_time_approvals) as item(value)
      where item.value ->> 'key' =
        standard_time_candidate.candidate_key;
      if coalesce((approval ->> 'approved')::boolean, false) is not true then
        raise exception using
          errcode = '22023',
          message = 'candidate_not_approved';
      end if;
    end if;

    if standard_time_candidate.process_code
      not in ('SPI', 'AOI', 'XRAY', 'ICT', 'ROUTER') then
      raise exception using
        errcode = '22023',
        message = 'unsupported_process';
    end if;

    select model.id
    into resolved_model_id
    from public.models as model
    where model.code = standard_time_candidate.model_code
      and model.is_active
      and model.deleted_at is null;
    select line.id
    into resolved_line_id
    from public.lines as line
    where line.code = standard_time_candidate.line_code
      and line.is_active
      and line.deleted_at is null;
    select process.id
    into resolved_process_id
    from public.processes as process
    where process.code = standard_time_candidate.process_code
      and process.is_active
      and process.deleted_at is null;
    if resolved_model_id is null
      or resolved_line_id is null
      or resolved_process_id is null then
      raise exception using
        errcode = '22023',
        message = 'inactive_master_data';
    end if;

    has_explicit_standard_time :=
      approval ? 'approvedSecondsPerUnit'
      and jsonb_typeof(approval -> 'approvedSecondsPerUnit') = 'number';
    has_deviation_conflict := exists (
      select 1
      from jsonb_array_elements(
        standard_time_candidate.observations
      ) as observation(value)
      where abs(
        (observation.value ->> 'secondsPerUnit')::numeric
        - standard_time_candidate.median_seconds_per_unit
      ) / standard_time_candidate.median_seconds_per_unit > 0.05
    );
    if has_deviation_conflict and not has_explicit_standard_time then
      raise exception using
        errcode = '22023',
        message = 'standard_time_conflict_unresolved';
    end if;

    final_seconds := case
      when has_explicit_standard_time
        then (approval ->> 'approvedSecondsPerUnit')::numeric
      else standard_time_candidate.proposed_seconds_per_unit
    end;
    final_from := coalesce(
      nullif(approval ->> 'effectiveFrom', '')::date,
      standard_time_candidate.effective_from
    );
    final_to := coalesce(
      nullif(approval ->> 'effectiveTo', '')::date,
      standard_time_candidate.effective_to
    );

    if final_seconds is null
      or final_seconds::text = 'NaN'
      or final_seconds <= 0
      or final_from is null
      or (final_to is not null and final_to < final_from) then
      raise exception using
        errcode = '22023',
        message = 'invalid_standard_time';
    end if;

    if standard_time_candidate.status = 'existing' then
      if not exists (
        select 1
        from public.standard_times as standard_time
        where standard_time.model_id = resolved_model_id
          and standard_time.line_id = resolved_line_id
          and standard_time.process_id = resolved_process_id
          and standard_time.seconds_per_unit = final_seconds
          and standard_time.effective_from = final_from
          and standard_time.effective_to is not distinct from final_to
          and standard_time.deleted_at is null
      ) then
        raise exception using
          errcode = '22023',
          message = 'staged_standard_time_changed';
      end if;
    elsif standard_time_candidate.status in ('new', 'conflict') then
      if exists (
        select 1
        from public.standard_times as standard_time
        where standard_time.model_id = resolved_model_id
          and standard_time.line_id = resolved_line_id
          and standard_time.process_id = resolved_process_id
          and standard_time.deleted_at is null
          and standard_time.effective_from
            <= coalesce(final_to, 'infinity'::date)
          and final_from
            <= coalesce(standard_time.effective_to, 'infinity'::date)
      ) then
        raise exception using
          errcode = '22023',
          message = 'standard_time_overlap';
      end if;
      insert into public.standard_times (
        model_id, line_id, process_id, seconds_per_unit,
        effective_from, effective_to, created_by, updated_by
      ) values (
        resolved_model_id, resolved_line_id, resolved_process_id,
        final_seconds, final_from, final_to, actor_id, actor_id
      );
      standard_time_inserted_count :=
        standard_time_inserted_count + 1;
    else
      raise exception using
        errcode = '22023',
        message = 'upload_candidate_has_errors';
    end if;

    update public.upload_standard_time_candidates
    set approved_seconds_per_unit = final_seconds,
        approved_effective_from = final_from,
        approved_effective_to = final_to,
        updated_at = now(),
        updated_by = actor_id,
        version = version + 1
    where id = standard_time_candidate.id;
  end loop;

  select
    count(*) filter (where detail.status = 'new'),
    count(*) filter (where detail.status = 'conflict'),
    count(*) filter (where detail.status = 'error')
  into staged_new_count, staged_conflict_count, staged_error_count
  from public.upload_rows as detail
  where detail.batch_id = p_batch_id
    and detail.deleted_at is null;

  if staged_error_count > 0 then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  for staged_row in
    select detail.*
    from public.upload_rows as detail
    where detail.batch_id = p_batch_id
      and detail.deleted_at is null
    order by detail.source_sheet, detail.source_row, detail.id
    for update
  loop
    if staged_row.status not in ('new', 'conflict') then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;

    select *
    into validated
    from private.validate_upload_v2_payload(
      staged_row.payload,
      staged_row.source_sheet,
      staged_row.source_row
    );
    if staged_row.row_kind is distinct from
      validated.validated_row_kind then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;

    if validated.validated_time_slot_id is not null then
      select extract(
        epoch from (
          date '2000-01-01'
          + slot.ends_at
          + slot.end_day_offset * interval '1 day'
          - (date '2000-01-01' + slot.starts_at)
        )
      )
      into exact_slot_seconds
      from public.time_slots as slot
      where slot.id = validated.validated_time_slot_id
        and slot.shift_id = validated.validated_shift_id
        and slot.is_active
        and slot.deleted_at is null;
      if exact_slot_seconds is null
        or validated.validated_downtime_minutes * 60
          > exact_slot_seconds then
        raise exception using
          errcode = '22023',
          message = 'downtime_exceeds_planned_time';
      end if;
    end if;

    if staged_row.status = 'conflict' and not allow_replacement then
      update public.upload_rows
      set status = 'skipped',
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where id = staged_row.id;
      skipped_count := skipped_count + 1;
      continue;
    end if;

    quality_id := null;
    first_defect_id := null;

    if validated.validated_quality_input is not null then
      perform pg_advisory_xact_lock(
        hashtextextended(
          concat_ws(
            '|',
            'quality',
            validated.validated_production_date,
            validated.validated_shift_id,
            validated.validated_time_slot_id,
            validated.validated_line_id,
            validated.validated_model_id,
            validated.validated_process_id
          ),
          0
        )
      );

      if validated.validated_row_kind = 'production'
        and exists (
          select 1
          from public.quality_records as quality_collision
          where quality_collision.production_date =
              validated.validated_production_date
            and quality_collision.shift_id =
              validated.validated_shift_id
            and quality_collision.time_slot_id =
              validated.validated_time_slot_id
            and quality_collision.line_id =
              validated.validated_line_id
            and quality_collision.model_id =
              validated.validated_model_id
            and quality_collision.process_id =
              validated.validated_process_id
            and quality_collision.deleted_at is null
            and (
              staged_row.target_record_id is null
              or quality_collision.production_record_id is distinct from
                staged_row.target_record_id
            )
        ) then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_conflicts';
      elsif validated.validated_row_kind = 'daily_quality'
        and staged_row.status = 'new'
        and exists (
          select 1
          from public.quality_records as quality_collision
          where quality_collision.production_date =
              validated.validated_production_date
            and quality_collision.shift_id =
              validated.validated_shift_id
            and quality_collision.time_slot_id is not distinct from
              validated.validated_time_slot_id
            and quality_collision.line_id =
              validated.validated_line_id
            and quality_collision.model_id =
              validated.validated_model_id
            and quality_collision.process_id =
              validated.validated_process_id
            and quality_collision.deleted_at is null
        ) then
        raise exception using
          errcode = '22023',
          message = 'upload_target_metadata_required';
      end if;
    end if;

    if validated.validated_row_kind = 'production' then
      perform pg_advisory_xact_lock(
        hashtextextended(
          concat_ws(
            '|',
            'production',
            validated.validated_production_date,
            validated.validated_shift_id,
            validated.validated_time_slot_id,
            validated.validated_line_id,
            validated.validated_model_id,
            validated.validated_process_id
          ),
          0
        )
      );

      if staged_row.status = 'conflict' then
        select target.*
        into production_target
        from public.production_records as target
        where target.id = staged_row.target_record_id
          and target.version = staged_row.expected_target_version
          and target.production_date =
            validated.validated_production_date
          and target.shift_id = validated.validated_shift_id
          and target.time_slot_id =
            validated.validated_time_slot_id
          and target.line_id = validated.validated_line_id
          and target.model_id = validated.validated_model_id
          and target.process_id = validated.validated_process_id
          and target.deleted_at is null
        for update;
        if not found then
          raise exception using
            errcode = '40001',
            message = 'stale_upload_target';
        end if;

        update public.production_records
        set input_qty = validated.validated_production_input,
            actual_qty = validated.validated_actual_qty,
            note = validated.validated_note,
            updated_at = now(),
            updated_by = actor_id,
            version = version + 1
        where id = production_target.id;

        update public.quality_records
        set deleted_at = now(),
            deleted_by = actor_id,
            updated_at = now(),
            updated_by = actor_id,
            version = version + 1
        where production_record_id = production_target.id
          and deleted_at is null;

        update public.downtime_records
        set deleted_at = now(),
            deleted_by = actor_id,
            updated_at = now(),
            updated_by = actor_id,
            version = version + 1
        where production_record_id = production_target.id
          and deleted_at is null;

        replaced_count := replaced_count + 1;
      else
        select target.*
        into production_target
        from public.production_records as target
        where target.production_date =
            validated.validated_production_date
          and target.shift_id = validated.validated_shift_id
          and target.time_slot_id =
            validated.validated_time_slot_id
          and target.line_id = validated.validated_line_id
          and target.model_id = validated.validated_model_id
          and target.process_id = validated.validated_process_id
          and target.deleted_at is null
        for update;
        if found then
          raise exception using
            errcode = '22023',
            message = 'upload_target_metadata_required';
        end if;

        insert into public.production_records (
          production_date, shift_id, time_slot_id, line_id, model_id,
          process_id, input_qty, actual_qty, note, created_by, updated_by
        )
        values (
          validated.validated_production_date,
          validated.validated_shift_id,
          validated.validated_time_slot_id,
          validated.validated_line_id,
          validated.validated_model_id,
          validated.validated_process_id,
          validated.validated_production_input,
          validated.validated_actual_qty,
          validated.validated_note,
          actor_id, actor_id
        )
        returning * into production_target;
        inserted_count := inserted_count + 1;
      end if;

      if validated.validated_quality_input is not null then
        insert into public.quality_records (
          production_record_id, production_date, shift_id, time_slot_id,
          line_id, model_id, process_id, input_qty, ok_qty, ng_qty, note,
          source_upload_row_id, created_by, updated_by
        )
        values (
          production_target.id,
          validated.validated_production_date,
          validated.validated_shift_id,
          validated.validated_time_slot_id,
          validated.validated_line_id,
          validated.validated_model_id,
          validated.validated_process_id,
          validated.validated_quality_input,
          validated.validated_ok_qty,
          validated.validated_ng_qty,
          validated.validated_note,
          staged_row.id,
          actor_id, actor_id
        )
        returning id into quality_id;
        quality_inserted_count := quality_inserted_count + 1;
      end if;

      if validated.validated_downtime_minutes > 0 then
        insert into public.downtime_records (
          production_record_id, reason_id, minutes, note,
          created_by, updated_by
        )
        values (
          production_target.id,
          validated.validated_reason_id,
          validated.validated_downtime_minutes,
          validated.validated_note,
          actor_id, actor_id
        );
      end if;
    else
      perform pg_advisory_xact_lock(
        hashtextextended(
          concat_ws(
            '|',
            'daily-quality',
            validated.validated_production_date,
            validated.validated_shift_id,
            validated.validated_time_slot_id,
            validated.validated_line_id,
            validated.validated_model_id,
            validated.validated_process_id
          ),
          0
        )
      );

      if staged_row.status = 'conflict' then
        select target.*
        into quality_target
        from public.quality_records as target
        where target.id = staged_row.target_record_id
          and target.version = staged_row.expected_target_version
          and target.production_record_id is null
          and target.time_slot_id is not distinct from
            validated.validated_time_slot_id
          and target.production_date =
            validated.validated_production_date
          and target.shift_id = validated.validated_shift_id
          and target.line_id = validated.validated_line_id
          and target.model_id = validated.validated_model_id
          and target.process_id = validated.validated_process_id
          and target.deleted_at is null
        for update;
        if not found then
          raise exception using
            errcode = '40001',
            message = 'stale_upload_target';
        end if;

        update public.defect_records
        set deleted_at = now(),
            deleted_by = actor_id,
            updated_at = now(),
            updated_by = actor_id,
            version = version + 1
        where quality_record_id = quality_target.id
          and deleted_at is null;

        update public.quality_records
        set input_qty = validated.validated_quality_input,
            ok_qty = validated.validated_ok_qty,
            ng_qty = validated.validated_ng_qty,
            note = validated.validated_note,
            source_upload_row_id = staged_row.id,
            updated_at = now(),
            updated_by = actor_id,
            version = version + 1
        where id = quality_target.id
        returning id into quality_id;
        quality_replaced_count := quality_replaced_count + 1;
        replaced_count := replaced_count + 1;
      else
        select target.*
        into quality_target
        from public.quality_records as target
        where target.production_record_id is null
          and target.time_slot_id is not distinct from
            validated.validated_time_slot_id
          and target.production_date =
            validated.validated_production_date
          and target.shift_id = validated.validated_shift_id
          and target.line_id = validated.validated_line_id
          and target.model_id = validated.validated_model_id
          and target.process_id = validated.validated_process_id
          and target.deleted_at is null
        for update;
        if found then
          raise exception using
            errcode = '22023',
            message = 'upload_target_metadata_required';
        end if;

        insert into public.quality_records (
          production_record_id, production_date, shift_id, time_slot_id,
          line_id, model_id, process_id, input_qty, ok_qty, ng_qty, note,
          source_upload_row_id, created_by, updated_by
        )
        values (
          null,
          validated.validated_production_date,
          validated.validated_shift_id,
          validated.validated_time_slot_id,
          validated.validated_line_id,
          validated.validated_model_id,
          validated.validated_process_id,
          validated.validated_quality_input,
          validated.validated_ok_qty,
          validated.validated_ng_qty,
          validated.validated_note,
          staged_row.id,
          actor_id, actor_id
        )
        returning id into quality_id;
        quality_inserted_count := quality_inserted_count + 1;
        inserted_count := inserted_count + 1;
      end if;
    end if;

    for defect_payload in
      select item.value
      from jsonb_array_elements(
        staged_row.payload -> 'defects'
      ) as item(value)
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(
          concat_ws(
            '|',
            'defect',
            quality_id,
            lower(btrim(defect_payload ->> 'defectType')),
            defect_payload ->> 'classification'
          ),
          0
        )
      );
      if exists (
        select 1
        from public.defect_records as existing_defect
        where existing_defect.quality_record_id = quality_id
          and lower(btrim(existing_defect.defect_type)) =
            lower(btrim(defect_payload ->> 'defectType'))
          and existing_defect.classification =
            defect_payload ->> 'classification'
          and existing_defect.deleted_at is null
      ) then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_conflicts';
      end if;

      insert into public.defect_records (
        quality_record_id, defect_type, classification, quantity,
        note, source_upload_row_id, created_by, updated_by
      )
      values (
        quality_id,
        btrim(defect_payload ->> 'defectType'),
        defect_payload ->> 'classification',
        (defect_payload ->> 'quantity')::integer,
        '',
        staged_row.id,
        actor_id, actor_id
      )
      returning id into defect_id;
      first_defect_id := coalesce(first_defect_id, defect_id);
      defect_inserted_count := defect_inserted_count + 1;
    end loop;

    update public.upload_rows
    set status = 'committed',
        production_record_id = case
          when validated.validated_row_kind = 'production'
            then production_target.id
          else null
        end,
        quality_record_id = quality_id,
        defect_record_id = first_defect_id,
        updated_at = now(),
        updated_by = actor_id,
        version = version + 1
    where id = staged_row.id;
  end loop;

  result_value := jsonb_build_object(
    'batchId', batch.id,
    'batch_id', batch.id,
    'status', 'completed',
    'insertedCount', inserted_count,
    'inserted', inserted_count,
    'replacedCount', replaced_count,
    'replaced', replaced_count,
    'skippedCount', skipped_count,
    'skipped', skipped_count,
    'masterInsertedCount', master_inserted_count,
    'standardTimeInsertedCount', standard_time_inserted_count,
    'qualityInsertedCount', quality_inserted_count,
    'qualityReplacedCount', quality_replaced_count,
    'defectInsertedCount', defect_inserted_count,
    'newCount', staged_new_count,
    'conflictCount', staged_conflict_count,
    'errorCount', staged_error_count
  );

  update public.upload_batches
  set status = 'completed',
      approved_by = actor_id,
      approved_at = now(),
      duplicate_policy = case
        when allow_replacement then 'replace'
        else 'skip'
      end,
      commit_result = result_value,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where id = batch.id;

  perform set_config('app.commit_upload_mode', 'off', true);
  return result_value;
end
$$;

revoke all on function public.find_completed_upload_by_hash(text)
  from public, anon, authenticated;
revoke all on function public.stage_upload_candidates(uuid, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.list_upload_detail_page(
  uuid, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.commit_upload_batch_with_masters(
  uuid, boolean, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.find_completed_upload_by_hash(text)
  to authenticated;
grant execute on function public.stage_upload_candidates(
  uuid, jsonb, jsonb
) to authenticated;
grant execute on function public.list_upload_detail_page(
  uuid, integer, integer, text
) to authenticated;
grant execute on function public.commit_upload_batch_with_masters(
  uuid, boolean, jsonb, jsonb
) to authenticated;
