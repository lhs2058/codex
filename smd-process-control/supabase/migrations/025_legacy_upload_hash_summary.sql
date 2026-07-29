-- Forward-only enhancement of completed-upload hash lookup.
-- The result deliberately excludes storage_path; callers only receive review metadata.

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
    'completedAt', batch.approved_at,
    'newCount', coalesce((batch.commit_result ->> 'newCount')::integer, count(detail.id) filter (where detail.status = 'new')),
    'conflictCount', coalesce((batch.commit_result ->> 'conflictCount')::integer, count(detail.id) filter (where detail.status = 'conflict')),
    'errorCount', coalesce((batch.commit_result ->> 'errorCount')::integer, count(detail.id) filter (where detail.status = 'error')),
    'defectCount', coalesce((batch.commit_result ->> 'defectInsertedCount')::integer, sum(
      case when jsonb_typeof(detail.payload -> 'defects') = 'array'
        then jsonb_array_length(detail.payload -> 'defects')
        else 0
      end
    ), 0),
    'detailTotal', count(detail.id)
  )
  into result_value
  from public.upload_batches as batch
  left join public.upload_rows as detail
    on detail.batch_id = batch.id
    and detail.deleted_at is null
  where batch.source_sha256 = p_source_sha256
    and batch.status = 'completed'
    and private.can_view_upload_batch(batch.id)
  group by batch.id
  order by max(batch.approved_at) desc, batch.id
  limit 1;
  return result_value;
end
$$;
