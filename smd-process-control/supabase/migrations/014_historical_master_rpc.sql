create or replace function private.list_historical_master_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  app_role text;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;

  select profile.role
    into app_role
  from public.profiles as profile
  where profile.id = actor_id
    and profile.is_active
    and profile.role in ('viewer', 'operator', 'admin');

  if app_role is null then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'models', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', model_row.id,
          'code', model_row.code,
          'name', model_row.name,
          'is_active', model_row.is_active,
          'version', model_row.version
        )
        order by model_row.code
      )
      from public.models as model_row
      where model_row.deleted_at is null
    ), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', process_row.id,
          'code', process_row.code,
          'name', process_row.name,
          'is_active', process_row.is_active,
          'version', process_row.version
        )
        order by process_row.code
      )
      from public.processes as process_row
      where process_row.deleted_at is null
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', line_row.id,
          'code', line_row.code,
          'name', line_row.name,
          'is_active', line_row.is_active,
          'version', line_row.version
        )
        order by line_row.code
      )
      from public.lines as line_row
      where line_row.deleted_at is null
    ), '[]'::jsonb),
    'shifts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', shift_row.id,
          'code', shift_row.code,
          'name', shift_row.name,
          'is_active', shift_row.is_active,
          'version', shift_row.version
        )
        order by shift_row.code
      )
      from public.shifts as shift_row
      where shift_row.deleted_at is null
    ), '[]'::jsonb),
    'time_slots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', time_slot.id,
          'shift_id', time_slot.shift_id,
          'code', time_slot.code,
          'starts_at', pg_catalog.to_char(time_slot.starts_at, 'HH24:MI'),
          'ends_at', pg_catalog.to_char(time_slot.ends_at, 'HH24:MI'),
          'end_day_offset', time_slot.end_day_offset,
          'sequence', time_slot.sequence,
          'is_active', time_slot.is_active,
          'version', time_slot.version
        )
        order by time_slot.sequence, time_slot.code
      )
      from public.time_slots as time_slot
      where time_slot.deleted_at is null
    ), '[]'::jsonb),
    'downtime_reasons', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reason.id,
          'code', reason.code,
          'name', reason.name,
          'is_active', reason.is_active,
          'version', reason.version
        )
        order by reason.code
      )
      from public.downtime_reasons as reason
      where reason.deleted_at is null
    ), '[]'::jsonb),
    'standard_times', coalesce((
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
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.list_historical_master_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.list_historical_master_data()
$$;

revoke all on function private.list_historical_master_data() from public, anon, authenticated;
grant execute on function private.list_historical_master_data() to authenticated;
revoke all on function public.list_historical_master_data() from public, anon, authenticated;
grant execute on function public.list_historical_master_data() to authenticated;
