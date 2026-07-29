drop index if exists public.defect_records_source_upload_row_unique;
create index defect_records_source_upload_row_idx
  on public.defect_records (source_upload_row_id)
  where source_upload_row_id is not null;

drop trigger if exists upload_rows_guard on public.upload_rows;

alter table public.upload_rows
  alter column row_kind drop default;
alter table public.upload_rows
  alter column row_kind set not null;
update public.upload_rows
set row_kind = 'diagnostic',
    status = case
      when status in ('new', 'conflict') then 'error'
      else status
    end,
    messages = coalesce(messages, '[]'::jsonb) || jsonb_build_array(
      'Legacy defect staging row retained as nested-defect provenance'
    )
where row_kind = 'defect';
alter table public.upload_rows
  drop constraint if exists upload_rows_row_kind_check;
alter table public.upload_rows
  add constraint upload_rows_row_kind_check
  check (row_kind in ('production', 'daily_quality', 'diagnostic'));

drop index if exists public.quality_records_unlinked_slot_unique;
create unique index quality_records_active_slot_unique
  on public.quality_records (
    production_date,
    shift_id,
    time_slot_id,
    line_id,
    model_id,
    process_id
  )
  where time_slot_id is not null
    and deleted_at is null;

create or replace function private.validate_upload_v2_payload(
  p_payload jsonb,
  p_source_sheet text,
  p_source_row integer
)
returns table (
  validated_row_kind text,
  validated_production_date date,
  validated_shift_id uuid,
  validated_time_slot_id uuid,
  validated_line_id uuid,
  validated_model_id uuid,
  validated_process_id uuid,
  validated_slot_minutes integer,
  validated_production_input integer,
  validated_actual_qty integer,
  validated_quality_input integer,
  validated_ok_qty integer,
  validated_ng_qty integer,
  validated_downtime_minutes integer,
  validated_reason_id uuid,
  validated_note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expected_root_keys text[] := array[
    'contractVersion',
    'defects',
    'downtime',
    'lineCode',
    'modelCode',
    'note',
    'processCode',
    'production',
    'productionDate',
    'quality',
    'shiftCode',
    'sourceTrace',
    'timeSlotCode',
    'warnings'
  ];
  expected_trace_keys text[] := array['row', 'sheet'];
  expected_production_keys text[] := array['actualQty', 'inputQty'];
  expected_quality_keys text[] := array['inputQty', 'ngQty', 'okQty'];
  expected_downtime_keys text[] := array['minutes', 'reasonCode'];
  expected_defect_keys text[] := array[
    'classification',
    'defectType',
    'productionSourceRow',
    'quantity',
    'sourceRow',
    'sourceSheet'
  ];
  actual_keys text[];
  production_payload jsonb;
  quality_payload jsonb;
  downtime_payload jsonb;
  defect_payload jsonb;
  warning_payload jsonb;
  trace_row integer;
  contract_version integer;
  defect_source_row integer;
  defect_parent_row integer;
  defect_quantity integer;
  defect_quantity_total integer := 0;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  select array_agg(payload_key order by payload_key)
  into actual_keys
  from jsonb_object_keys(p_payload) as payload_key;

  if actual_keys is distinct from expected_root_keys
    or jsonb_typeof(p_payload -> 'contractVersion') <> 'number'
    or jsonb_typeof(p_payload -> 'sourceTrace') <> 'object'
    or jsonb_typeof(p_payload -> 'defects') <> 'array'
    or jsonb_typeof(p_payload -> 'warnings') <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  select array_agg(trace_key order by trace_key)
  into actual_keys
  from jsonb_object_keys(p_payload -> 'sourceTrace') as trace_key;

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

  if actual_keys is distinct from expected_trace_keys
    or contract_version is distinct from 2
    or p_payload #>> '{sourceTrace,sheet}' is distinct from p_source_sheet
    or trace_row is distinct from p_source_row
    or validated_production_date is null
    or nullif(p_payload ->> 'shiftCode', '') is null
    or nullif(p_payload ->> 'lineCode', '') is null
    or nullif(p_payload ->> 'modelCode', '') is null
    or nullif(p_payload ->> 'processCode', '') is null
    or jsonb_typeof(p_payload -> 'note') <> 'string'
    or length(p_payload ->> 'note') > 1000 then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  validated_note := p_payload ->> 'note';
  production_payload := p_payload -> 'production';
  quality_payload := p_payload -> 'quality';
  downtime_payload := p_payload -> 'downtime';

  if jsonb_typeof(production_payload) = 'null' then
    production_payload := null;
    validated_row_kind := 'daily_quality';
    validated_production_input := null;
    validated_actual_qty := null;
  elsif jsonb_typeof(production_payload) = 'object' then
    validated_row_kind := 'production';
    select array_agg(production_key order by production_key)
    into actual_keys
    from jsonb_object_keys(production_payload) as production_key;

    begin
      validated_production_input :=
        (production_payload ->> 'inputQty')::integer;
      validated_actual_qty :=
        (production_payload ->> 'actualQty')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;

    if actual_keys is distinct from expected_production_keys
      or validated_production_input is null
      or validated_actual_qty is null
      or validated_production_input < 0
      or validated_actual_qty < 0 then
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
    validated_quality_input := null;
    validated_ok_qty := null;
    validated_ng_qty := null;
  elsif jsonb_typeof(quality_payload) = 'object' then
    select array_agg(quality_key order by quality_key)
    into actual_keys
    from jsonb_object_keys(quality_payload) as quality_key;

    begin
      validated_quality_input := (quality_payload ->> 'inputQty')::integer;
      validated_ok_qty := (quality_payload ->> 'okQty')::integer;
      validated_ng_qty := (quality_payload ->> 'ngQty')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;

    if actual_keys is distinct from expected_quality_keys
      or validated_quality_input is null
      or validated_ok_qty is null
      or validated_ng_qty is null
      or validated_quality_input < 0
      or validated_ok_qty < 0
      or validated_ng_qty < 0
      or validated_ok_qty > validated_quality_input
      or validated_ok_qty + validated_ng_qty > validated_quality_input then
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

  if validated_row_kind = 'production'
    and quality_payload is not null
    and validated_quality_input is distinct from validated_production_input then
    raise exception using
      errcode = '22023',
      message = 'invalid_linked_quality_input';
  end if;

  if validated_row_kind = 'daily_quality' then
    if quality_payload is null
      or p_payload ->> 'processCode' not in ('AOI', 'SPI', 'ICT', 'XRAY')
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

  select model_row.id
  into validated_model_id
  from public.models as model_row
  where model_row.code = p_payload ->> 'modelCode'
    and model_row.is_active
    and model_row.deleted_at is null;

  select line_row.id
  into validated_line_id
  from public.lines as line_row
  where line_row.code = p_payload ->> 'lineCode'
    and line_row.is_active
    and line_row.deleted_at is null;

  select process_row.id
  into validated_process_id
  from public.processes as process_row
  where process_row.code = p_payload ->> 'processCode'
    and process_row.is_active
    and process_row.deleted_at is null;

  select shift_row.id
  into validated_shift_id
  from public.shifts as shift_row
  where shift_row.code = p_payload ->> 'shiftCode'
    and shift_row.is_active
    and shift_row.deleted_at is null;

  if validated_model_id is null
    or validated_line_id is null
    or validated_process_id is null
    or validated_shift_id is null then
    raise exception using
      errcode = '22023',
      message = 'inactive_master_data';
  end if;

  if validated_row_kind = 'production'
    or nullif(p_payload ->> 'timeSlotCode', '') is not null then
    select
      slot_row.id,
      (
        extract(
          epoch from (
            slot_row.ends_at
            - slot_row.starts_at
            + slot_row.end_day_offset * interval '1 day'
          )
        ) / 60
      )::integer
    into validated_time_slot_id, validated_slot_minutes
    from public.time_slots as slot_row
    where slot_row.shift_id = validated_shift_id
      and slot_row.code = p_payload ->> 'timeSlotCode'
      and slot_row.is_active
      and slot_row.deleted_at is null;

    if validated_time_slot_id is null
      or validated_slot_minutes is null
      or validated_slot_minutes <= 0 then
      raise exception using
        errcode = '22023',
        message = 'inactive_master_data';
    end if;
  else
    validated_time_slot_id := null;
    validated_slot_minutes := null;
  end if;

  if jsonb_typeof(downtime_payload) = 'null' then
    validated_downtime_minutes := 0;
    validated_reason_id := null;
  elsif validated_row_kind = 'production'
    and jsonb_typeof(downtime_payload) = 'object' then
    select array_agg(downtime_key order by downtime_key)
    into actual_keys
    from jsonb_object_keys(downtime_payload) as downtime_key;

    begin
      validated_downtime_minutes :=
        (downtime_payload ->> 'minutes')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;

    select reason_row.id
    into validated_reason_id
    from public.downtime_reasons as reason_row
    where reason_row.code = downtime_payload ->> 'reasonCode'
      and reason_row.is_active
      and reason_row.deleted_at is null;

    if actual_keys is distinct from expected_downtime_keys
      or validated_downtime_minutes is null
      or validated_downtime_minutes <= 0
      or validated_reason_id is null then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  if validated_downtime_minutes
    > coalesce(validated_slot_minutes, 0) then
    raise exception using
      errcode = '22023',
      message = 'downtime_exceeds_planned_time';
  end if;

  for warning_payload in
    select warning_item.value
    from jsonb_array_elements(p_payload -> 'warnings')
      as warning_item(value)
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
    select defect_item.value
    from jsonb_array_elements(p_payload -> 'defects')
      as defect_item(value)
  loop
    if jsonb_typeof(defect_payload) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'invalid_defect_payload';
    end if;

    select array_agg(defect_key order by defect_key)
    into actual_keys
    from jsonb_object_keys(defect_payload) as defect_key;

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
      or actual_keys is distinct from expected_defect_keys
      or defect_payload ->> 'sourceSheet' <> 'Defects'
      or defect_source_row is null
      or defect_source_row <= 0
      or defect_parent_row is distinct from p_source_row
      or nullif(btrim(defect_payload ->> 'defectType'), '') is null
      or length(btrim(defect_payload ->> 'defectType')) > 200
      or btrim(defect_payload ->> 'defectType') ~ '^[=+@-]'
      or defect_payload ->> 'classification'
        not in ('pseudo', 'real', 'scrap')
      or defect_quantity is null
      or defect_quantity <= 0 then
      raise exception using
        errcode = '22023',
        message = 'invalid_defect_payload';
    end if;

    defect_quantity_total := defect_quantity_total + defect_quantity;
  end loop;

  if defect_quantity_total > validated_ng_qty then
    raise exception using
      errcode = '22023',
      message = 'invalid_defect_payload';
  end if;

  if exists (
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
      message = 'duplicate_defect_row';
  end if;

  return next;
end
$$;

revoke all on function private.validate_upload_v2_payload(jsonb, text, integer)
  from public, anon, authenticated;

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
  app_role text := public.current_app_role();
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
    or app_role not in ('operator', 'admin')
    or new.status not in ('new', 'conflict', 'error')
    or new.production_record_id is not null
    or new.quality_record_id is not null
    or new.defect_record_id is not null
    or new.parent_upload_row_id is not null
    or new.deleted_at is not null
    or not exists (
      select 1
      from public.upload_batches as batch_row
      where batch_row.id = new.batch_id
        and batch_row.deleted_at is null
        and batch_row.status in ('staged', 'validated')
        and (
          batch_row.created_by = actor_id
          or app_role = 'admin'
        )
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
  from private.validate_upload_v2_payload(
    new.payload,
    new.source_sheet,
    new.source_row
  );

  if new.row_kind is distinct from validated.validated_row_kind then
    raise exception using
      errcode = '22023',
      message = 'invalid_upload_row_kind';
  end if;

  if app_role = 'operator'
    and validated.validated_production_date
      <> (now() at time zone 'Asia/Bangkok')::date then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  if validated.validated_row_kind = 'production' then
    if validated.validated_quality_input is not null
      and exists (
        select 1
        from public.quality_records as quality_row
        where quality_row.production_date =
            validated.validated_production_date
          and quality_row.shift_id = validated.validated_shift_id
          and quality_row.time_slot_id =
            validated.validated_time_slot_id
          and quality_row.line_id = validated.validated_line_id
          and quality_row.model_id = validated.validated_model_id
          and quality_row.process_id = validated.validated_process_id
          and quality_row.deleted_at is null
          and (
            new.target_record_id is null
            or quality_row.production_record_id is distinct from
              new.target_record_id
          )
      ) then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_conflicts';
    end if;

    if new.status = 'conflict' and not exists (
      select 1
      from public.production_records as production_row
      where production_row.id = new.target_record_id
        and production_row.version = new.expected_target_version
        and production_row.production_date =
          validated.validated_production_date
        and production_row.shift_id = validated.validated_shift_id
        and production_row.time_slot_id =
          validated.validated_time_slot_id
        and production_row.line_id = validated.validated_line_id
        and production_row.model_id = validated.validated_model_id
        and production_row.process_id = validated.validated_process_id
        and production_row.deleted_at is null
    ) then
      raise exception using
        errcode = '40001',
        message = 'stale_upload_target';
    elsif new.status = 'new' and exists (
      select 1
      from public.production_records as production_row
      where production_row.production_date =
          validated.validated_production_date
        and production_row.shift_id = validated.validated_shift_id
        and production_row.time_slot_id =
          validated.validated_time_slot_id
        and production_row.line_id = validated.validated_line_id
        and production_row.model_id = validated.validated_model_id
        and production_row.process_id = validated.validated_process_id
        and production_row.deleted_at is null
    ) then
      raise exception using
        errcode = '22023',
        message = 'upload_target_metadata_required';
    end if;
  else
    if new.status = 'new' and exists (
      select 1
      from public.quality_records as quality_row
      where quality_row.production_date =
          validated.validated_production_date
        and quality_row.shift_id = validated.validated_shift_id
        and quality_row.time_slot_id is not distinct from
          validated.validated_time_slot_id
        and quality_row.line_id = validated.validated_line_id
        and quality_row.model_id = validated.validated_model_id
        and quality_row.process_id = validated.validated_process_id
        and quality_row.deleted_at is null
    ) then
      raise exception using
        errcode = '22023',
        message = 'upload_target_metadata_required';
    end if;

    if new.status = 'conflict' and not exists (
      select 1
      from public.quality_records as quality_row
      where quality_row.id = new.target_record_id
        and quality_row.version = new.expected_target_version
        and quality_row.production_record_id is null
        and quality_row.time_slot_id is not distinct from
          validated.validated_time_slot_id
        and quality_row.production_date =
          validated.validated_production_date
        and quality_row.shift_id = validated.validated_shift_id
        and quality_row.line_id = validated.validated_line_id
        and quality_row.model_id = validated.validated_model_id
        and quality_row.process_id = validated.validated_process_id
        and quality_row.deleted_at is null
    ) then
      raise exception using
        errcode = '40001',
        message = 'stale_upload_target';
    elsif new.status = 'new' and exists (
      select 1
      from public.quality_records as quality_row
      where quality_row.production_record_id is null
        and quality_row.time_slot_id is not distinct from
          validated.validated_time_slot_id
        and quality_row.production_date =
          validated.validated_production_date
        and quality_row.shift_id = validated.validated_shift_id
        and quality_row.line_id = validated.validated_line_id
        and quality_row.model_id = validated.validated_model_id
        and quality_row.process_id = validated.validated_process_id
        and quality_row.deleted_at is null
    ) then
      raise exception using
        errcode = '22023',
        message = 'upload_target_metadata_required';
    end if;
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

drop function if exists public.commit_upload_batch(uuid, boolean);

create function public.commit_upload_batch(
  p_batch_id uuid,
  p_replace_conflicts boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  app_role text := public.current_app_role();
  allow_replacement boolean := coalesce(p_replace_conflicts, false);
  batch_row public.upload_batches%rowtype;
  staged_row public.upload_rows%rowtype;
  production_target public.production_records%rowtype;
  quality_target public.quality_records%rowtype;
  validated record;
  defect_payload jsonb;
  quality_id uuid;
  defect_id uuid;
  first_defect_id uuid;
  inserted_count integer := 0;
  replaced_count integer := 0;
  quality_inserted_count integer := 0;
  quality_replaced_count integer := 0;
  defect_inserted_count integer := 0;
  staged_new_count integer := 0;
  staged_conflict_count integer := 0;
  staged_error_count integer := 0;
begin
  if actor_id is null or app_role not in ('operator', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  perform set_config('app.commit_upload_mode', 'on', true);

  select batch_candidate.*
  into batch_row
  from public.upload_batches as batch_candidate
  where batch_candidate.id = p_batch_id
    and batch_candidate.deleted_at is null
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'upload_batch_not_found';
  end if;

  if app_role <> 'admin' and batch_row.created_by <> actor_id then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  if batch_row.status not in ('staged', 'validated') then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_not_committable';
  end if;

  select
    count(*) filter (where row_candidate.status = 'new'),
    count(*) filter (where row_candidate.status = 'conflict'),
    count(*) filter (where row_candidate.status = 'error')
  into staged_new_count, staged_conflict_count, staged_error_count
  from public.upload_rows as row_candidate
  where row_candidate.batch_id = p_batch_id
    and row_candidate.deleted_at is null;

  if staged_error_count > 0 then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  if staged_conflict_count > 0 and not allow_replacement then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_conflicts';
  end if;

  if allow_replacement and app_role <> 'admin' then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  for staged_row in
    select row_candidate.*
    from public.upload_rows as row_candidate
    where row_candidate.batch_id = p_batch_id
      and row_candidate.deleted_at is null
    order by row_candidate.source_sheet, row_candidate.source_row, row_candidate.id
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

    if staged_row.row_kind <> validated.validated_row_kind then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;

    if app_role = 'operator'
      and validated.validated_production_date
        <> (now() at time zone 'Asia/Bangkok')::date then
      raise exception using
        errcode = '42501',
        message = 'insufficient_privilege';
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
            and quality_collision.shift_id = validated.validated_shift_id
            and quality_collision.time_slot_id =
              validated.validated_time_slot_id
            and quality_collision.line_id = validated.validated_line_id
            and quality_collision.model_id = validated.validated_model_id
            and quality_collision.process_id = validated.validated_process_id
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
            and quality_collision.shift_id = validated.validated_shift_id
            and quality_collision.time_slot_id is not distinct from
              validated.validated_time_slot_id
            and quality_collision.line_id = validated.validated_line_id
            and quality_collision.model_id = validated.validated_model_id
            and quality_collision.process_id = validated.validated_process_id
            and quality_collision.deleted_at is null
        ) then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_conflicts';
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
        select target_candidate.*
        into production_target
        from public.production_records as target_candidate
        where target_candidate.id = staged_row.target_record_id
          and target_candidate.version =
            staged_row.expected_target_version
          and target_candidate.production_date =
            validated.validated_production_date
          and target_candidate.shift_id = validated.validated_shift_id
          and target_candidate.time_slot_id =
            validated.validated_time_slot_id
          and target_candidate.line_id = validated.validated_line_id
          and target_candidate.model_id = validated.validated_model_id
          and target_candidate.process_id = validated.validated_process_id
          and target_candidate.deleted_at is null
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
        select target_candidate.*
        into production_target
        from public.production_records as target_candidate
        where target_candidate.production_date =
            validated.validated_production_date
          and target_candidate.shift_id = validated.validated_shift_id
          and target_candidate.time_slot_id =
            validated.validated_time_slot_id
          and target_candidate.line_id = validated.validated_line_id
          and target_candidate.model_id = validated.validated_model_id
          and target_candidate.process_id = validated.validated_process_id
          and target_candidate.deleted_at is null
        for update;

        if found then
          raise exception using
            errcode = '22023',
            message = 'upload_batch_has_conflicts';
        end if;

        insert into public.production_records (
          production_date,
          shift_id,
          time_slot_id,
          line_id,
          model_id,
          process_id,
          input_qty,
          actual_qty,
          note,
          created_by,
          updated_by
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
          actor_id,
          actor_id
        )
        returning * into production_target;

        inserted_count := inserted_count + 1;
      end if;

      if validated.validated_quality_input is not null then
        insert into public.quality_records (
          production_record_id,
          production_date,
          shift_id,
          time_slot_id,
          line_id,
          model_id,
          process_id,
          input_qty,
          ok_qty,
          ng_qty,
          note,
          source_upload_row_id,
          created_by,
          updated_by
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
          actor_id,
          actor_id
        )
        returning id into quality_id;

        quality_inserted_count := quality_inserted_count + 1;
      end if;

      if validated.validated_downtime_minutes > 0 then
        insert into public.downtime_records (
          production_record_id,
          reason_id,
          minutes,
          note,
          created_by,
          updated_by
        )
        values (
          production_target.id,
          validated.validated_reason_id,
          validated.validated_downtime_minutes,
          validated.validated_note,
          actor_id,
          actor_id
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
        select target_candidate.*
        into quality_target
        from public.quality_records as target_candidate
        where target_candidate.id = staged_row.target_record_id
          and target_candidate.version =
            staged_row.expected_target_version
          and target_candidate.production_record_id is null
          and target_candidate.time_slot_id is not distinct from
            validated.validated_time_slot_id
          and target_candidate.production_date =
            validated.validated_production_date
          and target_candidate.shift_id = validated.validated_shift_id
          and target_candidate.line_id = validated.validated_line_id
          and target_candidate.model_id = validated.validated_model_id
          and target_candidate.process_id = validated.validated_process_id
          and target_candidate.deleted_at is null
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
        select target_candidate.*
        into quality_target
        from public.quality_records as target_candidate
        where target_candidate.production_record_id is null
          and target_candidate.time_slot_id is not distinct from
            validated.validated_time_slot_id
          and target_candidate.production_date =
            validated.validated_production_date
          and target_candidate.shift_id = validated.validated_shift_id
          and target_candidate.line_id = validated.validated_line_id
          and target_candidate.model_id = validated.validated_model_id
          and target_candidate.process_id = validated.validated_process_id
          and target_candidate.deleted_at is null
        for update;

        if found then
          raise exception using
            errcode = '22023',
            message = 'upload_batch_has_conflicts';
        end if;

        insert into public.quality_records (
          production_record_id,
          production_date,
          shift_id,
          time_slot_id,
          line_id,
          model_id,
          process_id,
          input_qty,
          ok_qty,
          ng_qty,
          note,
          source_upload_row_id,
          created_by,
          updated_by
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
          actor_id,
          actor_id
        )
        returning id into quality_id;

        quality_inserted_count := quality_inserted_count + 1;
        inserted_count := inserted_count + 1;
      end if;
    end if;

    for defect_payload in
      select defect_item.value
      from jsonb_array_elements(staged_row.payload -> 'defects')
        as defect_item(value)
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
        quality_record_id,
        defect_type,
        classification,
        quantity,
        note,
        source_upload_row_id,
        created_by,
        updated_by
      )
      values (
        quality_id,
        btrim(defect_payload ->> 'defectType'),
        defect_payload ->> 'classification',
        (defect_payload ->> 'quantity')::integer,
        '',
        staged_row.id,
        actor_id,
        actor_id
      )
      returning id into defect_id;

      first_defect_id := coalesce(first_defect_id, defect_id);
      defect_inserted_count := defect_inserted_count + 1;
    end loop;

    update public.upload_rows
    set production_record_id = case
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

  update public.upload_batches
  set status = 'committed',
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where id = batch_row.id;

  perform set_config('app.commit_upload_mode', 'off', true);

  return jsonb_build_object(
    'batch_id', batch_row.id,
    'status', 'committed',
    'inserted', inserted_count,
    'replaced', replaced_count,
    'qualityInserted', quality_inserted_count,
    'qualityReplaced', quality_replaced_count,
    'defectInserted', defect_inserted_count,
    'newCount', staged_new_count,
    'conflictCount', staged_conflict_count,
    'errorCount', staged_error_count
  );
end
$$;

revoke all on function public.commit_upload_batch(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.commit_upload_batch(uuid, boolean)
  to authenticated;
