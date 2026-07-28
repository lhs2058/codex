create or replace function private.enforce_upload_workflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare commit_mode boolean := coalesce(current_setting('app.commit_upload_mode', true), 'off') = 'on';
begin
  if tg_table_name = 'upload_batches' then
    if tg_op = 'INSERT' and new.status not in ('staged', 'validated') then
      raise exception using errcode = '22023', message = 'upload_batch_invalid_initial_status';
    end if;
    if tg_op = 'UPDATE' and not commit_mode then
      raise exception using errcode = '42501', message = 'upload_batch_status_managed_by_rpc';
    end if;
  elsif tg_op = 'INSERT' then
    if new.status not in ('new', 'conflict', 'error') or new.production_record_id is not null or new.deleted_at is not null
      or not exists (
        select 1 from public.upload_batches b
        where b.id = new.batch_id and b.deleted_at is null and b.status in ('staged', 'validated')
          and (b.created_by = auth.uid() or public.current_app_role() = 'admin')
      ) then
      raise exception using errcode = '42501', message = 'upload_row_invalid_initial_state';
    end if;
  elsif not commit_mode then
    raise exception using errcode = '42501', message = 'upload_row_commit_fields_managed_by_rpc';
  end if;
  return new;
end;
$$;

drop trigger if exists upload_rows_guard on public.upload_rows;
create trigger upload_rows_guard before insert or update on public.upload_rows
  for each row execute function private.enforce_upload_workflow();

revoke update on public.upload_batches from authenticated;
revoke update on public.upload_rows from authenticated;

create or replace function public.commit_upload_batch(batch_id uuid, replace_conflicts boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid(); app_role text := public.current_app_role();
  batch public.upload_batches%rowtype; staged public.upload_rows%rowtype; target public.production_records%rowtype;
  row_day date; row_shift uuid; row_slot uuid; row_line uuid; row_model uuid; row_process uuid; row_reason uuid;
  row_input integer; row_actual integer; row_ok integer; row_ng integer; row_downtime integer; row_source integer; row_note text;
  inserted_count integer := 0; replaced_count integer := 0;
  expected_keys text[] := array['actualQty','downtimeMinutes','downtimeReasonCode','inputQty','lineCode','modelCode','ngQty','note','okQty','processCode','productionDate','shiftCode','sourceRow','sourceSheet','timeSlotCode'];
begin
  if actor_id is null or app_role not in ('operator','admin') then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  perform set_config('app.commit_upload_mode','on',true);
  select * into batch from public.upload_batches where id=batch_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002', message='upload_batch_not_found'; end if;
  if app_role <> 'admin' and batch.created_by <> actor_id then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  if batch.status not in ('staged','validated') then raise exception using errcode='22023', message='upload_batch_not_committable'; end if;
  if exists(select 1 from public.upload_rows where batch_id=commit_upload_batch.batch_id and deleted_at is null and status='error') then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
  if exists(select 1 from public.upload_rows where batch_id=commit_upload_batch.batch_id and deleted_at is null and status='conflict') and not replace_conflicts then raise exception using errcode='22023', message='upload_batch_has_conflicts'; end if;
  if replace_conflicts and app_role <> 'admin' then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  for staged in select * from public.upload_rows where batch_id=commit_upload_batch.batch_id and deleted_at is null order by source_row,id for update loop
    if staged.status not in ('new','conflict') or jsonb_typeof(staged.payload) <> 'object'
      or (select array_agg(key order by key) from jsonb_object_keys(staged.payload) key) is distinct from expected_keys then
      raise exception using errcode='22023', message='upload_batch_has_errors';
    end if;
    begin
      row_day := (staged.payload->>'productionDate')::date; row_source := (staged.payload->>'sourceRow')::integer; row_input := (staged.payload->>'inputQty')::integer; row_actual := (staged.payload->>'actualQty')::integer; row_ok := (staged.payload->>'okQty')::integer; row_ng := (staged.payload->>'ngQty')::integer; row_downtime := (staged.payload->>'downtimeMinutes')::integer; row_note := staged.payload->>'note';
    exception when others then raise exception using errcode='22023', message='upload_batch_has_errors'; end;
    if staged.payload->>'sourceSheet' is distinct from staged.source_sheet or row_source is distinct from staged.source_row then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    if row_day is null or nullif(staged.payload->>'shiftCode','') is null then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    if staged.payload->>'timeSlotCode' is null then raise exception using errcode='22023', message='upload_row_requires_time_slot'; end if;
    if nullif(staged.payload->>'timeSlotCode','') is null or nullif(staged.payload->>'lineCode','') is null or nullif(staged.payload->>'modelCode','') is null or nullif(staged.payload->>'processCode','') is null or row_input is null or row_actual is null or row_ok is null or row_ng is null or row_downtime is null or row_note is null or row_input<0 or row_actual<0 or row_ok<0 or row_ng<0 or row_ok+row_ng>row_input or row_downtime<0 then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    select id into row_model from public.models where code=staged.payload->>'modelCode' and is_active and deleted_at is null;
    select id into row_line from public.lines where code=staged.payload->>'lineCode' and is_active and deleted_at is null;
    select id into row_process from public.processes where code=staged.payload->>'processCode' and is_active and deleted_at is null;
    select id into row_shift from public.shifts where code=staged.payload->>'shiftCode' and is_active and deleted_at is null;
    select id into row_slot from public.time_slots where shift_id=row_shift and code=staged.payload->>'timeSlotCode' and is_active and deleted_at is null;
    if row_model is null or row_line is null or row_process is null or row_shift is null or row_slot is null then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    if row_downtime>0 then
      select id into row_reason from public.downtime_reasons where code=staged.payload->>'downtimeReasonCode' and is_active and deleted_at is null;
      if row_reason is null then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    elsif staged.payload->>'downtimeReasonCode' is not null then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    if app_role='operator' and row_day<>(now() at time zone 'Asia/Bangkok')::date then raise exception using errcode='42501', message='insufficient_privilege'; end if;
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',row_day,row_shift,row_slot,row_line,row_model,row_process),0));
    select * into target from public.production_records where production_date=row_day and shift_id=row_shift and time_slot_id=row_slot and line_id=row_line and model_id=row_model and process_id=row_process and deleted_at is null for update;
    if found then
      if not replace_conflicts then raise exception using errcode='22023', message='upload_batch_has_conflicts'; end if;
      update public.production_records set input_qty=row_input,actual_qty=row_actual,note=row_note,updated_at=now(),updated_by=actor_id,version=version+1 where id=target.id;
      update public.quality_records set deleted_at=now(),deleted_by=actor_id,updated_at=now(),updated_by=actor_id,version=version+1 where production_record_id=target.id and deleted_at is null;
      update public.downtime_records set deleted_at=now(),deleted_by=actor_id,updated_at=now(),updated_by=actor_id,version=version+1 where production_record_id=target.id and deleted_at is null;
      replaced_count:=replaced_count+1;
    else
      insert into public.production_records(production_date,shift_id,time_slot_id,line_id,model_id,process_id,input_qty,actual_qty,note,created_by,updated_by) values(row_day,row_shift,row_slot,row_line,row_model,row_process,row_input,row_actual,row_note,actor_id,actor_id) returning id into target.id;
      inserted_count:=inserted_count+1;
    end if;
    insert into public.quality_records(production_record_id,production_date,line_id,model_id,process_id,input_qty,ok_qty,ng_qty,note,created_by,updated_by) values(target.id,row_day,row_line,row_model,row_process,row_input,row_ok,row_ng,row_note,actor_id,actor_id);
    if row_downtime>0 then insert into public.downtime_records(production_record_id,reason_id,minutes,note,created_by,updated_by) values(target.id,row_reason,row_downtime,row_note,actor_id,actor_id); end if;
    update public.upload_rows set production_record_id=target.id,updated_at=now(),updated_by=actor_id,version=version+1 where id=staged.id;
  end loop;
  update public.upload_batches set status='committed',updated_at=now(),updated_by=actor_id,version=version+1 where id=batch.id;
  return jsonb_build_object('batch_id',batch.id,'status','committed','inserted',inserted_count,'replaced',replaced_count);
end $$;
