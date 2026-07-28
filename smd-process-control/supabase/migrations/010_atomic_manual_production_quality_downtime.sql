-- Keep the public RPC signature while making manual production, quality and downtime one transaction.
create or replace function public.save_production_record(payload jsonb, expected_version bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); app_role text := public.current_app_role(); target public.production_records%rowtype; target_id uuid; requested_id uuid;
  production_day date; shift_value uuid; slot_value uuid; line_value uuid; model_value uuid; process_value uuid; input_value integer; actual_value integer; ok_value integer; ng_value integer; note_value text;
  slot_seconds numeric; downtime_total numeric := 0; item jsonb; reason_value uuid; minutes_value numeric; start_value time; end_value time; row_seconds numeric;
begin
  if actor_id is null or app_role not in ('operator','admin') then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception using errcode='22023', message='invalid_production_payload'; end if;
  begin
    requested_id := nullif(payload->>'id','')::uuid; production_day := (payload->>'production_date')::date; shift_value := (payload->>'shift_id')::uuid; slot_value := (payload->>'time_slot_id')::uuid; line_value := (payload->>'line_id')::uuid; model_value := (payload->>'model_id')::uuid; process_value := (payload->>'process_id')::uuid;
    input_value := (payload->>'input_qty')::integer; actual_value := (payload->>'actual_qty')::integer; ok_value := (payload->>'ok_qty')::integer; ng_value := (payload->>'ng_qty')::integer; note_value := coalesce(payload->>'note','');
  exception when others then raise exception using errcode='22023', message='invalid_production_payload'; end;
  if production_day is null or shift_value is null or slot_value is null or line_value is null or model_value is null or process_value is null or input_value is null or actual_value is null or ok_value is null or ng_value is null or input_value < 0 or actual_value < 0 or ok_value < 0 or ng_value < 0 or ok_value > input_value or ok_value + ng_value > input_value or length(note_value) > 1000 then raise exception using errcode='22023', message='invalid_production_payload'; end if;
  if app_role='operator' and production_day <> (now() at time zone 'Asia/Bangkok')::date then raise exception using errcode='42501',message='insufficient_privilege'; end if;
  select extract(epoch from (ends_at - starts_at + end_day_offset * interval '1 day')) into slot_seconds from public.time_slots where id=slot_value and shift_id=shift_value and is_active and deleted_at is null;
  if slot_seconds is null or slot_seconds < 0 or jsonb_typeof(coalesce(payload->'downtime','[]'::jsonb)) <> 'array' then raise exception using errcode='22023',message='invalid_production_payload'; end if;
  for item in select value from jsonb_array_elements(coalesce(payload->'downtime','[]'::jsonb)) loop
    begin reason_value := (item->>'reason_id')::uuid; minutes_value := nullif(item->>'minutes','')::numeric; start_value := nullif(item->>'start_time','')::time; end_value := nullif(item->>'end_time','')::time; exception when others then raise exception using errcode='22023',message='invalid_downtime_payload'; end;
    if reason_value is null or length(coalesce(item->>'note','')) > 1000 or ((minutes_value is not null)::integer + ((start_value is not null and end_value is not null)::integer)) <> 1 or minutes_value < 0 then raise exception using errcode='22023',message='invalid_downtime_payload'; end if;
    if minutes_value is not null then row_seconds := minutes_value*60; else row_seconds := extract(epoch from (end_value-start_value + case when end_value < start_value then interval '1 day' else interval '0' end)); end if;
    downtime_total := downtime_total + row_seconds;
  end loop;
  if downtime_total > slot_seconds then raise exception using errcode='22023',message='downtime_exceeds_planned_time'; end if;
  if requested_id is null then
    if expected_version <> 0 then raise exception using errcode='40001',message='record_version_conflict'; end if;
    insert into public.production_records(production_date,shift_id,time_slot_id,line_id,model_id,process_id,input_qty,actual_qty,note,created_by,updated_by) values(production_day,shift_value,slot_value,line_value,model_value,process_value,input_value,actual_value,note_value,actor_id,actor_id) returning id into target_id;
  else
    select * into target from public.production_records where id=requested_id and deleted_at is null for update; if not found then raise exception using errcode='P0002',message='production_record_not_found'; end if;
    if app_role <> 'admin' and (target.created_by<>actor_id or target.production_date<>(now() at time zone 'Asia/Bangkok')::date) then raise exception using errcode='42501',message='insufficient_privilege'; end if;
    if target.version<>expected_version then raise exception using errcode='40001',message='record_version_conflict'; end if;
    if (target.production_date,target.shift_id,target.time_slot_id,target.line_id,target.model_id,target.process_id) <> (production_day,shift_value,slot_value,line_value,model_value,process_value) then raise exception using errcode='22023',message='immutable_production_dimensions'; end if;
    update public.production_records set input_qty=input_value,actual_qty=actual_value,note=note_value,updated_at=now(),updated_by=actor_id,version=version+1 where id=requested_id; target_id:=requested_id;
  end if;
  update public.quality_records set deleted_at=now(),deleted_by=actor_id,updated_at=now(),updated_by=actor_id,version=version+1 where production_record_id=target_id and deleted_at is null;
  insert into public.quality_records(production_record_id,production_date,line_id,model_id,process_id,input_qty,ok_qty,ng_qty,note,created_by,updated_by) values(target_id,production_day,line_value,model_value,process_value,input_value,ok_value,ng_value,note_value,actor_id,actor_id);
  update public.downtime_records set deleted_at=now(),deleted_by=actor_id,updated_at=now(),updated_by=actor_id,version=version+1 where production_record_id=target_id and deleted_at is null;
  for item in select value from jsonb_array_elements(coalesce(payload->'downtime','[]'::jsonb)) loop insert into public.downtime_records(production_record_id,reason_id,minutes,note,created_by,updated_by) values(target_id,(item->>'reason_id')::uuid,ceil(coalesce(nullif(item->>'minutes','')::numeric, extract(epoch from ((nullif(item->>'end_time','')::time-nullif(item->>'start_time','')::time)+case when nullif(item->>'end_time','')::time < nullif(item->>'start_time','')::time then interval '1 day' else interval '0' end))/60))::integer,coalesce(item->>'note',''),actor_id,actor_id); end loop;
  insert into public.audit_logs(actor_id,table_name,record_id,action,before_data,after_data,created_by,updated_by) select actor_id,'production_records',p.id,case when requested_id is null then 'insert' else 'update' end,null,to_jsonb(p),actor_id,actor_id from public.production_records p where p.id=target_id;
  return target_id;
end; $$;
revoke all on function public.save_production_record(jsonb,bigint) from public, anon;
grant execute on function public.save_production_record(jsonb,bigint) to authenticated;
