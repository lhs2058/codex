create or replace function private.resolve_upload_dimensions(
  p_payload jsonb,
  p_require_time_slot boolean
)
returns table (
  resolved_model_id uuid,
  resolved_line_id uuid,
  resolved_process_id uuid,
  resolved_shift_id uuid,
  resolved_time_slot_id uuid,
  resolved_slot_minutes integer,
  resolved_reason_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  downtime_minutes integer;
  reason_code text;
begin
  select model_row.id
  into resolved_model_id
  from public.models as model_row
  where model_row.code = p_payload ->> 'modelCode'
    and model_row.is_active
    and model_row.deleted_at is null;

  select line_row.id
  into resolved_line_id
  from public.lines as line_row
  where line_row.code = p_payload ->> 'lineCode'
    and line_row.is_active
    and line_row.deleted_at is null;

  select process_row.id
  into resolved_process_id
  from public.processes as process_row
  where process_row.code = p_payload ->> 'processCode'
    and process_row.is_active
    and process_row.deleted_at is null;

  select shift_row.id
  into resolved_shift_id
  from public.shifts as shift_row
  where shift_row.code = p_payload ->> 'shiftCode'
    and shift_row.is_active
    and shift_row.deleted_at is null;

  if resolved_model_id is null
    or resolved_line_id is null
    or resolved_process_id is null
    or resolved_shift_id is null then
    raise exception using
      errcode = '22023',
      message = 'inactive_master_data';
  end if;

  if p_require_time_slot then
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
    into resolved_time_slot_id, resolved_slot_minutes
    from public.time_slots as slot_row
    where slot_row.shift_id = resolved_shift_id
      and slot_row.code = p_payload ->> 'timeSlotCode'
      and slot_row.is_active
      and slot_row.deleted_at is null;

    if resolved_time_slot_id is null
      or resolved_slot_minutes is null
      or resolved_slot_minutes <= 0 then
      raise exception using
        errcode = '22023',
        message = 'inactive_master_data';
    end if;
  else
    resolved_time_slot_id := null;
    resolved_slot_minutes := null;
  end if;

  begin
    downtime_minutes := (p_payload ->> 'downtimeMinutes')::integer;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
  end;

  reason_code := p_payload ->> 'downtimeReasonCode';
  if downtime_minutes > 0 then
    select reason_row.id
    into resolved_reason_id
    from public.downtime_reasons as reason_row
    where reason_row.code = reason_code
      and reason_row.is_active
      and reason_row.deleted_at is null;

    if resolved_reason_id is null then
      raise exception using
        errcode = '22023',
        message = 'inactive_master_data';
    end if;
  elsif reason_code is not null then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  else
    resolved_reason_id := null;
  end if;

  return next;
end
$$;

revoke all on function private.resolve_upload_dimensions(jsonb, boolean)
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
  expected_observation_keys text[] := array[
    'actualQty',
    'downtimeMinutes',
    'downtimeReasonCode',
    'inputQty',
    'lineCode',
    'modelCode',
    'ngQty',
    'note',
    'okQty',
    'processCode',
    'productionDate',
    'shiftCode',
    'sourceRow',
    'sourceSheet',
    'timeSlotCode'
  ];
  expected_defect_keys text[] := array[
    'classification',
    'defectType',
    'note',
    'parentSourceRow',
    'parentSourceSheet',
    'quantity',
    'sourceRow',
    'sourceSheet'
  ];
  actual_keys text[];
  dimensions record;
  parent_row public.upload_rows%rowtype;
  production_day date;
  source_row_value integer;
  parent_source_row integer;
  input_value integer;
  actual_value integer;
  ok_value integer;
  ng_value integer;
  downtime_value integer;
  defect_quantity integer;
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

  -- Diagnostic rows are deliberately non-committable and may retain the exact
  -- parser payload that produced their messages.
  if new.status = 'error' then
    new.parent_upload_row_id := null;
    return new;
  end if;

  if jsonb_typeof(new.payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  select array_agg(payload_key order by payload_key)
  into actual_keys
  from jsonb_object_keys(new.payload) as payload_key;

  begin
    source_row_value := (new.payload ->> 'sourceRow')::integer;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
  end;

  if new.payload ->> 'sourceSheet' is distinct from new.source_sheet
    or source_row_value is distinct from new.source_row then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_has_errors';
  end if;

  if new.row_kind in ('production', 'daily_quality') then
    if actual_keys is distinct from expected_observation_keys then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;

    begin
      production_day := (new.payload ->> 'productionDate')::date;
      input_value := (new.payload ->> 'inputQty')::integer;
      actual_value := (new.payload ->> 'actualQty')::integer;
      ok_value := (new.payload ->> 'okQty')::integer;
      ng_value := (new.payload ->> 'ngQty')::integer;
      downtime_value := (new.payload ->> 'downtimeMinutes')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;

    if production_day is null
      or nullif(new.payload ->> 'shiftCode', '') is null
      or nullif(new.payload ->> 'lineCode', '') is null
      or nullif(new.payload ->> 'modelCode', '') is null
      or nullif(new.payload ->> 'processCode', '') is null
      or input_value is null
      or actual_value is null
      or ok_value is null
      or ng_value is null
      or downtime_value is null
      or new.payload ->> 'note' is null
      or input_value < 0
      or actual_value < 0
      or ok_value < 0
      or ng_value < 0
      or ok_value > input_value
      or ok_value + ng_value > input_value
      or downtime_value < 0
      or length(new.payload ->> 'note') > 1000 then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;

    if app_role = 'operator'
      and production_day <> (now() at time zone 'Asia/Bangkok')::date then
      raise exception using
        errcode = '42501',
        message = 'insufficient_privilege';
    end if;

    if new.row_kind = 'production' then
      if nullif(new.payload ->> 'timeSlotCode', '') is null then
        raise exception using
          errcode = '22023',
          message = 'upload_row_requires_time_slot';
      end if;

      select *
      into dimensions
      from private.resolve_upload_dimensions(new.payload, true);

      if downtime_value > dimensions.resolved_slot_minutes then
        raise exception using
          errcode = '22023',
          message = 'downtime_exceeds_planned_time';
      end if;

      if new.status = 'conflict' then
        if not exists (
          select 1
          from public.production_records as production_row
          where production_row.id = new.target_record_id
            and production_row.version = new.expected_target_version
            and production_row.production_date = production_day
            and production_row.shift_id = dimensions.resolved_shift_id
            and production_row.time_slot_id = dimensions.resolved_time_slot_id
            and production_row.line_id = dimensions.resolved_line_id
            and production_row.model_id = dimensions.resolved_model_id
            and production_row.process_id = dimensions.resolved_process_id
            and production_row.deleted_at is null
        ) then
          raise exception using
            errcode = '40001',
            message = 'stale_upload_target';
        end if;
      elsif exists (
        select 1
        from public.production_records as production_row
        where production_row.production_date = production_day
          and production_row.shift_id = dimensions.resolved_shift_id
          and production_row.time_slot_id = dimensions.resolved_time_slot_id
          and production_row.line_id = dimensions.resolved_line_id
          and production_row.model_id = dimensions.resolved_model_id
          and production_row.process_id = dimensions.resolved_process_id
          and production_row.deleted_at is null
      ) then
        raise exception using
          errcode = '22023',
          message = 'upload_target_metadata_required';
      end if;
    else
      if new.payload ->> 'timeSlotCode' is not null
        or downtime_value <> 0
        or new.payload ->> 'downtimeReasonCode' is not null
        or new.payload ->> 'processCode' not in ('AOI', 'SPI', 'ICT', 'XRAY') then
        raise exception using
          errcode = '22023',
          message = 'invalid_daily_quality_payload';
      end if;

      select *
      into dimensions
      from private.resolve_upload_dimensions(new.payload, false);

      if new.status = 'conflict' then
        if not exists (
          select 1
          from public.quality_records as quality_row
          where quality_row.id = new.target_record_id
            and quality_row.version = new.expected_target_version
            and quality_row.production_record_id is null
            and quality_row.time_slot_id is null
            and quality_row.production_date = production_day
            and quality_row.shift_id = dimensions.resolved_shift_id
            and quality_row.line_id = dimensions.resolved_line_id
            and quality_row.model_id = dimensions.resolved_model_id
            and quality_row.process_id = dimensions.resolved_process_id
            and quality_row.deleted_at is null
        ) then
          raise exception using
            errcode = '40001',
            message = 'stale_upload_target';
        end if;
      elsif exists (
        select 1
        from public.quality_records as quality_row
        where quality_row.production_record_id is null
          and quality_row.time_slot_id is null
          and quality_row.production_date = production_day
          and quality_row.shift_id = dimensions.resolved_shift_id
          and quality_row.line_id = dimensions.resolved_line_id
          and quality_row.model_id = dimensions.resolved_model_id
          and quality_row.process_id = dimensions.resolved_process_id
          and quality_row.deleted_at is null
      ) then
        raise exception using
          errcode = '22023',
          message = 'upload_target_metadata_required';
      end if;
    end if;

    new.parent_upload_row_id := null;
    return new;
  end if;

  if new.row_kind <> 'defect'
    or actual_keys is distinct from expected_defect_keys
    or new.status <> 'new'
    or new.target_record_id is not null
    or new.expected_target_version is not null then
    raise exception using
      errcode = '22023',
      message = 'invalid_defect_payload';
  end if;

  begin
    parent_source_row := (new.payload ->> 'parentSourceRow')::integer;
    defect_quantity := (new.payload ->> 'quantity')::integer;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'invalid_defect_payload';
  end;

  if nullif(new.payload ->> 'parentSourceSheet', '') is null
    or nullif(new.payload ->> 'defectType', '') is null
    or new.payload ->> 'classification' not in ('pseudo', 'real', 'scrap')
    or defect_quantity is null
    or defect_quantity <= 0
    or new.payload ->> 'note' is null
    or length(new.payload ->> 'note') > 1000 then
    raise exception using
      errcode = '22023',
      message = 'invalid_defect_payload';
  end if;

  select parent_candidate.*
  into parent_row
  from public.upload_rows as parent_candidate
  where parent_candidate.batch_id = new.batch_id
    and parent_candidate.source_sheet = new.payload ->> 'parentSourceSheet'
    and parent_candidate.source_row = parent_source_row
    and parent_candidate.row_kind in ('production', 'daily_quality')
    and parent_candidate.status in ('new', 'conflict')
    and parent_candidate.deleted_at is null;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'invalid_defect_parent';
  end if;

  new.parent_upload_row_id := parent_row.id;

  if exists (
    select 1
    from public.upload_rows as duplicate_row
    where duplicate_row.batch_id = new.batch_id
      and duplicate_row.parent_upload_row_id = parent_row.id
      and duplicate_row.row_kind = 'defect'
      and duplicate_row.status <> 'error'
      and duplicate_row.payload ->> 'defectType' = new.payload ->> 'defectType'
      and duplicate_row.payload ->> 'classification' = new.payload ->> 'classification'
      and duplicate_row.deleted_at is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'duplicate_defect_row';
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
  parent_row public.upload_rows%rowtype;
  production_target public.production_records%rowtype;
  quality_target public.quality_records%rowtype;
  dimensions record;
  production_day date;
  input_value integer;
  actual_value integer;
  ok_value integer;
  ng_value integer;
  downtime_value integer;
  note_value text;
  inserted_count integer := 0;
  replaced_count integer := 0;
  quality_inserted_count integer := 0;
  quality_replaced_count integer := 0;
  defect_inserted_count integer := 0;
  staged_new_count integer := 0;
  staged_conflict_count integer := 0;
  staged_error_count integer := 0;
  quality_id uuid;
  defect_id uuid;
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
      and row_candidate.row_kind in ('production', 'daily_quality')
    order by row_candidate.source_sheet, row_candidate.source_row, row_candidate.id
    for update
  loop
    begin
      production_day := (staged_row.payload ->> 'productionDate')::date;
      input_value := (staged_row.payload ->> 'inputQty')::integer;
      actual_value := (staged_row.payload ->> 'actualQty')::integer;
      ok_value := (staged_row.payload ->> 'okQty')::integer;
      ng_value := (staged_row.payload ->> 'ngQty')::integer;
      downtime_value := (staged_row.payload ->> 'downtimeMinutes')::integer;
      note_value := staged_row.payload ->> 'note';
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'upload_batch_has_errors';
    end;

    if staged_row.status not in ('new', 'conflict')
      or production_day is null
      or input_value is null
      or actual_value is null
      or ok_value is null
      or ng_value is null
      or downtime_value is null
      or note_value is null
      or input_value < 0
      or actual_value < 0
      or ok_value < 0
      or ng_value < 0
      or ok_value > input_value
      or ok_value + ng_value > input_value
      or downtime_value < 0 then
      raise exception using
        errcode = '22023',
        message = 'upload_batch_has_errors';
    end if;

    if app_role = 'operator'
      and production_day <> (now() at time zone 'Asia/Bangkok')::date then
      raise exception using
        errcode = '42501',
        message = 'insufficient_privilege';
    end if;

    select *
    into dimensions
    from private.resolve_upload_dimensions(
      staged_row.payload,
      staged_row.row_kind = 'production'
    );

    if staged_row.row_kind = 'production' then
      if downtime_value > dimensions.resolved_slot_minutes then
        raise exception using
          errcode = '22023',
          message = 'downtime_exceeds_planned_time';
      end if;

      perform pg_advisory_xact_lock(
        hashtextextended(
          concat_ws(
            '|',
            'production',
            production_day,
            dimensions.resolved_shift_id,
            dimensions.resolved_time_slot_id,
            dimensions.resolved_line_id,
            dimensions.resolved_model_id,
            dimensions.resolved_process_id
          ),
          0
        )
      );

      if staged_row.status = 'conflict' then
        select target_candidate.*
        into production_target
        from public.production_records as target_candidate
        where target_candidate.id = staged_row.target_record_id
          and target_candidate.version = staged_row.expected_target_version
          and target_candidate.production_date = production_day
          and target_candidate.shift_id = dimensions.resolved_shift_id
          and target_candidate.time_slot_id = dimensions.resolved_time_slot_id
          and target_candidate.line_id = dimensions.resolved_line_id
          and target_candidate.model_id = dimensions.resolved_model_id
          and target_candidate.process_id = dimensions.resolved_process_id
          and target_candidate.deleted_at is null
        for update;

        if not found then
          raise exception using
            errcode = '40001',
            message = 'stale_upload_target';
        end if;

        update public.production_records
        set input_qty = input_value,
            actual_qty = actual_value,
            note = note_value,
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
        where target_candidate.production_date = production_day
          and target_candidate.shift_id = dimensions.resolved_shift_id
          and target_candidate.time_slot_id = dimensions.resolved_time_slot_id
          and target_candidate.line_id = dimensions.resolved_line_id
          and target_candidate.model_id = dimensions.resolved_model_id
          and target_candidate.process_id = dimensions.resolved_process_id
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
          production_day,
          dimensions.resolved_shift_id,
          dimensions.resolved_time_slot_id,
          dimensions.resolved_line_id,
          dimensions.resolved_model_id,
          dimensions.resolved_process_id,
          input_value,
          actual_value,
          note_value,
          actor_id,
          actor_id
        )
        returning * into production_target;

        inserted_count := inserted_count + 1;
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
        production_target.id,
        production_day,
        dimensions.resolved_shift_id,
        dimensions.resolved_time_slot_id,
        dimensions.resolved_line_id,
        dimensions.resolved_model_id,
        dimensions.resolved_process_id,
        input_value,
        ok_value,
        ng_value,
        note_value,
        staged_row.id,
        actor_id,
        actor_id
      )
      returning id into quality_id;

      quality_inserted_count := quality_inserted_count + 1;

      if downtime_value > 0 then
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
          dimensions.resolved_reason_id,
          downtime_value,
          note_value,
          actor_id,
          actor_id
        );
      end if;

      update public.upload_rows
      set production_record_id = production_target.id,
          quality_record_id = quality_id,
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where id = staged_row.id;
    else
      if staged_row.payload ->> 'timeSlotCode' is not null
        or downtime_value <> 0
        or staged_row.payload ->> 'downtimeReasonCode' is not null
        or staged_row.payload ->> 'processCode' not in ('AOI', 'SPI', 'ICT', 'XRAY') then
        raise exception using
          errcode = '22023',
          message = 'invalid_daily_quality_payload';
      end if;

      perform pg_advisory_xact_lock(
        hashtextextended(
          concat_ws(
            '|',
            'daily-quality',
            production_day,
            dimensions.resolved_shift_id,
            dimensions.resolved_line_id,
            dimensions.resolved_model_id,
            dimensions.resolved_process_id
          ),
          0
        )
      );

      if staged_row.status = 'conflict' then
        select target_candidate.*
        into quality_target
        from public.quality_records as target_candidate
        where target_candidate.id = staged_row.target_record_id
          and target_candidate.version = staged_row.expected_target_version
          and target_candidate.production_record_id is null
          and target_candidate.time_slot_id is null
          and target_candidate.production_date = production_day
          and target_candidate.shift_id = dimensions.resolved_shift_id
          and target_candidate.line_id = dimensions.resolved_line_id
          and target_candidate.model_id = dimensions.resolved_model_id
          and target_candidate.process_id = dimensions.resolved_process_id
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
        set input_qty = input_value,
            ok_qty = ok_value,
            ng_qty = ng_value,
            note = note_value,
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
          and target_candidate.time_slot_id is null
          and target_candidate.production_date = production_day
          and target_candidate.shift_id = dimensions.resolved_shift_id
          and target_candidate.line_id = dimensions.resolved_line_id
          and target_candidate.model_id = dimensions.resolved_model_id
          and target_candidate.process_id = dimensions.resolved_process_id
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
          production_day,
          dimensions.resolved_shift_id,
          null,
          dimensions.resolved_line_id,
          dimensions.resolved_model_id,
          dimensions.resolved_process_id,
          input_value,
          ok_value,
          ng_value,
          note_value,
          staged_row.id,
          actor_id,
          actor_id
        )
        returning id into quality_id;

        quality_inserted_count := quality_inserted_count + 1;
        inserted_count := inserted_count + 1;
      end if;

      update public.upload_rows
      set quality_record_id = quality_id,
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where id = staged_row.id;
    end if;
  end loop;

  for staged_row in
    select row_candidate.*
    from public.upload_rows as row_candidate
    where row_candidate.batch_id = p_batch_id
      and row_candidate.deleted_at is null
      and row_candidate.row_kind = 'defect'
    order by row_candidate.source_sheet, row_candidate.source_row, row_candidate.id
    for update
  loop
    if staged_row.status <> 'new'
      or staged_row.parent_upload_row_id is null then
      raise exception using
        errcode = '22023',
        message = 'invalid_defect_payload';
    end if;

    select parent_candidate.*
    into parent_row
    from public.upload_rows as parent_candidate
    where parent_candidate.id = staged_row.parent_upload_row_id
      and parent_candidate.batch_id = p_batch_id
      and parent_candidate.row_kind in ('production', 'daily_quality')
      and parent_candidate.quality_record_id is not null
      and parent_candidate.deleted_at is null
    for update;

    if not found then
      raise exception using
        errcode = '22023',
        message = 'invalid_defect_parent';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          '|',
          'defect',
          parent_row.quality_record_id,
          staged_row.payload ->> 'defectType',
          staged_row.payload ->> 'classification'
        ),
        0
      )
    );

    if exists (
      select 1
      from public.defect_records as existing_defect
      where existing_defect.quality_record_id = parent_row.quality_record_id
        and existing_defect.defect_type = staged_row.payload ->> 'defectType'
        and existing_defect.classification = staged_row.payload ->> 'classification'
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
      parent_row.quality_record_id,
      staged_row.payload ->> 'defectType',
      staged_row.payload ->> 'classification',
      (staged_row.payload ->> 'quantity')::integer,
      staged_row.payload ->> 'note',
      staged_row.id,
      actor_id,
      actor_id
    )
    returning id into defect_id;

    update public.upload_rows
    set quality_record_id = parent_row.quality_record_id,
        defect_record_id = defect_id,
        updated_at = now(),
        updated_by = actor_id,
        version = version + 1
    where id = staged_row.id;

    defect_inserted_count := defect_inserted_count + 1;
  end loop;

  update public.upload_batches
  set status = 'committed',
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where id = batch_row.id;

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

-- Preserve the public manual-save signature while validating every referenced
-- master row server-side. Active UI options are not a security boundary.
create or replace function public.save_production_record(
  payload jsonb,
  expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  app_role text := public.current_app_role();
  target public.production_records%rowtype;
  target_id uuid;
  requested_id uuid;
  day_value date;
  shift_value uuid;
  slot_value uuid;
  line_value uuid;
  model_value uuid;
  process_value uuid;
  input_value integer;
  actual_value integer;
  ok_value integer;
  ng_value integer;
  note_value text;
  item jsonb;
  reason_value uuid;
  minute_value numeric;
  start_value time;
  end_value time;
  duration_seconds numeric;
  total_minutes integer := 0;
  slot_minutes integer;
  conflict_constraint text;
begin
  if expected_version is null then
    raise exception using
      errcode = '40001',
      message = 'record_version_conflict';
  end if;

  if actor_id is null or app_role not in ('operator', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'invalid_production_payload';
  end if;

  begin
    requested_id := nullif(payload ->> 'id', '')::uuid;
    day_value := (payload ->> 'production_date')::date;
    shift_value := (payload ->> 'shift_id')::uuid;
    slot_value := (payload ->> 'time_slot_id')::uuid;
    line_value := (payload ->> 'line_id')::uuid;
    model_value := (payload ->> 'model_id')::uuid;
    process_value := (payload ->> 'process_id')::uuid;
    input_value := (payload ->> 'input_qty')::integer;
    actual_value := (payload ->> 'actual_qty')::integer;
    ok_value := (payload ->> 'ok_qty')::integer;
    ng_value := (payload ->> 'ng_qty')::integer;
    note_value := coalesce(payload ->> 'note', '');
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'invalid_production_payload';
  end;

  if day_value is null
    or shift_value is null
    or slot_value is null
    or line_value is null
    or model_value is null
    or process_value is null
    or input_value is null
    or actual_value is null
    or ok_value is null
    or ng_value is null
    or input_value < 0
    or actual_value < 0
    or ok_value < 0
    or ng_value < 0
    or ok_value > input_value
    or ok_value + ng_value > input_value
    or length(note_value) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'invalid_production_payload';
  end if;

  if app_role = 'operator'
    and day_value <> (now() at time zone 'Asia/Bangkok')::date then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  if not exists (
    select 1
    from public.models as model_row
    where model_row.id = model_value
      and model_row.is_active
      and model_row.deleted_at is null
  )
  or not exists (
    select 1
    from public.lines as line_row
    where line_row.id = line_value
      and line_row.is_active
      and line_row.deleted_at is null
  )
  or not exists (
    select 1
    from public.processes as process_row
    where process_row.id = process_value
      and process_row.is_active
      and process_row.deleted_at is null
  )
  or not exists (
    select 1
    from public.shifts as shift_row
    where shift_row.id = shift_value
      and shift_row.is_active
      and shift_row.deleted_at is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'inactive_master_data';
  end if;

  select (
    extract(
      epoch from (
        slot_row.ends_at
        - slot_row.starts_at
        + slot_row.end_day_offset * interval '1 day'
      )
    ) / 60
  )::integer
  into slot_minutes
  from public.time_slots as slot_row
  where slot_row.id = slot_value
    and slot_row.shift_id = shift_value
    and slot_row.is_active
    and slot_row.deleted_at is null;

  if slot_minutes is null
    or slot_minutes <= 0
    or jsonb_typeof(coalesce(payload -> 'downtime', '[]'::jsonb)) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'inactive_master_data';
  end if;

  for item in
    select downtime_item.value
    from jsonb_array_elements(
      coalesce(payload -> 'downtime', '[]'::jsonb)
    ) as downtime_item(value)
  loop
    begin
      reason_value := (item ->> 'reason_id')::uuid;
      minute_value := nullif(item ->> 'minutes', '')::numeric;
      start_value := nullif(item ->> 'start_time', '')::time;
      end_value := nullif(item ->> 'end_time', '')::time;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'invalid_downtime_payload';
    end;

    if reason_value is null
      or not exists (
        select 1
        from public.downtime_reasons as reason_row
        where reason_row.id = reason_value
          and reason_row.is_active
          and reason_row.deleted_at is null
      ) then
      raise exception using
        errcode = '22023',
        message = 'inactive_master_data';
    end if;

    if length(coalesce(item ->> 'note', '')) > 1000
      or (
        (minute_value is not null)::integer
        + (
          start_value is not null
          and end_value is not null
        )::integer
      ) <> 1
      or minute_value < 0
      or (
        minute_value is not null
        and trunc(minute_value) <> minute_value
      ) then
      raise exception using
        errcode = '22023',
        message = 'invalid_downtime_payload';
    end if;

    if minute_value is not null then
      total_minutes := total_minutes + minute_value::integer;
    else
      if extract(second from start_value) <> 0
        or extract(second from end_value) <> 0 then
        raise exception using
          errcode = '22023',
          message = 'invalid_downtime_duration';
      end if;

      duration_seconds := extract(
        epoch from (
          end_value
          - start_value
          + case
              when end_value < start_value then interval '1 day'
              else interval '0 day'
            end
        )
      );

      if duration_seconds < 0 or mod(duration_seconds, 60) <> 0 then
        raise exception using
          errcode = '22023',
          message = 'invalid_downtime_duration';
      end if;

      total_minutes := total_minutes + (duration_seconds / 60)::integer;
    end if;
  end loop;

  if total_minutes > slot_minutes then
    raise exception using
      errcode = '22023',
      message = 'downtime_exceeds_planned_time';
  end if;

  if requested_id is null then
    if expected_version <> 0 then
      raise exception using
        errcode = '40001',
        message = 'record_version_conflict';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        concat_ws(
          '|',
          day_value,
          shift_value,
          slot_value,
          line_value,
          model_value,
          process_value
        ),
        0
      )
    );

    if exists (
      select 1
      from public.production_records as production_row
      where production_row.production_date = day_value
        and production_row.shift_id = shift_value
        and production_row.time_slot_id = slot_value
        and production_row.line_id = line_value
        and production_row.model_id = model_value
        and production_row.process_id = process_value
        and production_row.deleted_at is null
    ) then
      raise exception using
        errcode = '40001',
        message = 'record_version_conflict';
    end if;

    begin
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
        day_value,
        shift_value,
        slot_value,
        line_value,
        model_value,
        process_value,
        input_value,
        actual_value,
        note_value,
        actor_id,
        actor_id
      )
      returning id into target_id;
    exception
      when unique_violation then
        get stacked diagnostics conflict_constraint = constraint_name;
        if conflict_constraint = 'production_records_unique_slot' then
          raise exception using
            errcode = '40001',
            message = 'record_version_conflict';
        end if;
        raise;
    end;
  else
    select production_row.*
    into target
    from public.production_records as production_row
    where production_row.id = requested_id
      and production_row.deleted_at is null
    for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'production_record_not_found';
    end if;

    if app_role <> 'admin'
      and (
        target.created_by <> actor_id
        or target.production_date <> (now() at time zone 'Asia/Bangkok')::date
      ) then
      raise exception using
        errcode = '42501',
        message = 'insufficient_privilege';
    end if;

    if target.version <> expected_version then
      raise exception using
        errcode = '40001',
        message = 'record_version_conflict';
    end if;

    if (
      target.production_date,
      target.shift_id,
      target.time_slot_id,
      target.line_id,
      target.model_id,
      target.process_id
    ) <> (
      day_value,
      shift_value,
      slot_value,
      line_value,
      model_value,
      process_value
    ) then
      raise exception using
        errcode = '22023',
        message = 'immutable_production_dimensions';
    end if;

    update public.production_records
    set input_qty = input_value,
        actual_qty = actual_value,
        note = note_value,
        updated_at = now(),
        updated_by = actor_id,
        version = version + 1
    where id = requested_id;

    target_id := requested_id;
  end if;

  update public.quality_records
  set deleted_at = now(),
      deleted_by = actor_id,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where production_record_id = target_id
    and deleted_at is null;

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
    created_by,
    updated_by
  )
  values (
    target_id,
    day_value,
    shift_value,
    slot_value,
    line_value,
    model_value,
    process_value,
    input_value,
    ok_value,
    ng_value,
    note_value,
    actor_id,
    actor_id
  );

  update public.downtime_records
  set deleted_at = now(),
      deleted_by = actor_id,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where production_record_id = target_id
    and deleted_at is null;

  for item in
    select downtime_item.value
    from jsonb_array_elements(
      coalesce(payload -> 'downtime', '[]'::jsonb)
    ) as downtime_item(value)
  loop
    insert into public.downtime_records (
      production_record_id,
      reason_id,
      minutes,
      note,
      created_by,
      updated_by
    )
    values (
      target_id,
      (item ->> 'reason_id')::uuid,
      coalesce(
        nullif(item ->> 'minutes', '')::integer,
        (
          extract(
            epoch from (
              (item ->> 'end_time')::time
              - (item ->> 'start_time')::time
              + case
                  when (item ->> 'end_time')::time
                    < (item ->> 'start_time')::time
                    then interval '1 day'
                  else interval '0 day'
                end
            )
          ) / 60
        )::integer
      ),
      coalesce(item ->> 'note', ''),
      actor_id,
      actor_id
    );
  end loop;

  return target_id;
end
$$;

revoke all on function public.save_production_record(jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.save_production_record(jsonb, bigint)
  to authenticated;
