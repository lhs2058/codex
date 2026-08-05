-- SQLSTATE 40001 is reserved for transient serialization failures. The hosted
-- Data API retries it inside the request, which turns an expected optimistic
-- version conflict into a long-running write. Expose the conflict as a stable
-- HTTP 409 at the public boundary while retaining the existing implementation.

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
exception
  when serialization_failure then
    if sqlerrm = 'record_version_conflict' then
      raise exception using
        errcode = 'PT409',
        message = 'record_version_conflict';
    end if;
    raise;
end
$$;

revoke all on function public.save_production_record(jsonb, bigint)
  from public, anon, authenticated;
grant execute on function public.save_production_record(jsonb, bigint)
  to authenticated;
