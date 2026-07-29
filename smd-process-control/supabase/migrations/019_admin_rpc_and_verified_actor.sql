alter table public.time_slots
  add constraint time_slots_valid_duration
  check (
    extract(second from starts_at) = 0
    and extract(second from ends_at) = 0
    and (
      date '2000-01-01'
      + ends_at
      + end_day_offset * interval '1 day'
    ) - (date '2000-01-01' + starts_at) > interval '0'
    and (
      date '2000-01-01'
      + ends_at
      + end_day_offset * interval '1 day'
    ) - (date '2000-01-01' + starts_at) <= interval '24 hours'
  ) not valid;
alter table public.time_slots
  validate constraint time_slots_valid_duration;

create or replace function private.require_active_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null
    or not exists (
      select 1
      from public.profiles as actor_profile
      where actor_profile.id = actor_id
        and actor_profile.is_active
        and actor_profile.role = 'admin'
    ) then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  return actor_id;
end
$$;

revoke all on function private.require_active_admin()
  from public, anon, authenticated;

create or replace function public.admin_save_master(
  p_entity text,
  p_payload jsonb,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_admin();
  record_id uuid;
  code_value text;
  name_value text;
  result_row jsonb;
  shift_value uuid;
  starts_value time;
  ends_value time;
  end_offset_value smallint;
  sequence_value integer;
  model_value uuid;
  process_value uuid;
  line_value uuid;
  target_value numeric;
  seconds_value numeric;
  effective_from_value date;
  effective_to_value date;
  existing_standard public.standard_times%rowtype;
  business_date date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'invalid_master_payload';
  end if;

  if p_expected_version is null or p_expected_version < 0 then
    raise exception using
      errcode = '40001',
      message = 'record_version_conflict';
  end if;

  begin
    record_id := nullif(p_payload ->> 'id', '')::uuid;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'invalid_master_payload';
  end;

  if p_entity in (
    'models',
    'processes',
    'lines',
    'shifts',
    'downtime_reasons'
  ) then
    code_value := btrim(coalesce(p_payload ->> 'code', ''));
    name_value := btrim(coalesce(p_payload ->> 'name', ''));

    if code_value = ''
      or name_value = ''
      or length(code_value) > 100
      or length(name_value) > 200 then
      raise exception using
        errcode = '22023',
        message = 'invalid_master_payload';
    end if;

    if record_id is null then
      if p_expected_version <> 0 then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;

      execute format(
        'insert into public.%I as managed_row
          (code, name, created_by, updated_by)
         values ($1, $2, $3, $3)
         returning to_jsonb(managed_row)',
        p_entity
      )
      into result_row
      using code_value, name_value, actor_id;
    else
      execute format(
        'update public.%I as managed_row
         set code = $1,
             name = $2,
             updated_at = now(),
             updated_by = $3,
             version = version + 1
         where id = $4
           and version = $5
           and deleted_at is null
         returning to_jsonb(managed_row)',
        p_entity
      )
      into result_row
      using code_value, name_value, actor_id, record_id, p_expected_version;

      if result_row is null then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;
    end if;

    return result_row;
  end if;

  if p_entity = 'time_slots' then
    begin
      shift_value := (p_payload ->> 'shift_id')::uuid;
      code_value := btrim(coalesce(p_payload ->> 'code', ''));
      starts_value := (p_payload ->> 'starts_at')::time;
      ends_value := (p_payload ->> 'ends_at')::time;
      end_offset_value := (p_payload ->> 'end_day_offset')::smallint;
      sequence_value := (p_payload ->> 'sequence')::integer;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'invalid_master_payload';
    end;

    if shift_value is null
      or code_value = ''
      or length(code_value) > 100
      or starts_value is null
      or ends_value is null
      or extract(second from starts_value) <> 0
      or extract(second from ends_value) <> 0
      or end_offset_value not in (0, 1)
      or sequence_value is null
      or sequence_value <= 0
      or (
        date '2000-01-01'
        + ends_value
        + end_offset_value * interval '1 day'
      ) - (date '2000-01-01' + starts_value) <= interval '0'
      or (
        date '2000-01-01'
        + ends_value
        + end_offset_value * interval '1 day'
      ) - (date '2000-01-01' + starts_value) > interval '24 hours'
      or not exists (
        select 1
        from public.shifts as shift_row
        where shift_row.id = shift_value
          and shift_row.is_active
          and shift_row.deleted_at is null
      ) then
      raise exception using
        errcode = '22023',
        message = 'invalid_master_payload';
    end if;

    if record_id is null then
      if p_expected_version <> 0 then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;

      insert into public.time_slots as managed_row (
        shift_id,
        code,
        starts_at,
        ends_at,
        end_day_offset,
        sequence,
        created_by,
        updated_by
      )
      values (
        shift_value,
        code_value,
        starts_value,
        ends_value,
        end_offset_value,
        sequence_value,
        actor_id,
        actor_id
      )
      returning to_jsonb(managed_row) into result_row;
    else
      update public.time_slots as managed_row
      set shift_id = shift_value,
          code = code_value,
          starts_at = starts_value,
          ends_at = ends_value,
          end_day_offset = end_offset_value,
          sequence = sequence_value,
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where id = record_id
        and version = p_expected_version
        and deleted_at is null
      returning to_jsonb(managed_row) into result_row;

      if result_row is null then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;
    end if;

    return result_row;
  end if;

  if p_entity = 'yield_targets' then
    begin
      model_value := nullif(p_payload ->> 'model_id', '')::uuid;
      process_value := (p_payload ->> 'process_id')::uuid;
      line_value := nullif(p_payload ->> 'line_id', '')::uuid;
      target_value := (p_payload ->> 'target_percent')::numeric;
      effective_from_value := (p_payload ->> 'effective_from')::date;
      effective_to_value := nullif(p_payload ->> 'effective_to', '')::date;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'invalid_master_payload';
    end;

    if process_value is null
      or target_value is null
      or target_value < 0
      or target_value > 100
      or effective_from_value is null
      or (
        effective_to_value is not null
        and effective_to_value < effective_from_value
      )
      or not exists (
        select 1
        from public.processes as process_row
        where process_row.id = process_value
          and process_row.is_active
          and process_row.deleted_at is null
      )
      or (
        model_value is not null
        and not exists (
          select 1
          from public.models as model_row
          where model_row.id = model_value
            and model_row.is_active
            and model_row.deleted_at is null
        )
      )
      or (
        line_value is not null
        and not exists (
          select 1
          from public.lines as line_row
          where line_row.id = line_value
            and line_row.is_active
            and line_row.deleted_at is null
        )
      ) then
      raise exception using
        errcode = '22023',
        message = 'invalid_master_payload';
    end if;

    if record_id is null then
      if p_expected_version <> 0 then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;

      insert into public.yield_targets as managed_row (
        model_id,
        process_id,
        line_id,
        target_percent,
        effective_from,
        effective_to,
        created_by,
        updated_by
      )
      values (
        model_value,
        process_value,
        line_value,
        target_value,
        effective_from_value,
        effective_to_value,
        actor_id,
        actor_id
      )
      returning to_jsonb(managed_row) into result_row;
    else
      update public.yield_targets as managed_row
      set model_id = model_value,
          process_id = process_value,
          line_id = line_value,
          target_percent = target_value,
          effective_from = effective_from_value,
          effective_to = effective_to_value,
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where id = record_id
        and version = p_expected_version
        and deleted_at is null
      returning to_jsonb(managed_row) into result_row;

      if result_row is null then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;
    end if;

    return result_row;
  end if;

  if p_entity = 'standard_times' then
    begin
      model_value := (p_payload ->> 'model_id')::uuid;
      process_value := (p_payload ->> 'process_id')::uuid;
      line_value := (p_payload ->> 'line_id')::uuid;
      seconds_value := (p_payload ->> 'seconds_per_unit')::numeric;
      effective_from_value := (p_payload ->> 'effective_from')::date;
      effective_to_value := nullif(p_payload ->> 'effective_to', '')::date;
    exception
      when others then
        raise exception using
          errcode = '22023',
          message = 'invalid_master_payload';
    end;

    if model_value is null
      or process_value is null
      or line_value is null
      or seconds_value is null
      or seconds_value <= 0
      or effective_from_value is null
      or (
        effective_to_value is not null
        and effective_to_value < effective_from_value
      )
      or not exists (
        select 1
        from public.models as model_row
        where model_row.id = model_value
          and model_row.is_active
          and model_row.deleted_at is null
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
        from public.lines as line_row
        where line_row.id = line_value
          and line_row.is_active
          and line_row.deleted_at is null
      ) then
      raise exception using
        errcode = '22023',
        message = 'invalid_master_payload';
    end if;

    if record_id is null and effective_from_value < business_date then
      raise exception using
        errcode = '22023',
        message = 'historical_standard_time_immutable';
    end if;

    if exists (
      select 1
      from public.standard_times as historical_standard
      where (record_id is null or historical_standard.id <> record_id)
        and historical_standard.model_id = model_value
        and historical_standard.process_id = process_value
        and historical_standard.line_id = line_value
        and (
          historical_standard.deleted_at is null
          or historical_standard.effective_from
            <= (
              historical_standard.deleted_at
              at time zone 'Asia/Bangkok'
            )::date
        )
        and daterange(
          historical_standard.effective_from,
          coalesce(historical_standard.effective_to, 'infinity'::date),
          '[]'
        ) && daterange(
          effective_from_value,
          coalesce(effective_to_value, 'infinity'::date),
          '[]'
        )
    ) then
      raise exception using
        errcode = '23P01',
        message = 'overlapping-effective-period';
    end if;

    if record_id is null then
      if p_expected_version <> 0 then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;

      insert into public.standard_times as managed_row (
        model_id,
        process_id,
        line_id,
        seconds_per_unit,
        effective_from,
        effective_to,
        created_by,
        updated_by
      )
      values (
        model_value,
        process_value,
        line_value,
        seconds_value,
        effective_from_value,
        effective_to_value,
        actor_id,
        actor_id
      )
      returning to_jsonb(managed_row) into result_row;
    else
      select standard_row.*
      into existing_standard
      from public.standard_times as standard_row
      where standard_row.id = record_id
        and standard_row.deleted_at is null
      for update;

      if not found or existing_standard.version <> p_expected_version then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;

      -- Once a period can have contributed to production history it is
      -- immutable. Administrators close it and create a new effective period.
      if existing_standard.effective_from <= business_date
        or effective_from_value <= business_date then
        raise exception using
          errcode = '22023',
          message = 'historical_standard_time_immutable';
      end if;

      update public.standard_times as managed_row
      set model_id = model_value,
          process_id = process_value,
          line_id = line_value,
          seconds_per_unit = seconds_value,
          effective_from = effective_from_value,
          effective_to = effective_to_value,
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where id = record_id
        and version = p_expected_version
        and deleted_at is null
      returning to_jsonb(managed_row) into result_row;

      if result_row is null then
        raise exception using
          errcode = '40001',
          message = 'record_version_conflict';
      end if;
    end if;

    return result_row;
  end if;

  raise exception using
    errcode = '22023',
    message = 'unsupported_master_entity';
end
$$;

create or replace function public.admin_set_master_active(
  p_entity text,
  p_record_id uuid,
  p_is_active boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_admin();
  result_row jsonb;
  standard_target public.standard_times%rowtype;
  business_date date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if p_record_id is null
    or p_is_active is null
    or p_expected_version is null
    or p_expected_version <= 0 then
    raise exception using
      errcode = '22023',
      message = 'invalid_master_state_request';
  end if;

  if p_is_active and p_entity = 'time_slots' and not exists (
    select 1
    from public.time_slots as managed_slot
    join public.shifts as active_shift
      on active_shift.id = managed_slot.shift_id
     and active_shift.is_active
     and active_shift.deleted_at is null
    where managed_slot.id = p_record_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'inactive_master_data';
  end if;

  if p_is_active and p_entity = 'yield_targets' and not exists (
    select 1
    from public.yield_targets as managed_target
    join public.processes as active_process
      on active_process.id = managed_target.process_id
     and active_process.is_active
     and active_process.deleted_at is null
    left join public.models as active_model
      on active_model.id = managed_target.model_id
     and active_model.is_active
     and active_model.deleted_at is null
    left join public.lines as active_line
      on active_line.id = managed_target.line_id
     and active_line.is_active
     and active_line.deleted_at is null
    where managed_target.id = p_record_id
      and (
        managed_target.model_id is null
        or active_model.id is not null
      )
      and (
        managed_target.line_id is null
        or active_line.id is not null
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'inactive_master_data';
  end if;

  if p_is_active and p_entity = 'standard_times' and not exists (
    select 1
    from public.standard_times as managed_standard
    join public.models as active_model
      on active_model.id = managed_standard.model_id
     and active_model.is_active
     and active_model.deleted_at is null
    join public.processes as active_process
      on active_process.id = managed_standard.process_id
     and active_process.is_active
     and active_process.deleted_at is null
    join public.lines as active_line
      on active_line.id = managed_standard.line_id
     and active_line.is_active
     and active_line.deleted_at is null
    where managed_standard.id = p_record_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'inactive_master_data';
  end if;

  if p_entity in (
    'models',
    'processes',
    'lines',
    'shifts',
    'time_slots',
    'downtime_reasons'
  ) then
    execute format(
      'update public.%I as managed_row
       set is_active = $1,
           updated_at = now(),
           updated_by = $2,
           version = version + 1
       where id = $3
         and version = $4
         and deleted_at is null
       returning to_jsonb(managed_row)',
      p_entity
    )
    into result_row
    using p_is_active, actor_id, p_record_id, p_expected_version;
  elsif p_entity = 'yield_targets' then
    execute format(
      'update public.%I as managed_row
       set deleted_at = case when $1 then null else now() end,
           deleted_by = case when $1 then null else $2 end,
           updated_at = now(),
           updated_by = $2,
           version = version + 1
       where id = $3
         and version = $4
         and (
           ($1 and deleted_at is not null)
           or (not $1 and deleted_at is null)
         )
       returning to_jsonb(managed_row)',
      p_entity
    )
    into result_row
    using p_is_active, actor_id, p_record_id, p_expected_version;
  elsif p_entity = 'standard_times' then
    select standard_row.*
    into standard_target
    from public.standard_times as standard_row
    where standard_row.id = p_record_id
    for update;

    if not found
      or standard_target.version <> p_expected_version
      or (
        p_is_active
        and standard_target.deleted_at is null
      )
      or (
        not p_is_active
        and standard_target.deleted_at is not null
      ) then
      raise exception using
        errcode = '40001',
        message = 'record_version_conflict';
    end if;

    if not p_is_active then
      update public.standard_times as managed_row
      set effective_to = case
            when managed_row.effective_from < business_date
              and (
                managed_row.effective_to is null
                or managed_row.effective_to >= business_date
              )
              then business_date - 1
            else managed_row.effective_to
          end,
          deleted_at = now(),
          deleted_by = actor_id,
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where managed_row.id = p_record_id
      returning to_jsonb(managed_row) into result_row;
    elsif standard_target.effective_from >= business_date then
      update public.standard_times as managed_row
      set deleted_at = null,
          deleted_by = null,
          effective_to = case
            when managed_row.effective_from = business_date
              and managed_row.effective_to = business_date
              then null
            else managed_row.effective_to
          end,
          updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where managed_row.id = p_record_id
      returning to_jsonb(managed_row) into result_row;
    else
      update public.standard_times as historical_row
      set updated_at = now(),
          updated_by = actor_id,
          version = version + 1
      where historical_row.id = p_record_id;

      insert into public.standard_times as managed_row (
        model_id,
        process_id,
        line_id,
        seconds_per_unit,
        effective_from,
        effective_to,
        created_by,
        updated_by
      )
      values (
        standard_target.model_id,
        standard_target.process_id,
        standard_target.line_id,
        standard_target.seconds_per_unit,
        business_date,
        case
          when standard_target.effective_to >= business_date
            then standard_target.effective_to
          else null
        end,
        actor_id,
        actor_id
      )
      returning to_jsonb(managed_row) into result_row;
    end if;
  else
    raise exception using
      errcode = '22023',
      message = 'unsupported_master_entity';
  end if;

  if result_row is null then
    raise exception using
      errcode = '40001',
      message = 'record_version_conflict';
  end if;

  return result_row;
end
$$;

create or replace function public.admin_update_user(
  p_user_id uuid,
  p_role text,
  p_is_active boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_admin();
  result_row jsonb;
begin
  if p_user_id is null
    or p_role not in ('viewer', 'operator', 'admin')
    or p_is_active is null
    or p_expected_version is null
    or p_expected_version <= 0 then
    raise exception using
      errcode = '22023',
      message = 'invalid_user_update';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('admin-profile-role-roster', 0)
  );

  if p_user_id = actor_id
    and (
      not p_is_active
      or p_role <> 'admin'
    ) then
    raise exception using
      errcode = '22023',
      message = 'cannot_remove_own_admin_access';
  end if;

  update public.profiles as managed_profile
  set role = p_role,
      is_active = p_is_active,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where id = p_user_id
    and version = p_expected_version
  returning to_jsonb(managed_profile) into result_row;

  if result_row is null then
    raise exception using
      errcode = '40001',
      message = 'record_version_conflict';
  end if;

  if not exists (
    select 1
    from public.profiles
    where role = 'admin'
      and is_active
  ) then
    raise exception using
      errcode = '22023',
      message = 'cannot_remove_last_admin';
  end if;

  return result_row;
end
$$;

create or replace function public.admin_soft_delete_production(
  p_record_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_admin();
  target_row public.production_records%rowtype;
  result_row jsonb;
begin
  if p_record_id is null
    or p_expected_version is null
    or p_expected_version <= 0 then
    raise exception using
      errcode = '22023',
      message = 'invalid_production_delete';
  end if;

  select production_row.*
  into target_row
  from public.production_records as production_row
  where production_row.id = p_record_id
    and production_row.deleted_at is null
  for update;

  if not found or target_row.version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'record_version_conflict';
  end if;

  update public.quality_records
  set deleted_at = now(),
      deleted_by = actor_id,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where production_record_id = target_row.id
    and deleted_at is null;

  update public.downtime_records
  set deleted_at = now(),
      deleted_by = actor_id,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where production_record_id = target_row.id
    and deleted_at is null;

  update public.production_records as deleted_production
  set deleted_at = now(),
      deleted_by = actor_id,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where deleted_production.id = target_row.id
  returning to_jsonb(deleted_production) into result_row;

  return result_row;
end
$$;

revoke all on function public.admin_save_master(text, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.admin_set_master_active(text, uuid, boolean, bigint)
  from public, anon, authenticated;
revoke all on function public.admin_update_user(uuid, text, boolean, bigint)
  from public, anon, authenticated;
revoke all on function public.admin_soft_delete_production(uuid, bigint)
  from public, anon, authenticated;

grant execute on function public.admin_save_master(text, jsonb, bigint)
  to authenticated;
grant execute on function public.admin_set_master_active(text, uuid, boolean, bigint)
  to authenticated;
grant execute on function public.admin_update_user(uuid, text, boolean, bigint)
  to authenticated;
grant execute on function public.admin_soft_delete_production(uuid, bigint)
  to authenticated;

create or replace function public.admin_list_operational_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin();

  return jsonb_build_object(
    'models', coalesce((
      select jsonb_agg(to_jsonb(model_row) order by model_row.code, model_row.id)
      from public.models as model_row
    ), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(to_jsonb(process_row) order by process_row.code, process_row.id)
      from public.processes as process_row
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(to_jsonb(line_row) order by line_row.code, line_row.id)
      from public.lines as line_row
    ), '[]'::jsonb),
    'shifts', coalesce((
      select jsonb_agg(to_jsonb(shift_row) order by shift_row.code, shift_row.id)
      from public.shifts as shift_row
    ), '[]'::jsonb),
    'time_slots', coalesce((
      select jsonb_agg(
        to_jsonb(time_slot_row)
        order by time_slot_row.shift_id, time_slot_row.sequence, time_slot_row.id
      )
      from public.time_slots as time_slot_row
    ), '[]'::jsonb),
    'downtime_reasons', coalesce((
      select jsonb_agg(to_jsonb(reason_row) order by reason_row.code, reason_row.id)
      from public.downtime_reasons as reason_row
    ), '[]'::jsonb),
    'yield_targets', coalesce((
      select jsonb_agg(
        to_jsonb(target_row)
        order by target_row.effective_from desc, target_row.id
      )
      from public.yield_targets as target_row
    ), '[]'::jsonb),
    'standard_times', coalesce((
      select jsonb_agg(
        to_jsonb(standard_time_row)
        order by standard_time_row.effective_from desc, standard_time_row.id
      )
      from public.standard_times as standard_time_row
    ), '[]'::jsonb),
    'profiles', coalesce((
      select jsonb_agg(
        to_jsonb(profile_row)
        order by profile_row.employee_id, profile_row.id
      )
      from public.profiles as profile_row
    ), '[]'::jsonb),
    'upload_batches', coalesce((
      select jsonb_agg(
        to_jsonb(batch_row)
        order by batch_row.created_at desc, batch_row.id
      )
      from (
        select *
        from public.upload_batches
        order by created_at desc, id
        limit 100
      ) as batch_row
    ), '[]'::jsonb),
    'audit_logs', coalesce((
      select jsonb_agg(
        to_jsonb(audit_row)
        order by audit_row.created_at desc, audit_row.id
      )
      from (
        select *
        from public.audit_logs
        order by created_at desc, id
        limit 100
      ) as audit_row
    ), '[]'::jsonb),
    'production_records', coalesce((
      select jsonb_agg(
        to_jsonb(production_row)
        order by production_row.production_date desc, production_row.id
      )
      from (
        select *
        from public.production_records
        order by production_date desc, id
        limit 100
      ) as production_row
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.admin_manage_configuration(
  p_entity text,
  p_action text,
  p_record_id uuid,
  p_expected_version bigint,
  p_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mapped_entity text;
  normalized_values jsonb := coalesce(p_values, '{}'::jsonb);
begin
  perform private.require_active_admin();

  mapped_entity := case p_entity
    when 'model' then 'models'
    when 'process' then 'processes'
    when 'line' then 'lines'
    when 'shift' then 'shifts'
    when 'time_slot' then 'time_slots'
    when 'downtime_reason' then 'downtime_reasons'
    when 'yield_target' then 'yield_targets'
    when 'standard_time' then 'standard_times'
    else null
  end;

  if mapped_entity is null
    or p_action not in ('create', 'update', 'deactivate', 'reactivate')
    or jsonb_typeof(normalized_values) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'invalid_configuration_request';
  end if;

  if p_action = 'create' then
    if p_record_id is not null
      or (
        p_expected_version is not null
        and p_expected_version <> 0
      ) then
      raise exception using
        errcode = '40001',
        message = 'record_version_conflict';
    end if;

    return public.admin_save_master(
      mapped_entity,
      normalized_values - 'id',
      0
    );
  end if;

  if p_record_id is null
    or p_expected_version is null
    or p_expected_version <= 0 then
    raise exception using
      errcode = '40001',
      message = 'record_version_conflict';
  end if;

  if p_action = 'update' then
    return public.admin_save_master(
      mapped_entity,
      normalized_values || jsonb_build_object('id', p_record_id),
      p_expected_version
    );
  end if;

  return public.admin_set_master_active(
    mapped_entity,
    p_record_id,
    p_action = 'reactivate',
    p_expected_version
  );
end
$$;

create or replace function public.admin_manage_profile(
  p_profile_id uuid,
  p_role text,
  p_is_active boolean,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin();
  return public.admin_update_user(
    p_profile_id,
    p_role,
    p_is_active,
    p_expected_version
  );
end
$$;

-- Only the fixed app-facing RPC contracts remain executable by authenticated
-- users. The implementation helpers stay inaccessible even though each also
-- performs its own active-admin check.
revoke all on function public.admin_save_master(text, jsonb, bigint)
  from public, anon, authenticated;
revoke all on function public.admin_set_master_active(text, uuid, boolean, bigint)
  from public, anon, authenticated;
revoke all on function public.admin_update_user(uuid, text, boolean, bigint)
  from public, anon, authenticated;
revoke all on function public.admin_list_operational_data()
  from public, anon, authenticated;
revoke all on function public.admin_manage_configuration(
  text,
  text,
  uuid,
  bigint,
  jsonb
) from public, anon, authenticated;
revoke all on function public.admin_manage_profile(uuid, text, boolean, bigint)
  from public, anon, authenticated;

grant execute on function public.admin_list_operational_data()
  to authenticated;
grant execute on function public.admin_manage_configuration(
  text,
  text,
  uuid,
  bigint,
  jsonb
) to authenticated;
grant execute on function public.admin_manage_profile(
  uuid,
  text,
  boolean,
  bigint
) to authenticated;

create or replace function private.list_historical_standard_times()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_app_role() not in ('viewer', 'operator', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  -- Historical calculations retain deleted periods only when they had already
  -- taken effect by deactivation. Future cancellations never apply.
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', standard_time.id,
        'model_id', standard_time.model_id,
        'process_id', standard_time.process_id,
        'line_id', standard_time.line_id,
        'seconds_per_unit', standard_time.seconds_per_unit,
        'effective_from', standard_time.effective_from,
        'effective_to', standard_time.effective_to
      )
      order by standard_time.effective_from desc, standard_time.id
    )
    from public.standard_times as standard_time
    where standard_time.deleted_at is null
      or standard_time.effective_from
        <= (standard_time.deleted_at at time zone 'Asia/Bangkok')::date
  ), '[]'::jsonb);
end
$$;

revoke all on function private.list_historical_standard_times()
  from public, anon, authenticated;
grant execute on function private.list_historical_standard_times()
  to authenticated;

create or replace function public.list_historical_master_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_set(
    private.list_historical_master_data(),
    '{standard_times}',
    private.list_historical_standard_times(),
    true
  )
$$;

drop policy if exists standard_times_active_profile_select
  on public.standard_times;
create policy standard_times_active_profile_select
  on public.standard_times
  for select
  to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      deleted_at is null
      or effective_from
        <= (deleted_at at time zone 'Asia/Bangkok')::date
    )
  );

-- Trigger audits normally use auth.uid(). A service-role Edge call has no end
-- user uid, so accept a local verified actor only inside the service-role-only
-- profile RPC. Authenticated clients cannot set or use this audit path.
create or replace function private.audit_business_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  action_name text;
  record uuid;
begin
  if actor is null and auth.role() = 'service_role' then
    begin
      actor := nullif(
        current_setting('app.verified_actor_id', true),
        ''
      )::uuid;
    exception
      when others then
        actor := null;
    end;
  end if;

  if tg_op = 'INSERT' then
    action_name := 'insert';
    record := new.id;
    insert into public.audit_logs (
      actor_id,
      table_name,
      record_id,
      action,
      before_data,
      after_data,
      created_by,
      updated_by
    )
    values (
      actor,
      tg_table_name,
      record,
      action_name,
      null,
      to_jsonb(new),
      actor,
      actor
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    action_name := case
      when (to_jsonb(old) ? 'deleted_at')
        and (to_jsonb(old) ->> 'deleted_at') is null
        and (to_jsonb(new) ->> 'deleted_at') is not null
        then 'delete'
      when (to_jsonb(old) ? 'deleted_at')
        and (to_jsonb(old) ->> 'deleted_at') is not null
        and (to_jsonb(new) ->> 'deleted_at') is null
        then 'restore'
      else 'update'
    end;
    record := new.id;
    insert into public.audit_logs (
      actor_id,
      table_name,
      record_id,
      action,
      before_data,
      after_data,
      created_by,
      updated_by
    )
    values (
      actor,
      tg_table_name,
      record,
      action_name,
      to_jsonb(old),
      to_jsonb(new),
      actor,
      actor
    );
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'physical_delete_not_allowed';
end
$$;

create or replace function public.admin_create_profile(
  p_profile_id uuid,
  p_employee_id text,
  p_display_name text,
  p_role text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_row jsonb;
  employee_value text := btrim(coalesce(p_employee_id, ''));
  display_value text := btrim(coalesce(p_display_name, ''));
begin
  if auth.role() <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'service_role_required';
  end if;

  if p_actor_id is null
    or not exists (
      select 1
      from public.profiles as actor_profile
      where actor_profile.id = p_actor_id
        and actor_profile.is_active
        and actor_profile.role = 'admin'
    ) then
    raise exception using
      errcode = '42501',
      message = 'verified_admin_required';
  end if;

  if p_profile_id is null
    or employee_value !~ '^[0-9]{4,12}$'
    or display_value = ''
    or length(display_value) > 100
    or p_role not in ('viewer', 'operator', 'admin')
    or not exists (
      select 1
      from auth.users as auth_user
      where auth_user.id = p_profile_id
    ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_profile_payload';
  end if;

  perform set_config(
    'app.verified_actor_id',
    p_actor_id::text,
    true
  );

  insert into public.profiles as created_profile (
    id,
    employee_id,
    display_name,
    role,
    is_active,
    created_by,
    updated_by
  )
  values (
    p_profile_id,
    employee_value,
    display_value,
    p_role,
    true,
    p_actor_id,
    p_actor_id
  )
  returning to_jsonb(created_profile) into result_row;

  return result_row;
end
$$;

revoke all on function public.admin_create_profile(
  uuid,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.admin_create_profile(
  uuid,
  text,
  text,
  text,
  uuid
) to service_role;
