-- Audit every authenticated business mutation in the same transaction. Audit
-- rows themselves are append-only and deliberately excluded to avoid recursion.
create or replace function private.audit_business_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  action_name text;
  record uuid;
begin
  if tg_op = 'INSERT' then
    action_name := 'insert'; record := new.id;
    insert into public.audit_logs (actor_id, table_name, record_id, action, before_data, after_data, created_by, updated_by)
    values (actor, tg_table_name, record, action_name, null, to_jsonb(new), actor, actor);
    return new;
  end if;
  if tg_op = 'UPDATE' then
    action_name := case when (to_jsonb(old) ? 'deleted_at') and (to_jsonb(old)->>'deleted_at') is null and (to_jsonb(new)->>'deleted_at') is not null then 'delete' else 'update' end;
    record := new.id;
    insert into public.audit_logs (actor_id, table_name, record_id, action, before_data, after_data, created_by, updated_by)
    values (actor, tg_table_name, record, action_name, to_jsonb(old), to_jsonb(new), actor, actor);
    return new;
  end if;
  raise exception using errcode = '42501', message = 'physical_delete_not_allowed';
end;
$$;

create or replace function private.enforce_production_dimensions_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.production_date is distinct from old.production_date
    or new.shift_id is distinct from old.shift_id
    or new.time_slot_id is distinct from old.time_slot_id
    or new.line_id is distinct from old.line_id
    or new.model_id is distinct from old.model_id
    or new.process_id is distinct from old.process_id then
    raise exception using errcode = '22023', message = 'production_record_dimensions_immutable';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_upload_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  commit_mode boolean := current_setting('app.upload_commit', true) = 'on';
begin
  if tg_table_name = 'upload_batches' then
    if tg_op = 'INSERT' and new.status <> 'staged' then
      raise exception using errcode = '22023', message = 'upload_batch_invalid_initial_status';
    end if;
    if tg_op = 'UPDATE' and not commit_mode and (old.status = 'committed' or new.status is distinct from old.status) then
      raise exception using errcode = '42501', message = 'upload_batch_status_managed_by_rpc';
    end if;
  else
    if tg_op = 'UPDATE' and not commit_mode and (new.status is distinct from old.status or new.payload is distinct from old.payload or new.production_record_id is distinct from old.production_record_id) then
      raise exception using errcode = '42501', message = 'upload_row_commit_fields_managed_by_rpc';
    end if;
    if tg_op = 'UPDATE' and not commit_mode and exists (
      select 1 from public.upload_batches b where b.id = new.batch_id and b.status not in ('staged', 'validated')
    ) then
      raise exception using errcode = '42501', message = 'upload_row_not_editable';
    end if;
  end if;
  return new;
end;
$$;

revoke delete on all tables in schema public from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;
revoke update (status) on public.upload_batches from authenticated;
revoke update (status, payload, production_record_id, batch_id) on public.upload_rows from authenticated;

drop policy if exists production_records_admin_delete on public.production_records;
drop policy if exists quality_records_admin_delete on public.quality_records;
drop policy if exists defect_records_admin_delete on public.defect_records;
drop policy if exists downtime_records_admin_delete on public.downtime_records;
drop policy if exists upload_batches_admin_delete on public.upload_batches;
drop policy if exists upload_rows_admin_delete on public.upload_rows;

create trigger production_records_dimensions_immutable before update on public.production_records
  for each row execute function private.enforce_production_dimensions_immutable();
create trigger upload_batches_guard before insert or update on public.upload_batches
  for each row execute function private.enforce_upload_workflow();
create trigger upload_rows_guard before update on public.upload_rows
  for each row execute function private.enforce_upload_workflow();

drop policy if exists upload_rows_owner_or_admin_select on public.upload_rows;
create policy upload_rows_owner_or_admin_select on public.upload_rows for select to authenticated using
  (deleted_at is null and (public.current_app_role() = 'admin' or exists (
    select 1 from public.upload_batches b where b.id = batch_id and b.created_by = (select auth.uid()) and b.deleted_at is null
  )));
drop policy if exists upload_rows_owner_or_admin_update on public.upload_rows;
create policy upload_rows_owner_or_admin_update on public.upload_rows for update to authenticated using
  (deleted_at is null and (public.current_app_role() = 'admin' or exists (
    select 1 from public.upload_batches b where b.id = batch_id and b.created_by = (select auth.uid()) and b.deleted_at is null
  )))
  with check (deleted_at is null and (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and updated_by = (select auth.uid()))));

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','models','processes','lines','shifts','time_slots','downtime_reasons','yield_targets','standard_times','production_records','quality_records','defect_records','downtime_records','upload_batches','upload_rows'] loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_business_mutation()', table_name || '_audit', table_name);
  end loop;
end $$;

create or replace function public.save_production_record(payload jsonb, expected_version bigint)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := auth.uid(); app_role text := public.current_app_role(); target public.production_records%rowtype;
  requested_id uuid; production_day date; shift_value uuid; slot_value uuid; line_value uuid; model_value uuid; process_value uuid;
  input_value integer; actual_value integer; note_value text; target_id uuid;
begin
  if actor_id is null or app_role not in ('operator','admin') then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  if expected_version is null then raise exception using errcode='40001', message='record_version_conflict'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception using errcode='22023', message='invalid_production_payload'; end if;
  begin
    requested_id := nullif(payload->>'id','')::uuid; production_day := (payload->>'production_date')::date; shift_value := (payload->>'shift_id')::uuid; slot_value := (payload->>'time_slot_id')::uuid; line_value := (payload->>'line_id')::uuid; model_value := (payload->>'model_id')::uuid; process_value := (payload->>'process_id')::uuid; input_value := (payload->>'input_qty')::integer; actual_value := (payload->>'actual_qty')::integer; note_value := coalesce(payload->>'note','');
  exception when others then raise exception using errcode='22023', message='invalid_production_payload'; end;
  if production_day is null or shift_value is null or slot_value is null or line_value is null or model_value is null or process_value is null or input_value is null or actual_value is null or input_value < 0 or actual_value < 0 then raise exception using errcode='22023', message='invalid_production_payload'; end if;
  if app_role='operator' and production_day <> (now() at time zone 'Asia/Bangkok')::date then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  if requested_id is null then
    if expected_version <> 0 then raise exception using errcode='40001', message='record_version_conflict'; end if;
    insert into public.production_records(production_date,shift_id,time_slot_id,line_id,model_id,process_id,input_qty,actual_qty,note,created_by,updated_by) values(production_day,shift_value,slot_value,line_value,model_value,process_value,input_value,actual_value,note_value,actor_id,actor_id) returning id into target_id;
    return target_id;
  end if;
  select * into target from public.production_records where id=requested_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002', message='production_record_not_found'; end if;
  if app_role <> 'admin' and (target.created_by <> actor_id or target.production_date <> (now() at time zone 'Asia/Bangkok')::date) then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  if target.version <> expected_version then raise exception using errcode='40001', message='record_version_conflict'; end if;
  if production_day is distinct from target.production_date or shift_value is distinct from target.shift_id or slot_value is distinct from target.time_slot_id or line_value is distinct from target.line_id or model_value is distinct from target.model_id or process_value is distinct from target.process_id then raise exception using errcode='22023', message='production_record_dimensions_immutable'; end if;
  update public.production_records set input_qty=input_value, actual_qty=actual_value, note=note_value, updated_at=now(), updated_by=actor_id, version=version+1 where id=requested_id;
  return requested_id;
end $$;

create or replace function public.commit_upload_batch(batch_id uuid, replace_conflicts boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor_id uuid:=auth.uid(); app_role text:=public.current_app_role(); batch public.upload_batches%rowtype; staged public.upload_rows%rowtype; target public.production_records%rowtype;
  row_day date; row_shift uuid; row_slot uuid; row_line uuid; row_model uuid; row_process uuid; row_reason uuid; row_input integer; row_actual integer; row_ok integer; row_ng integer; row_downtime integer; row_note text; inserted_count integer:=0; replaced_count integer:=0; quality_id uuid;
begin
  if actor_id is null or app_role not in ('operator','admin') then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  select * into batch from public.upload_batches where id=batch_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002', message='upload_batch_not_found'; end if;
  if app_role <> 'admin' and batch.created_by <> actor_id then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  if batch.status not in ('staged','validated') then raise exception using errcode='22023', message='upload_batch_not_committable'; end if;
  if exists(select 1 from public.upload_rows where batch_id=commit_upload_batch.batch_id and deleted_at is null and status='error') then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
  if exists(select 1 from public.upload_rows where batch_id=commit_upload_batch.batch_id and deleted_at is null and status='conflict') and not replace_conflicts then raise exception using errcode='22023', message='upload_batch_has_conflicts'; end if;
  if replace_conflicts and app_role <> 'admin' then raise exception using errcode='42501', message='insufficient_privilege'; end if;
  perform set_config('app.upload_commit','on',true);
  for staged in select * from public.upload_rows where batch_id=commit_upload_batch.batch_id and deleted_at is null order by source_row,id for update loop
    if staged.status not in ('new','conflict') or jsonb_typeof(staged.payload) <> 'object' or (select array_agg(key order by key) from jsonb_object_keys(staged.payload) key) is distinct from array['actual_qty','downtime_minutes','downtime_reason_code','input_qty','line_code','model_code','ng_qty','note','ok_qty','process_code','production_date','shift_code','time_slot_code'] then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    begin
      row_day := (staged.payload->>'production_date')::date; row_input := (staged.payload->>'input_qty')::integer; row_actual := (staged.payload->>'actual_qty')::integer; row_ok := (staged.payload->>'ok_qty')::integer; row_ng := (staged.payload->>'ng_qty')::integer; row_downtime := (staged.payload->>'downtime_minutes')::integer; row_note := staged.payload->>'note';
    exception when others then raise exception using errcode='22023', message='upload_batch_has_errors'; end;
    if row_day is null or nullif(staged.payload->>'shift_code','') is null or nullif(staged.payload->>'time_slot_code','') is null or nullif(staged.payload->>'line_code','') is null or nullif(staged.payload->>'model_code','') is null or nullif(staged.payload->>'process_code','') is null or row_input is null or row_actual is null or row_ok is null or row_ng is null or row_downtime is null or row_note is null or row_input<0 or row_actual<0 or row_ok<0 or row_ng<0 or row_ok+row_ng>row_input or row_downtime<0 then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    select id into row_model from public.models where code=staged.payload->>'model_code' and is_active and deleted_at is null; select id into row_line from public.lines where code=staged.payload->>'line_code' and is_active and deleted_at is null; select id into row_process from public.processes where code=staged.payload->>'process_code' and is_active and deleted_at is null; select id into row_shift from public.shifts where code=staged.payload->>'shift_code' and is_active and deleted_at is null; select id into row_slot from public.time_slots where shift_id=row_shift and code=staged.payload->>'time_slot_code' and is_active and deleted_at is null;
    if row_model is null or row_line is null or row_process is null or row_shift is null or row_slot is null then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    if row_downtime>0 then select id into row_reason from public.downtime_reasons where code=staged.payload->>'downtime_reason_code' and is_active and deleted_at is null; if row_reason is null then raise exception using errcode='22023', message='upload_batch_has_errors'; end if; elsif (staged.payload->>'downtime_reason_code') is not null then raise exception using errcode='22023', message='upload_batch_has_errors'; end if;
    if app_role='operator' and row_day<>(now() at time zone 'Asia/Bangkok')::date then raise exception using errcode='42501', message='insufficient_privilege'; end if;
    perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',row_day,row_shift,row_slot,row_line,row_model,row_process),0));
    select * into target from public.production_records where production_date=row_day and shift_id=row_shift and time_slot_id=row_slot and line_id=row_line and model_id=row_model and process_id=row_process and deleted_at is null for update;
    if found then
      if not replace_conflicts then raise exception using errcode='22023', message='upload_batch_has_conflicts'; end if;
      update public.production_records set input_qty=row_input,actual_qty=row_actual,note=row_note,updated_at=now(),updated_by=actor_id,version=version+1 where id=target.id;
      update public.quality_records set input_qty=row_input,ok_qty=row_ok,ng_qty=row_ng,note=row_note,updated_at=now(),updated_by=actor_id,version=version+1 where production_record_id=target.id and deleted_at is null returning id into quality_id;
      if not found then insert into public.quality_records(production_record_id,production_date,line_id,model_id,process_id,input_qty,ok_qty,ng_qty,note,created_by,updated_by) values(target.id,row_day,row_line,row_model,row_process,row_input,row_ok,row_ng,row_note,actor_id,actor_id) returning id into quality_id; end if;
      replaced_count:=replaced_count+1;
    else
      insert into public.production_records(production_date,shift_id,time_slot_id,line_id,model_id,process_id,input_qty,actual_qty,note,created_by,updated_by) values(row_day,row_shift,row_slot,row_line,row_model,row_process,row_input,row_actual,row_note,actor_id,actor_id) returning id into target.id;
      insert into public.quality_records(production_record_id,production_date,line_id,model_id,process_id,input_qty,ok_qty,ng_qty,note,created_by,updated_by) values(target.id,row_day,row_line,row_model,row_process,row_input,row_ok,row_ng,row_note,actor_id,actor_id) returning id into quality_id;
      inserted_count:=inserted_count+1;
    end if;
    if row_downtime>0 then insert into public.downtime_records(production_record_id,reason_id,minutes,note,created_by,updated_by) values(target.id,row_reason,row_downtime,row_note,actor_id,actor_id); end if;
    update public.upload_rows set production_record_id=target.id,updated_at=now(),updated_by=actor_id,version=version+1 where id=staged.id;
  end loop;
  update public.upload_batches set status='committed',updated_at=now(),updated_by=actor_id,version=version+1 where id=batch.id;
  return jsonb_build_object('batch_id',batch.id,'status','committed','inserted',inserted_count,'replaced',replaced_count);
end $$;
