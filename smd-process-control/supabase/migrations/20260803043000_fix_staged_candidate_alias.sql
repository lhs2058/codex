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
  candidate_value jsonb;
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

  for candidate_value in
    select item.value
    from jsonb_array_elements(p_master_candidates) as item(value)
  loop
    if not private.legacy_master_candidate_payload_is_safe(candidate_value) then
      raise exception using
        errcode = '22023',
        message = 'candidate_payload_oversized';
    end if;
  end loop;

  for candidate_value in
    select item.value
    from jsonb_array_elements(p_standard_time_candidates) as item(value)
  loop
    if not private.legacy_standard_time_candidate_payload_is_safe(
      candidate_value
    ) then
      raise exception using
        errcode = '22023',
        message = 'candidate_payload_oversized';
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', item.value -> 'key',
    'entity', item.value -> 'entity',
    'code', item.value -> 'code',
    'parentCode', item.value -> 'parentCode',
    'proposedName', item.value -> 'proposedName',
    'status', item.value -> 'status',
    'approved', item.value -> 'approved',
    'conflictReason', item.value -> 'conflictReason',
    'currentName', item.value -> 'currentName',
    'resolvable', item.value -> 'resolvable',
    'startsAt', item.value -> 'startsAt',
    'endsAt', item.value -> 'endsAt',
    'endDayOffset', item.value -> 'endDayOffset',
    'sequence', item.value -> 'sequence',
    'messages', item.value -> 'messages',
    'sources', item.value -> 'sources'
  )), '[]'::jsonb)
  into normalized_master
  from jsonb_array_elements(p_master_candidates) as item(value);

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', item.value -> 'key',
    'modelCode', item.value -> 'modelCode',
    'lineCode', item.value -> 'lineCode',
    'processCode', item.value -> 'processCode',
    'status', item.value -> 'status',
    'approved', item.value -> 'approved',
    'proposedSecondsPerUnit', item.value -> 'proposedSecondsPerUnit',
    'approvedSecondsPerUnit', item.value -> 'approvedSecondsPerUnit',
    'minimum', item.value -> 'minimum',
    'median', item.value -> 'median',
    'maximum', item.value -> 'maximum',
    'effectiveFrom', item.value -> 'effectiveFrom',
    'effectiveTo', item.value -> 'effectiveTo',
    'messages', item.value -> 'messages',
    'observations', item.value -> 'observations'
  )), '[]'::jsonb)
  into normalized_standard_time
  from jsonb_array_elements(p_standard_time_candidates) as item(value);

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
