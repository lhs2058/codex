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
        'sourceFileName', batch.source_file_name,
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
  detail_new_count bigint;
  detail_conflict_count bigint;
  detail_error_count bigint;
  detail_total bigint;
  defect_count bigint;
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

  select coalesce(
    jsonb_agg(candidate.proposed_data order by candidate.candidate_key),
    '[]'::jsonb
  )
  into master_candidates
  from public.upload_master_candidates as candidate
  where candidate.batch_id = p_batch_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', candidate.candidate_key,
        'modelCode', candidate.model_code,
        'lineCode', candidate.line_code,
        'processCode', candidate.process_code,
        'status', candidate.status,
        'approved', false,
        'proposedSecondsPerUnit', candidate.proposed_seconds_per_unit,
        'approvedSecondsPerUnit', candidate.approved_seconds_per_unit,
        'minimum', candidate.minimum_seconds_per_unit,
        'median', candidate.median_seconds_per_unit,
        'maximum', candidate.maximum_seconds_per_unit,
        'effectiveFrom', candidate.effective_from,
        'effectiveTo', candidate.effective_to,
        'messages', candidate.messages,
        'observations', candidate.observations
      )
      order by candidate.candidate_key
    ),
    '[]'::jsonb
  )
  into standard_time_candidates
  from public.upload_standard_time_candidates as candidate
  where candidate.batch_id = p_batch_id;

  return jsonb_build_object(
    'batchId', batch.id,
    'sourceFileName', batch.source_file_name,
    'sourceSha256', batch.source_sha256,
    'workbookKind', batch.workbook_kind,
    'newCount', detail_new_count,
    'conflictCount', detail_conflict_count,
    'errorCount', detail_error_count,
    'unknownMasterDataCount', 0,
    'defectCount', defect_count,
    'masterCandidates', master_candidates,
    'standardTimeCandidates', standard_time_candidates,
    'masterCandidateCount', jsonb_array_length(master_candidates),
    'standardTimeCandidateCount', jsonb_array_length(standard_time_candidates),
    'stWarnings', '[]'::jsonb,
    'detailTotal', detail_total
  );
end
$$;

revoke all on function public.list_reviewable_upload_batches()
  from public, anon, authenticated;
revoke all on function public.get_upload_batch_review(uuid)
  from public, anon, authenticated;

grant execute on function public.list_reviewable_upload_batches()
  to authenticated;
grant execute on function public.get_upload_batch_review(uuid)
  to authenticated;
