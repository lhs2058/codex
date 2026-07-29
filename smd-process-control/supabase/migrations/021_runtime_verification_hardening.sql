-- Runtime verification found two edge cases after migrations 001-020 had
-- already been applied to the isolated project. Keep the original functions
-- as private implementation entrypoints and expose hardened wrappers so both
-- existing and fresh installations receive the same behavior.

alter function public.save_production_record(jsonb, bigint)
  rename to save_production_record_v20_impl;

revoke all on function public.save_production_record_v20_impl(jsonb, bigint)
  from public, anon, authenticated;

create function public.save_production_record(
  payload jsonb,
  expected_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  downtime_item jsonb;
  start_value time;
  end_value time;
begin
  if payload is not null
    and jsonb_typeof(coalesce(payload -> 'downtime', '[]'::jsonb)) = 'array'
  then
    for downtime_item in
      select item.value
      from jsonb_array_elements(
        coalesce(payload -> 'downtime', '[]'::jsonb)
      ) as item(value)
    loop
      begin
        start_value := nullif(downtime_item ->> 'start_time', '')::time;
        end_value := nullif(downtime_item ->> 'end_time', '')::time;
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = 'invalid_downtime_payload';
      end;

      if (
        start_value is not null
        and extract(second from start_value) <> 0
      ) or (
        end_value is not null
        and extract(second from end_value) <> 0
      ) then
        raise exception using
          errcode = '22023',
          message = 'invalid_downtime_duration';
      end if;
    end loop;
  end if;

  return public.save_production_record_v20_impl(
    payload,
    expected_version
  );
end
$$;

revoke all on function public.save_production_record(jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.save_production_record(jsonb, bigint)
  to authenticated;

alter function public.commit_upload_batch(uuid, boolean)
  rename to commit_upload_batch_v20_impl;

revoke all on function public.commit_upload_batch_v20_impl(uuid, boolean)
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
  result_row jsonb;
begin
  result_row := public.commit_upload_batch_v20_impl(
    p_batch_id,
    p_replace_conflicts
  );

  perform set_config('app.commit_upload_mode', 'off', true);
  return result_row;
end
$$;

revoke all on function public.commit_upload_batch(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.commit_upload_batch(uuid, boolean)
  to authenticated;
