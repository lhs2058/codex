create function private.legacy_jsonb_number_is_safe(
  p_value jsonb,
  p_minimum numeric,
  p_maximum numeric,
  p_max_scale integer,
  p_integral boolean
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  numeric_value numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number'
    or not jsonb_path_exists(
      p_value,
      '$ ? (@ >= $minimum && @ <= $maximum)',
      jsonb_build_object(
        'minimum', to_jsonb(p_minimum),
        'maximum', to_jsonb(p_maximum)
      ),
      true
    ) then
    return false;
  end if;

  numeric_value := (p_value #>> '{}')::numeric;
  return scale(numeric_value) <= p_max_scale
    and (not p_integral or trunc(numeric_value) = numeric_value);
exception
  when others then
    return false;
end
$$;

create function private.legacy_master_candidate_payload_is_safe(p_candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  allowed_key text;
  message jsonb;
  source jsonb;
begin
  if p_candidate is null
    or jsonb_typeof(p_candidate) is distinct from 'object' then
    return false;
  end if;

  if pg_column_size(p_candidate) > 262144
    or jsonb_typeof(p_candidate -> 'messages') is distinct from 'array'
    or jsonb_typeof(p_candidate -> 'sources') is distinct from 'array' then
    return false;
  end if;

  if jsonb_array_length(p_candidate -> 'messages') > 100
    or jsonb_array_length(p_candidate -> 'sources') > 500
    or length(coalesce(p_candidate ->> 'key', '')) > 300
    or length(coalesce(p_candidate ->> 'code', '')) > 100
    or length(coalesce(p_candidate ->> 'parentCode', '')) > 100
    or length(coalesce(p_candidate ->> 'proposedName', '')) > 200
    or length(coalesce(p_candidate ->> 'currentName', '')) > 200
    or length(coalesce(p_candidate ->> 'conflictReason', '')) > 100
    or length(coalesce(p_candidate ->> 'startsAt', '')) > 20
    or length(coalesce(p_candidate ->> 'endsAt', '')) > 20 then
    return false;
  end if;

  if (
    jsonb_typeof(p_candidate -> 'endDayOffset') <> 'null'
    and not private.legacy_jsonb_number_is_safe(
      p_candidate -> 'endDayOffset', 0, 1, 0, true
    )
  ) or (
    jsonb_typeof(p_candidate -> 'sequence') <> 'null'
    and not private.legacy_jsonb_number_is_safe(
      p_candidate -> 'sequence', 1, 100, 0, true
    )
  ) then
    return false;
  end if;

  for allowed_key in select jsonb_object_keys(p_candidate)
  loop
    if allowed_key not in (
      'key', 'entity', 'code', 'parentCode', 'proposedName', 'status',
      'approved', 'conflictReason', 'currentName', 'resolvable',
      'startsAt', 'endsAt', 'endDayOffset', 'sequence', 'messages',
      'sources'
    ) then
      return false;
    end if;
  end loop;

  for message in select value from jsonb_array_elements(p_candidate -> 'messages')
  loop
    if jsonb_typeof(message) <> 'string'
      or pg_column_size(message) > 1024
      or length(message #>> '{}') > 500 then
      return false;
    end if;
  end loop;

  for source in select value from jsonb_array_elements(p_candidate -> 'sources')
  loop
    if jsonb_typeof(source) <> 'object'
      or pg_column_size(source) > 1024
      or length(coalesce(source ->> 'sheet', '')) > 200
      or not private.legacy_jsonb_number_is_safe(
        source -> 'row', 1, 1048576, 0, true
      )
      or exists (
        select 1
        from jsonb_object_keys(source) as source_key(value)
        where source_key.value not in ('sheet', 'row')
      ) then
      return false;
    end if;
  end loop;

  return true;
end
$$;

create function private.legacy_standard_time_candidate_payload_is_safe(p_candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  allowed_key text;
  message jsonb;
  observation jsonb;
begin
  if p_candidate is null
    or jsonb_typeof(p_candidate) is distinct from 'object' then
    return false;
  end if;

  if pg_column_size(p_candidate) > 262144
    or jsonb_typeof(p_candidate -> 'messages') is distinct from 'array'
    or jsonb_typeof(p_candidate -> 'observations') is distinct from 'array' then
    return false;
  end if;

  if jsonb_array_length(p_candidate -> 'messages') > 100
    or jsonb_array_length(p_candidate -> 'observations') > 500
    or length(coalesce(p_candidate ->> 'key', '')) > 300
    or length(coalesce(p_candidate ->> 'modelCode', '')) > 100
    or length(coalesce(p_candidate ->> 'lineCode', '')) > 100
    or length(coalesce(p_candidate ->> 'processCode', '')) > 20
    or length(coalesce(p_candidate ->> 'effectiveFrom', '')) > 20
    or length(coalesce(p_candidate ->> 'effectiveTo', '')) > 20 then
    return false;
  end if;

  if not private.legacy_jsonb_number_is_safe(
      p_candidate -> 'minimum', 0.000001, 86400, 6, false
    )
    or not private.legacy_jsonb_number_is_safe(
      p_candidate -> 'median', 0.000001, 86400, 6, false
    )
    or not private.legacy_jsonb_number_is_safe(
      p_candidate -> 'maximum', 0.000001, 86400, 6, false
    )
    or (
      jsonb_typeof(p_candidate -> 'proposedSecondsPerUnit') <> 'null'
      and not private.legacy_jsonb_number_is_safe(
        p_candidate -> 'proposedSecondsPerUnit',
        0.000001, 86400, 6, false
      )
    )
    or (
      jsonb_typeof(p_candidate -> 'approvedSecondsPerUnit') <> 'null'
      and not private.legacy_jsonb_number_is_safe(
        p_candidate -> 'approvedSecondsPerUnit',
        0.000001, 86400, 6, false
      )
    ) then
    return false;
  end if;

  if (p_candidate ->> 'minimum')::numeric
      > (p_candidate ->> 'median')::numeric
    or (p_candidate ->> 'median')::numeric
      > (p_candidate ->> 'maximum')::numeric then
    return false;
  end if;

  for allowed_key in select jsonb_object_keys(p_candidate)
  loop
    if allowed_key not in (
      'key', 'modelCode', 'lineCode', 'processCode', 'status', 'approved',
      'proposedSecondsPerUnit', 'approvedSecondsPerUnit', 'minimum',
      'median', 'maximum', 'effectiveFrom', 'effectiveTo', 'messages',
      'observations'
    ) then
      return false;
    end if;
  end loop;

  for message in select value from jsonb_array_elements(p_candidate -> 'messages')
  loop
    if jsonb_typeof(message) <> 'string'
      or pg_column_size(message) > 1024
      or length(message #>> '{}') > 500 then
      return false;
    end if;
  end loop;

  for observation in
    select value from jsonb_array_elements(p_candidate -> 'observations')
  loop
    if jsonb_typeof(observation) <> 'object'
      or pg_column_size(observation) > 1024
      or length(coalesce(observation ->> 'productionDate', '')) > 20
      or length(coalesce(observation ->> 'shiftCode', '')) > 20
      or length(coalesce(observation ->> 'timeSlotCode', '')) > 20
      or length(coalesce(observation ->> 'sheet', '')) > 200
      or not private.legacy_jsonb_number_is_safe(
        observation -> 'capacityQty', 0.000001, 1000000000, 6, false
      )
      or not private.legacy_jsonb_number_is_safe(
        observation -> 'plannedSeconds', 0.000001, 604800, 6, false
      )
      or not private.legacy_jsonb_number_is_safe(
        observation -> 'secondsPerUnit', 0.000001, 86400, 6, false
      )
      or not private.legacy_jsonb_number_is_safe(
        observation -> 'row', 1, 1048576, 0, true
      )
      or exists (
        select 1
        from jsonb_object_keys(observation) as observation_key(value)
        where observation_key.value not in (
          'productionDate', 'shiftCode', 'timeSlotCode', 'capacityQty',
          'plannedSeconds', 'secondsPerUnit', 'sheet', 'row'
        )
      ) then
      return false;
    end if;
  end loop;

  return true;
end
$$;

create function private.legacy_standard_time_candidate_payload(
  p_candidate public.upload_standard_time_candidates
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'key', p_candidate.candidate_key,
    'modelCode', p_candidate.model_code,
    'lineCode', p_candidate.line_code,
    'processCode', p_candidate.process_code,
    'status', p_candidate.status,
    'approved', false,
    'proposedSecondsPerUnit', p_candidate.proposed_seconds_per_unit,
    'approvedSecondsPerUnit', p_candidate.approved_seconds_per_unit,
    'minimum', p_candidate.minimum_seconds_per_unit,
    'median', p_candidate.median_seconds_per_unit,
    'maximum', p_candidate.maximum_seconds_per_unit,
    'effectiveFrom', p_candidate.effective_from,
    'effectiveTo', p_candidate.effective_to,
    'messages', p_candidate.messages,
    'observations', p_candidate.observations
  )
$$;

revoke all on function private.legacy_jsonb_number_is_safe(
  jsonb, numeric, numeric, integer, boolean
) from public, anon, authenticated;
revoke all on function private.legacy_master_candidate_payload_is_safe(jsonb)
  from public, anon, authenticated;
revoke all on function private.legacy_standard_time_candidate_payload_is_safe(jsonb)
  from public, anon, authenticated;
revoke all on function private.legacy_standard_time_candidate_payload(
  public.upload_standard_time_candidates
) from public, anon, authenticated;

alter function public.stage_upload_candidates(uuid, jsonb, jsonb)
  set schema private;
alter function private.stage_upload_candidates(uuid, jsonb, jsonb)
  rename to stage_upload_candidates_validated;
revoke all on function private.stage_upload_candidates_validated(uuid, jsonb, jsonb)
  from public, anon, authenticated;

create function public.stage_upload_candidates(
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
  candidate jsonb;
  normalized_master jsonb;
  normalized_standard_time jsonb;
begin
  if p_master_candidates is null
    or p_standard_time_candidates is null
    or jsonb_typeof(p_master_candidates) is distinct from 'array'
    or jsonb_typeof(p_standard_time_candidates) is distinct from 'array' then
    raise exception using
      errcode = '22023',
      message = 'candidate_payload_oversized';
  end if;

  if jsonb_array_length(p_master_candidates) > 100
    or jsonb_array_length(p_standard_time_candidates) > 100 then
    raise exception using
      errcode = '22023',
      message = 'candidate_payload_oversized';
  end if;

  for candidate in select value from jsonb_array_elements(p_master_candidates)
  loop
    if not private.legacy_master_candidate_payload_is_safe(candidate) then
      raise exception using
        errcode = '22023',
        message = 'candidate_payload_oversized';
    end if;
  end loop;

  for candidate in
    select value from jsonb_array_elements(p_standard_time_candidates)
  loop
    if not private.legacy_standard_time_candidate_payload_is_safe(candidate) then
      raise exception using
        errcode = '22023',
        message = 'candidate_payload_oversized';
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', candidate -> 'key',
    'entity', candidate -> 'entity',
    'code', candidate -> 'code',
    'parentCode', candidate -> 'parentCode',
    'proposedName', candidate -> 'proposedName',
    'status', candidate -> 'status',
    'approved', candidate -> 'approved',
    'conflictReason', candidate -> 'conflictReason',
    'currentName', candidate -> 'currentName',
    'resolvable', candidate -> 'resolvable',
    'startsAt', candidate -> 'startsAt',
    'endsAt', candidate -> 'endsAt',
    'endDayOffset', candidate -> 'endDayOffset',
    'sequence', candidate -> 'sequence',
    'messages', candidate -> 'messages',
    'sources', candidate -> 'sources'
  )), '[]'::jsonb)
  into normalized_master
  from jsonb_array_elements(p_master_candidates) as item(candidate);

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', candidate -> 'key',
    'modelCode', candidate -> 'modelCode',
    'lineCode', candidate -> 'lineCode',
    'processCode', candidate -> 'processCode',
    'status', candidate -> 'status',
    'approved', candidate -> 'approved',
    'proposedSecondsPerUnit', candidate -> 'proposedSecondsPerUnit',
    'approvedSecondsPerUnit', candidate -> 'approvedSecondsPerUnit',
    'minimum', candidate -> 'minimum',
    'median', candidate -> 'median',
    'maximum', candidate -> 'maximum',
    'effectiveFrom', candidate -> 'effectiveFrom',
    'effectiveTo', candidate -> 'effectiveTo',
    'messages', candidate -> 'messages',
    'observations', candidate -> 'observations'
  )), '[]'::jsonb)
  into normalized_standard_time
  from jsonb_array_elements(p_standard_time_candidates) as item(candidate);

  return private.stage_upload_candidates_validated(
    p_batch_id,
    normalized_master,
    normalized_standard_time
  );
end
$$;

revoke all on function public.stage_upload_candidates(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_upload_candidates(uuid, jsonb, jsonb)
  to authenticated;

create function public.list_reviewable_upload_batches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_profile record;
  batches jsonb;
begin
  select *
  into actor_profile
  from private.current_profile();

  if actor_id is null
    or actor_profile.profile_id is distinct from actor_id
    or not coalesce(actor_profile.profile_is_active, false)
    or actor_profile.app_role not in ('viewer', 'operator', 'admin') then
    raise exception using
      errcode = '42501',
      message = 'insufficient_privilege';
  end if;

  select coalesce(
    jsonb_agg(item.payload order by item.created_at desc, item.batch_id),
    '[]'::jsonb
  )
  into batches
  from (
    select
      batch.id as batch_id,
      batch.created_at,
      jsonb_build_object(
        'batchId', batch.id,
        'sourceFileName', left(batch.source_file_name, 255),
        'sourceSha256', batch.source_sha256,
        'workbookKind', batch.workbook_kind,
        'status', batch.status,
        'createdAt', batch.created_at
      ) as payload
    from public.upload_batches as batch
    where batch.deleted_at is null
      and batch.status in ('staged', 'validated', 'failed')
      and (
        actor_profile.app_role in ('viewer', 'admin')
        or batch.created_by = actor_id
      )
    order by batch.created_at desc, batch.id
    limit 50
  ) as item;

  return batches;
end
$$;

create function public.get_upload_batch_review(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_profile record;
  batch public.upload_batches%rowtype;
  master_candidates jsonb;
  standard_time_candidates jsonb;
  master_candidate_count bigint;
  standard_time_candidate_count bigint;
  detail_new_count bigint;
  detail_conflict_count bigint;
  detail_error_count bigint;
  detail_total bigint;
  defect_count bigint;
  candidate_payload_oversized boolean;
  candidate_nested_content_truncated boolean;
  candidate_payload_limit constant integer := 100;
  evidence_payload_limit constant integer := 20;
begin
  select *
  into actor_profile
  from private.current_profile();

  if actor_id is null
    or actor_profile.profile_id is distinct from actor_id
    or not coalesce(actor_profile.profile_is_active, false)
    or actor_profile.app_role not in ('viewer', 'operator', 'admin')
    or not private.can_view_upload_batch(p_batch_id) then
    raise exception using
      errcode = '42501',
      message = 'upload_batch_not_visible';
  end if;

  select value.*
  into batch
  from public.upload_batches as value
  where value.id = p_batch_id
    and value.deleted_at is null;

  if batch.id is null then
    raise exception using
      errcode = 'P0002',
      message = 'upload_batch_not_found';
  end if;

  select
    count(*) filter (where detail.status = 'new'),
    count(*) filter (where detail.status = 'conflict'),
    count(*) filter (where detail.status = 'error'),
    count(*),
    coalesce(sum(
      case
        when jsonb_typeof(detail.payload -> 'defects') = 'array'
          then jsonb_array_length(detail.payload -> 'defects')
        else 0
      end
    ), 0)
  into
    detail_new_count,
    detail_conflict_count,
    detail_error_count,
    detail_total,
    defect_count
  from public.upload_rows as detail
  where detail.batch_id = p_batch_id
    and detail.deleted_at is null;

  select count(*)
  into master_candidate_count
  from public.upload_master_candidates as candidate
  where candidate.batch_id = p_batch_id;

  select
    exists (
      select 1
      from public.upload_master_candidates as candidate
      where candidate.batch_id = p_batch_id
        and not private.legacy_master_candidate_payload_is_safe(
          candidate.proposed_data
        )
    )
    or exists (
      select 1
      from public.upload_standard_time_candidates as candidate
      where candidate.batch_id = p_batch_id
        and not private.legacy_standard_time_candidate_payload_is_safe(
          private.legacy_standard_time_candidate_payload(candidate)
        )
    ),
    exists (
      select 1
      from public.upload_master_candidates as candidate
      where candidate.batch_id = p_batch_id
        and (
          exists (
            select 1
            from jsonb_array_elements(candidate.messages) as message(value)
            where jsonb_typeof(message.value) <> 'string'
              or pg_column_size(message.value) > 1024
              or length(message.value #>> '{}') > 500
          )
          or exists (
            select 1
            from jsonb_array_elements(candidate.sources) as source(value)
            where jsonb_typeof(source.value) <> 'object'
              or pg_column_size(source.value) > 1024
              or length(coalesce(source.value ->> 'sheet', '')) > 200
              or not private.legacy_jsonb_number_is_safe(
                source.value -> 'row', 1, 1048576, 0, true
              )
          )
        )
    )
    or exists (
      select 1
      from public.upload_standard_time_candidates as candidate
      where candidate.batch_id = p_batch_id
        and (
          exists (
            select 1
            from jsonb_array_elements(candidate.messages) as message(value)
            where jsonb_typeof(message.value) <> 'string'
              or pg_column_size(message.value) > 1024
              or length(message.value #>> '{}') > 500
          )
          or exists (
            select 1
            from jsonb_array_elements(candidate.observations)
              as observation(value)
            where jsonb_typeof(observation.value) <> 'object'
              or pg_column_size(observation.value) > 1024
              or length(coalesce(observation.value ->> 'sheet', '')) > 200
              or not private.legacy_jsonb_number_is_safe(
                observation.value -> 'capacityQty',
                0.000001, 1000000000, 6, false
              )
              or not private.legacy_jsonb_number_is_safe(
                observation.value -> 'plannedSeconds',
                0.000001, 604800, 6, false
              )
              or not private.legacy_jsonb_number_is_safe(
                observation.value -> 'secondsPerUnit',
                0.000001, 86400, 6, false
              )
              or not private.legacy_jsonb_number_is_safe(
                observation.value -> 'row', 1, 1048576, 0, true
              )
          )
        )
    )
  into candidate_payload_oversized, candidate_nested_content_truncated;

  select coalesce(jsonb_agg(item.payload order by item.candidate_key), '[]'::jsonb)
  into master_candidates
  from (
    select
      candidate.candidate_key,
      jsonb_build_object(
        'key', left(candidate.candidate_key, 300),
        'entity', left(candidate.entity, 30),
        'code', left(candidate.normalized_code, 100),
        'parentCode', case
          when candidate.parent_code is null then null
          else left(candidate.parent_code, 100)
        end,
        'proposedName', left(
          coalesce(candidate.proposed_data ->> 'proposedName', ''),
          200
        ),
        'status', candidate.status,
        'approved', case
          when jsonb_typeof(candidate.proposed_data -> 'approved') = 'boolean'
            then candidate.proposed_data -> 'approved'
          else 'false'::jsonb
        end,
        'conflictReason', case
          when candidate.proposed_data -> 'conflictReason' is null
            or jsonb_typeof(candidate.proposed_data -> 'conflictReason') = 'null'
            then null
          else left(candidate.proposed_data ->> 'conflictReason', 100)
        end,
        'currentName', case
          when candidate.proposed_data -> 'currentName' is null
            or jsonb_typeof(candidate.proposed_data -> 'currentName') = 'null'
            then null
          else left(candidate.proposed_data ->> 'currentName', 200)
        end,
        'resolvable', case
          when jsonb_typeof(candidate.proposed_data -> 'resolvable') = 'boolean'
            then candidate.proposed_data -> 'resolvable'
          else 'false'::jsonb
        end,
        'startsAt', case
          when candidate.proposed_data -> 'startsAt' is null
            or jsonb_typeof(candidate.proposed_data -> 'startsAt') = 'null'
            then null
          else left(candidate.proposed_data ->> 'startsAt', 20)
        end,
        'endsAt', case
          when candidate.proposed_data -> 'endsAt' is null
            or jsonb_typeof(candidate.proposed_data -> 'endsAt') = 'null'
            then null
          else left(candidate.proposed_data ->> 'endsAt', 20)
        end,
        'endDayOffset', case
          when private.legacy_jsonb_number_is_safe(
            candidate.proposed_data -> 'endDayOffset', 0, 1, 0, true
          )
            then candidate.proposed_data -> 'endDayOffset'
          else 'null'::jsonb
        end,
        'sequence', case
          when private.legacy_jsonb_number_is_safe(
            candidate.proposed_data -> 'sequence', 1, 100, 0, true
          )
            then candidate.proposed_data -> 'sequence'
          else 'null'::jsonb
        end,
        'sources',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'sheet', left(coalesce(evidence.value ->> 'sheet', ''), 200),
              'row', case
                when private.legacy_jsonb_number_is_safe(
                  evidence.value -> 'row', 1, 1048576, 0, true
                )
                  then evidence.value -> 'row'
                else 'null'::jsonb
              end
            )
            order by evidence.ordinality
          )
          from jsonb_array_elements(candidate.sources)
            with ordinality as evidence(value, ordinality)
          where evidence.ordinality <= evidence_payload_limit
        ), '[]'::jsonb),
        'messages',
        coalesce((
          select jsonb_agg(
            to_jsonb(left(
              case
                when jsonb_typeof(message.value) = 'string'
                  then message.value #>> '{}'
                else '[invalid]'
              end,
              500
            ))
            order by message.ordinality
          )
          from jsonb_array_elements(candidate.messages)
            with ordinality as message(value, ordinality)
          where message.ordinality <= evidence_payload_limit
        ), '[]'::jsonb),
        'sourcesTruncated',
        jsonb_array_length(candidate.sources) > evidence_payload_limit,
        'messagesTruncated',
        jsonb_array_length(candidate.messages) > evidence_payload_limit,
        'sourceTotal', jsonb_array_length(candidate.sources),
        'messageTotal', jsonb_array_length(candidate.messages),
        'payloadOversized',
        not private.legacy_master_candidate_payload_is_safe(
          candidate.proposed_data
        ),
        'sourceElementsOversized',
        exists (
          select 1
          from jsonb_array_elements(candidate.sources) as source(value)
          where jsonb_typeof(source.value) <> 'object'
            or pg_column_size(source.value) > 1024
            or length(coalesce(source.value ->> 'sheet', '')) > 200
            or not private.legacy_jsonb_number_is_safe(
              source.value -> 'row', 1, 1048576, 0, true
            )
        ),
        'messageElementsOversized',
        exists (
          select 1
          from jsonb_array_elements(candidate.messages) as message(value)
          where jsonb_typeof(message.value) <> 'string'
            or pg_column_size(message.value) > 1024
            or length(message.value #>> '{}') > 500
        )
      ) as payload
    from public.upload_master_candidates as candidate
    where candidate.batch_id = p_batch_id
    order by candidate.candidate_key
    limit candidate_payload_limit
  ) as item;

  select count(*)
  into standard_time_candidate_count
  from public.upload_standard_time_candidates as candidate
  where candidate.batch_id = p_batch_id;

  select coalesce(jsonb_agg(item.payload order by item.candidate_key), '[]'::jsonb)
  into standard_time_candidates
  from (
    select
      candidate.candidate_key,
      jsonb_build_object(
        'key', left(candidate.candidate_key, 300),
        'modelCode', left(candidate.model_code, 100),
        'lineCode', left(candidate.line_code, 100),
        'processCode', left(candidate.process_code, 20),
        'status', left(candidate.status, 20),
        'approved', false,
        'proposedSecondsPerUnit', case
          when candidate.proposed_seconds_per_unit is null then null
          when private.legacy_jsonb_number_is_safe(
            to_jsonb(candidate.proposed_seconds_per_unit),
            0.000001, 86400, 6, false
          ) then to_jsonb(round(candidate.proposed_seconds_per_unit, 6))
          else 'null'::jsonb
        end,
        'approvedSecondsPerUnit', case
          when candidate.approved_seconds_per_unit is null then null
          when private.legacy_jsonb_number_is_safe(
            to_jsonb(candidate.approved_seconds_per_unit),
            0.000001, 86400, 6, false
          ) then to_jsonb(round(candidate.approved_seconds_per_unit, 6))
          else 'null'::jsonb
        end,
        'minimum', case
          when private.legacy_jsonb_number_is_safe(
            to_jsonb(candidate.minimum_seconds_per_unit),
            0.000001, 86400, 6, false
          ) then to_jsonb(round(candidate.minimum_seconds_per_unit, 6))
          else 'null'::jsonb
        end,
        'median', case
          when private.legacy_jsonb_number_is_safe(
            to_jsonb(candidate.median_seconds_per_unit),
            0.000001, 86400, 6, false
          ) then to_jsonb(round(candidate.median_seconds_per_unit, 6))
          else 'null'::jsonb
        end,
        'maximum', case
          when private.legacy_jsonb_number_is_safe(
            to_jsonb(candidate.maximum_seconds_per_unit),
            0.000001, 86400, 6, false
          ) then to_jsonb(round(candidate.maximum_seconds_per_unit, 6))
          else 'null'::jsonb
        end,
        'effectiveFrom', left(candidate.effective_from::text, 20),
        'effectiveTo', case
          when candidate.effective_to is null then null
          else left(candidate.effective_to::text, 20)
        end,
        'messages', coalesce((
          select jsonb_agg(
            to_jsonb(left(
              case
                when jsonb_typeof(message.value) = 'string'
                  then message.value #>> '{}'
                else '[invalid]'
              end,
              500
            ))
            order by message.ordinality
          )
          from jsonb_array_elements(candidate.messages)
            with ordinality as message(value, ordinality)
          where message.ordinality <= evidence_payload_limit
        ), '[]'::jsonb),
        'observations', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'productionDate',
              left(coalesce(evidence.value ->> 'productionDate', ''), 20),
              'shiftCode',
              left(coalesce(evidence.value ->> 'shiftCode', ''), 20),
              'timeSlotCode',
              left(coalesce(evidence.value ->> 'timeSlotCode', ''), 20),
              'capacityQty', case
                when private.legacy_jsonb_number_is_safe(
                  evidence.value -> 'capacityQty',
                  0.000001, 1000000000, 6, false
                ) then to_jsonb(round(
                  (evidence.value ->> 'capacityQty')::numeric, 6
                ))
                else 'null'::jsonb
              end,
              'plannedSeconds', case
                when private.legacy_jsonb_number_is_safe(
                  evidence.value -> 'plannedSeconds',
                  0.000001, 604800, 6, false
                ) then to_jsonb(round(
                  (evidence.value ->> 'plannedSeconds')::numeric, 6
                ))
                else 'null'::jsonb
              end,
              'secondsPerUnit', case
                when private.legacy_jsonb_number_is_safe(
                  evidence.value -> 'secondsPerUnit',
                  0.000001, 86400, 6, false
                ) then to_jsonb(round(
                  (evidence.value ->> 'secondsPerUnit')::numeric, 6
                ))
                else 'null'::jsonb
              end,
              'sheet', left(coalesce(evidence.value ->> 'sheet', ''), 200),
              'row', case
                when private.legacy_jsonb_number_is_safe(
                  evidence.value -> 'row', 1, 1048576, 0, true
                )
                  then evidence.value -> 'row'
                else 'null'::jsonb
              end
            )
            order by evidence.ordinality
          )
          from jsonb_array_elements(candidate.observations)
            with ordinality as evidence(value, ordinality)
          where evidence.ordinality <= evidence_payload_limit
        ), '[]'::jsonb),
        'messagesTruncated',
        jsonb_array_length(candidate.messages) > evidence_payload_limit,
        'observationsTruncated',
        jsonb_array_length(candidate.observations) > evidence_payload_limit,
        'observationTotal', jsonb_array_length(candidate.observations),
        'messageTotal', jsonb_array_length(candidate.messages),
        'payloadOversized',
        not private.legacy_standard_time_candidate_payload_is_safe(
          private.legacy_standard_time_candidate_payload(candidate)
        ),
        'messageElementsOversized',
        exists (
          select 1
          from jsonb_array_elements(candidate.messages) as message(value)
          where jsonb_typeof(message.value) <> 'string'
            or pg_column_size(message.value) > 1024
            or length(message.value #>> '{}') > 500
        ),
        'observationElementsOversized',
        exists (
          select 1
          from jsonb_array_elements(candidate.observations)
            as observation(value)
          where jsonb_typeof(observation.value) <> 'object'
            or pg_column_size(observation.value) > 1024
            or length(coalesce(observation.value ->> 'productionDate', '')) > 20
            or length(coalesce(observation.value ->> 'shiftCode', '')) > 20
            or length(coalesce(observation.value ->> 'timeSlotCode', '')) > 20
            or length(coalesce(observation.value ->> 'sheet', '')) > 200
            or not private.legacy_jsonb_number_is_safe(
              observation.value -> 'capacityQty',
              0.000001, 1000000000, 6, false
            )
            or not private.legacy_jsonb_number_is_safe(
              observation.value -> 'plannedSeconds',
              0.000001, 604800, 6, false
            )
            or not private.legacy_jsonb_number_is_safe(
              observation.value -> 'secondsPerUnit',
              0.000001, 86400, 6, false
            )
            or not private.legacy_jsonb_number_is_safe(
              observation.value -> 'row', 1, 1048576, 0, true
            )
        )
      ) as payload
    from public.upload_standard_time_candidates as candidate
    where candidate.batch_id = p_batch_id
    order by candidate.candidate_key
    limit candidate_payload_limit
  ) as item;

  return jsonb_build_object(
    'batchId', batch.id,
    'sourceFileName', left(batch.source_file_name, 255),
    'sourceSha256', batch.source_sha256,
    'workbookKind', batch.workbook_kind,
    'newCount', detail_new_count,
    'conflictCount', detail_conflict_count,
    'errorCount', detail_error_count,
    'unknownMasterDataCount', 0,
    'defectCount', defect_count,
    'masterCandidates', master_candidates,
    'standardTimeCandidates', standard_time_candidates,
    'masterCandidateCount', master_candidate_count,
    'standardTimeCandidateCount', standard_time_candidate_count,
    'candidatePayloadLimit', candidate_payload_limit,
    'candidateEvidenceLimit', evidence_payload_limit,
    'candidatePayloadByteLimit', 262144,
    'candidateElementByteLimit', 1024,
    'candidateTextLimit', 500,
    'candidatePayloadTruncated',
      master_candidate_count > candidate_payload_limit
      or standard_time_candidate_count > candidate_payload_limit,
    'candidatePayloadOversized', candidate_payload_oversized,
    'candidateNestedContentTruncated', candidate_nested_content_truncated,
    'masterCandidatesTruncated', master_candidate_count > candidate_payload_limit,
    'standardTimeCandidatesTruncated', standard_time_candidate_count > candidate_payload_limit,
    'stWarnings', '[]'::jsonb,
    'detailTotal', detail_total
  );
end
$$;

create function public.get_upload_candidate_evidence(
  p_batch_id uuid,
  p_candidate_type text,
  p_candidate_key text,
  p_evidence_type text,
  p_offset integer default 0,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_profile record;
  evidence jsonb;
  evidence_safe boolean;
  page_items jsonb;
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  select *
  into actor_profile
  from private.current_profile();

  if actor_id is null
    or actor_profile.profile_id is distinct from actor_id
    or not coalesce(actor_profile.profile_is_active, false)
    or actor_profile.app_role not in ('viewer', 'operator', 'admin')
    or not private.can_view_upload_batch(p_batch_id) then
    raise exception using
      errcode = '42501',
      message = 'upload_batch_not_visible';
  end if;

  if p_candidate_type = 'master'
    and p_evidence_type in ('sources', 'messages') then
    select
      case p_evidence_type
        when 'sources' then candidate.sources
        else candidate.messages
      end,
      private.legacy_master_candidate_payload_is_safe(
        candidate.proposed_data
      )
    into evidence, evidence_safe
    from public.upload_master_candidates as candidate
    where candidate.batch_id = p_batch_id
      and candidate.candidate_key = p_candidate_key;
  elsif p_candidate_type = 'standard_time'
    and p_evidence_type in ('observations', 'messages') then
    select
      case p_evidence_type
        when 'observations' then candidate.observations
        else candidate.messages
      end,
      private.legacy_standard_time_candidate_payload_is_safe(
        private.legacy_standard_time_candidate_payload(candidate)
      )
    into evidence, evidence_safe
    from public.upload_standard_time_candidates as candidate
    where candidate.batch_id = p_batch_id
      and candidate.candidate_key = p_candidate_key;
  else
    raise exception using
      errcode = '22023',
      message = 'invalid_candidate_evidence_request';
  end if;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'upload_candidate_not_found';
  end if;
  if not evidence_safe then
    raise exception using
      errcode = '22023',
      message = 'upload_candidate_review_incomplete';
  end if;

  select coalesce(jsonb_agg(
    case p_evidence_type
      when 'messages' then to_jsonb(left(item.value #>> '{}', 500))
      when 'sources' then jsonb_build_object(
        'sheet', left(coalesce(item.value ->> 'sheet', ''), 200),
        'row', item.value -> 'row'
      )
      else jsonb_build_object(
        'productionDate',
          left(coalesce(item.value ->> 'productionDate', ''), 20),
        'shiftCode', left(coalesce(item.value ->> 'shiftCode', ''), 20),
        'timeSlotCode',
          left(coalesce(item.value ->> 'timeSlotCode', ''), 20),
        'capacityQty', to_jsonb(round(
          (item.value ->> 'capacityQty')::numeric, 6
        )),
        'plannedSeconds', to_jsonb(round(
          (item.value ->> 'plannedSeconds')::numeric, 6
        )),
        'secondsPerUnit', to_jsonb(round(
          (item.value ->> 'secondsPerUnit')::numeric, 6
        )),
        'sheet', left(coalesce(item.value ->> 'sheet', ''), 200),
        'row', item.value -> 'row'
      )
    end
    order by item.ordinality
  ), '[]'::jsonb)
  into page_items
  from jsonb_array_elements(evidence)
    with ordinality as item(value, ordinality)
  where item.ordinality > safe_offset
    and item.ordinality <= safe_offset::bigint + safe_limit;

  return jsonb_build_object(
    'items', page_items,
    'total', jsonb_array_length(evidence),
    'offset', safe_offset,
    'limit', safe_limit
  );
end
$$;

revoke all on function public.list_reviewable_upload_batches()
  from public, anon, authenticated;
revoke all on function public.get_upload_batch_review(uuid)
  from public, anon, authenticated;
revoke all on function public.get_upload_candidate_evidence(
  uuid, text, text, text, integer, integer
) from public, anon, authenticated;

grant execute on function public.list_reviewable_upload_batches()
  to authenticated;
grant execute on function public.get_upload_batch_review(uuid)
  to authenticated;
grant execute on function public.get_upload_candidate_evidence(
  uuid, text, text, text, integer, integer
) to authenticated;

create function private.legacy_upload_candidate_review_is_complete(
  p_batch_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    (
      select count(*) <= 100
      from public.upload_master_candidates as candidate
      where candidate.batch_id = p_batch_id
    )
    and (
      select count(*) <= 100
      from public.upload_standard_time_candidates as candidate
      where candidate.batch_id = p_batch_id
    )
    and not exists (
      select 1
      from public.upload_master_candidates as candidate
      where candidate.batch_id = p_batch_id
        and not private.legacy_master_candidate_payload_is_safe(
          candidate.proposed_data
        )
    )
    and not exists (
      select 1
      from public.upload_standard_time_candidates as candidate
      where candidate.batch_id = p_batch_id
        and not private.legacy_standard_time_candidate_payload_is_safe(
          private.legacy_standard_time_candidate_payload(candidate)
        )
    )
$$;

revoke all on function private.legacy_upload_candidate_review_is_complete(uuid)
  from public, anon, authenticated;

alter function public.commit_upload_batch(uuid, boolean)
  set schema private;
alter function private.commit_upload_batch(uuid, boolean)
  rename to commit_upload_batch_existing_validated;
revoke all on function private.commit_upload_batch_existing_validated(
  uuid, boolean
) from public, anon, authenticated;

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
  batch_status text;
  batch_commit_result jsonb;
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

  select batch.created_by, batch.status, batch.commit_result
  into batch_owner, batch_status, batch_commit_result
  from public.upload_batches as batch
  where batch.id = p_batch_id
    and batch.deleted_at is null
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

  if batch_status = 'completed' then
    return batch_commit_result;
  end if;

  if batch_status not in ('staged', 'validated') then
    raise exception using
      errcode = '22023',
      message = 'upload_batch_not_committable';
  end if;

  if not private.legacy_upload_candidate_review_is_complete(p_batch_id) then
    raise exception using
      errcode = '22023',
      message = 'upload_candidate_review_incomplete';
  end if;

  return private.commit_upload_batch_existing_validated(
    p_batch_id,
    p_replace_conflicts
  );
end
$$;

revoke all on function public.commit_upload_batch(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.commit_upload_batch(uuid, boolean)
  to authenticated;

alter function public.commit_upload_batch_with_masters(
  uuid, boolean, jsonb, jsonb
) set schema private;
alter function private.commit_upload_batch_with_masters(
  uuid, boolean, jsonb, jsonb
) rename to commit_upload_batch_with_masters_validated;
revoke all on function private.commit_upload_batch_with_masters_validated(
  uuid, boolean, jsonb, jsonb
) from public, anon, authenticated;

create function public.commit_upload_batch_with_masters(
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
  batch public.upload_batches%rowtype;
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

  if not private.legacy_upload_candidate_review_is_complete(p_batch_id) then
    raise exception using
      errcode = '22023',
      message = 'upload_candidate_review_incomplete';
  end if;

  return private.commit_upload_batch_with_masters_validated(
    p_batch_id,
    p_replace_conflicts,
    p_master_approvals,
    p_standard_time_approvals
  );
end
$$;

revoke all on function public.commit_upload_batch_with_masters(
  uuid, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.commit_upload_batch_with_masters(
  uuid, boolean, jsonb, jsonb
) to authenticated;
