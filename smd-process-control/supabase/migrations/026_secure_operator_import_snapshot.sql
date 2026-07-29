-- Forward-only hardening for operator legacy commits and import reference data.
-- The operator-capable commit path may only process batches whose immutable
-- candidates are absent or still resolve exactly to active existing records.

alter function public.commit_upload_batch(uuid, boolean)
  rename to commit_upload_batch_v26_impl;

revoke all on function public.commit_upload_batch_v26_impl(uuid, boolean)
  from public, anon, authenticated;

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
  actor_profile record;
  batch_owner uuid;
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
      message = 'insufficient_privilege';
  end if;

  select batch.created_by
  into batch_owner
  from public.upload_batches as batch
  where batch.id = p_batch_id
    and batch.deleted_at is null
  -- Shared lock order with stage_upload_candidates:
  -- upload_batches row -> candidate rows -> delegated detail commit.
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'upload_batch_not_found';
  end if;

  if actor_profile.app_role <> 'admin'
    and batch_owner <> actor_id then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  if exists (
    select 1
    from public.upload_master_candidates as candidate
    where candidate.batch_id = p_batch_id
      and (
        candidate.status <> 'existing'
        or case candidate.entity
          when 'model' then not exists (
            select 1
            from public.models as model
            where model.code = candidate.normalized_code
              and model.name =
                candidate.proposed_data ->> 'proposedName'
              and model.is_active
              and model.deleted_at is null
          )
          when 'line' then not exists (
            select 1
            from public.lines as line
            where line.code = candidate.normalized_code
              and line.name =
                candidate.proposed_data ->> 'proposedName'
              and line.is_active
              and line.deleted_at is null
          )
          when 'shift' then not exists (
            select 1
            from public.shifts as shift
            where shift.code = candidate.normalized_code
              and shift.name =
                candidate.proposed_data ->> 'proposedName'
              and shift.is_active
              and shift.deleted_at is null
          )
          when 'downtime_reason' then not exists (
            select 1
            from public.downtime_reasons as reason
            where reason.code = candidate.normalized_code
              and reason.name =
                candidate.proposed_data ->> 'proposedName'
              and reason.is_active
              and reason.deleted_at is null
          )
          when 'time_slot' then not exists (
            select 1
            from public.shifts as shift
            join public.time_slots as slot
              on slot.shift_id = shift.id
            where shift.code = candidate.parent_code
              and shift.is_active
              and shift.deleted_at is null
              and slot.code = candidate.normalized_code
              and slot.is_active
              and slot.deleted_at is null
              and pg_catalog.to_char(
                slot.starts_at, 'HH24:MI'
              ) = candidate.proposed_data ->> 'startsAt'
              and pg_catalog.to_char(
                slot.ends_at, 'HH24:MI'
              ) = candidate.proposed_data ->> 'endsAt'
              and slot.end_day_offset::text =
                candidate.proposed_data ->> 'endDayOffset'
              and slot.sequence::text =
                candidate.proposed_data ->> 'sequence'
          )
          else true
        end
      )
  ) or exists (
    select 1
    from public.upload_standard_time_candidates as candidate
    where candidate.batch_id = p_batch_id
      and (
        candidate.status <> 'existing'
        or not exists (
          select 1
          from public.models as model
          join public.standard_times as standard_time
            on standard_time.model_id = model.id
          join public.lines as line
            on line.id = standard_time.line_id
          join public.processes as process
            on process.id = standard_time.process_id
          where model.code = candidate.model_code
            and model.is_active
            and model.deleted_at is null
            and line.code = candidate.line_code
            and line.is_active
            and line.deleted_at is null
            and process.code = candidate.process_code
            and process.is_active
            and process.deleted_at is null
            and standard_time.seconds_per_unit = coalesce(
              candidate.proposed_seconds_per_unit,
              candidate.median_seconds_per_unit
            )
            and standard_time.effective_from =
              candidate.effective_from
            and standard_time.effective_to is not distinct from
              candidate.effective_to
            and standard_time.deleted_at is null
        )
      )
  ) then
    raise exception using
      errcode = '42501',
      message = 'upload_candidates_require_admin';
  end if;

  return public.commit_upload_batch_v26_impl(
    p_batch_id,
    p_replace_conflicts
  );
end
$$;

revoke all on function public.commit_upload_batch(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.commit_upload_batch(uuid, boolean)
  to authenticated;

-- Import conflict detection needs inactive, undeleted master rows, but unlike
-- historical reporting it must never include a soft-deleted standard time.
create function public.list_import_master_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_profile record;
  result_value jsonb;
begin
  select *
  into actor_profile
  from private.current_profile();

  if actor_id is null
    or actor_profile.profile_id is distinct from actor_id
    or not actor_profile.profile_is_active
    or actor_profile.app_role not in ('viewer', 'operator', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  result_value := private.list_historical_master_data();

  return jsonb_set(
    result_value,
    '{standard_times}',
    coalesce((
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
    ), '[]'::jsonb),
    true
  );
end
$$;

revoke all on function public.list_import_master_data()
  from public, anon, authenticated;
grant execute on function public.list_import_master_data()
  to authenticated;
