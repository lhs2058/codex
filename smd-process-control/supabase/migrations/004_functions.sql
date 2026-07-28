create or replace function public.save_production_record(payload jsonb, expected_version bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  app_role text := public.current_app_role();
  target public.production_records%rowtype;
  target_id uuid;
  requested_id uuid;
  production_day date;
  shift_value uuid;
  slot_value uuid;
  line_value uuid;
  model_value uuid;
  process_value uuid;
  input_value integer;
  actual_value integer;
  note_value text;
begin
  if actor_id is null or app_role not in ('operator', 'admin') then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_production_payload';
  end if;

  begin
    requested_id := nullif(payload ->> 'id', '')::uuid;
    production_day := (payload ->> 'production_date')::date;
    shift_value := (payload ->> 'shift_id')::uuid;
    slot_value := (payload ->> 'time_slot_id')::uuid;
    line_value := (payload ->> 'line_id')::uuid;
    model_value := (payload ->> 'model_id')::uuid;
    process_value := (payload ->> 'process_id')::uuid;
    input_value := (payload ->> 'input_qty')::integer;
    actual_value := (payload ->> 'actual_qty')::integer;
    note_value := coalesce(payload ->> 'note', '');
  exception when others then
    raise exception using errcode = '22023', message = 'invalid_production_payload';
  end;
  if production_day is null or shift_value is null or slot_value is null or line_value is null
     or model_value is null or process_value is null or input_value is null or actual_value is null
     or input_value < 0 or actual_value < 0 then
    raise exception using errcode = '22023', message = 'invalid_production_payload';
  end if;
  if app_role = 'operator' and production_day <> (now() at time zone 'Asia/Bangkok')::date then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;

  if requested_id is null then
    if expected_version <> 0 then
      raise exception using errcode = '40001', message = 'record_version_conflict';
    end if;
    insert into public.production_records (
      production_date, shift_id, time_slot_id, line_id, model_id, process_id, input_qty, actual_qty, note,
      created_by, updated_by
    ) values (
      production_day, shift_value, slot_value, line_value, model_value, process_value, input_value, actual_value, note_value,
      actor_id, actor_id
    ) returning id into target_id;
    insert into public.audit_logs (actor_id, table_name, record_id, action, before_data, after_data, created_by, updated_by)
      select actor_id, 'production_records', p.id, 'insert', null, to_jsonb(p), actor_id, actor_id
      from public.production_records p where p.id = target_id;
    return target_id;
  end if;

  select * into target from public.production_records where id = requested_id and deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'production_record_not_found';
  end if;
  if app_role <> 'admin' and (target.created_by <> actor_id or target.production_date <> (now() at time zone 'Asia/Bangkok')::date) then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;
  if target.version <> expected_version then
    raise exception using errcode = '40001', message = 'record_version_conflict';
  end if;
  update public.production_records
  set production_date = production_day, shift_id = shift_value, time_slot_id = slot_value,
      line_id = line_value, model_id = model_value, process_id = process_value,
      input_qty = input_value, actual_qty = actual_value, note = note_value,
      updated_at = now(), updated_by = actor_id, version = version + 1
  where id = requested_id;
  insert into public.audit_logs (actor_id, table_name, record_id, action, before_data, after_data, created_by, updated_by)
    select actor_id, 'production_records', p.id, 'update', to_jsonb(target), to_jsonb(p), actor_id, actor_id
    from public.production_records p where p.id = requested_id;
  return requested_id;
end;
$$;

create or replace function public.commit_upload_batch(batch_id uuid, replace_conflicts boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  app_role text := public.current_app_role();
  batch public.upload_batches%rowtype;
  staged public.upload_rows%rowtype;
  target public.production_records%rowtype;
  inserted_count integer := 0;
  replaced_count integer := 0;
  row_day date;
  row_shift uuid;
  row_slot uuid;
  row_line uuid;
  row_model uuid;
  row_process uuid;
  row_input integer;
  row_actual integer;
  row_note text;
begin
  if actor_id is null or app_role not in ('operator', 'admin') then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;
  select * into batch from public.upload_batches where id = batch_id and deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'upload_batch_not_found';
  end if;
  if app_role <> 'admin' and batch.created_by <> actor_id then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;
  if batch.status not in ('staged', 'validated') then
    raise exception using errcode = '22023', message = 'upload_batch_not_committable';
  end if;
  if exists (select 1 from public.upload_rows where batch_id = commit_upload_batch.batch_id and deleted_at is null and status = 'error') then
    raise exception using errcode = '22023', message = 'upload_batch_has_errors';
  end if;
  if exists (select 1 from public.upload_rows where batch_id = commit_upload_batch.batch_id and deleted_at is null and status = 'conflict') and not replace_conflicts then
    raise exception using errcode = '22023', message = 'upload_batch_has_conflicts';
  end if;
  if replace_conflicts and app_role <> 'admin' then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;

  for staged in select * from public.upload_rows where batch_id = commit_upload_batch.batch_id and deleted_at is null order by source_row, id for update loop
    if staged.status not in ('new', 'conflict') or jsonb_typeof(staged.payload) <> 'object' then
      raise exception using errcode = '22023', message = 'upload_batch_has_errors';
    end if;
    begin
      row_day := (staged.payload ->> 'production_date')::date;
      row_shift := (staged.payload ->> 'shift_id')::uuid;
      row_slot := (staged.payload ->> 'time_slot_id')::uuid;
      row_line := (staged.payload ->> 'line_id')::uuid;
      row_model := (staged.payload ->> 'model_id')::uuid;
      row_process := (staged.payload ->> 'process_id')::uuid;
      row_input := (staged.payload ->> 'input_qty')::integer;
      row_actual := (staged.payload ->> 'actual_qty')::integer;
      row_note := coalesce(staged.payload ->> 'note', '');
    exception when others then
      raise exception using errcode = '22023', message = 'upload_batch_has_errors';
    end;
    if row_day is null or row_shift is null or row_slot is null or row_line is null or row_model is null or row_process is null
       or row_input is null or row_actual is null or row_input < 0 or row_actual < 0 then
      raise exception using errcode = '22023', message = 'upload_batch_has_errors';
    end if;
    if app_role = 'operator' and row_day <> (now() at time zone 'Asia/Bangkok')::date then
      raise exception using errcode = '42501', message = 'insufficient_privilege';
    end if;
    select * into target from public.production_records
      where production_date = row_day and shift_id = row_shift and time_slot_id = row_slot and line_id = row_line
        and model_id = row_model and process_id = row_process and deleted_at is null for update;
    if found then
      if not replace_conflicts then
        raise exception using errcode = '22023', message = 'upload_batch_has_conflicts';
      end if;
      update public.production_records set input_qty = row_input, actual_qty = row_actual, note = row_note,
        updated_at = now(), updated_by = actor_id, version = version + 1 where id = target.id;
      insert into public.audit_logs (actor_id, table_name, record_id, action, before_data, after_data, created_by, updated_by)
        select actor_id, 'production_records', p.id, 'update', to_jsonb(target), to_jsonb(p), actor_id, actor_id
        from public.production_records p where p.id = target.id;
      update public.upload_rows set production_record_id = target.id, updated_at = now(), updated_by = actor_id, version = version + 1 where id = staged.id;
      replaced_count := replaced_count + 1;
    else
      insert into public.production_records (production_date, shift_id, time_slot_id, line_id, model_id, process_id, input_qty, actual_qty, note, created_by, updated_by)
      values (row_day, row_shift, row_slot, row_line, row_model, row_process, row_input, row_actual, row_note, actor_id, actor_id)
      returning id into target.id;
      insert into public.audit_logs (actor_id, table_name, record_id, action, before_data, after_data, created_by, updated_by)
        select actor_id, 'production_records', p.id, 'insert', null, to_jsonb(p), actor_id, actor_id from public.production_records p where p.id = target.id;
      update public.upload_rows set production_record_id = target.id, updated_at = now(), updated_by = actor_id, version = version + 1 where id = staged.id;
      inserted_count := inserted_count + 1;
    end if;
  end loop;
  update public.upload_batches set status = 'committed', updated_at = now(), updated_by = actor_id, version = version + 1 where id = batch.id;
  insert into public.audit_logs (actor_id, table_name, record_id, action, before_data, after_data, created_by, updated_by)
    select actor_id, 'upload_batches', b.id, 'update', to_jsonb(batch), to_jsonb(b), actor_id, actor_id from public.upload_batches b where b.id = batch.id;
  return jsonb_build_object('batch_id', batch.id, 'status', 'committed', 'inserted', inserted_count, 'replaced', replaced_count);
end;
$$;

revoke all on function public.save_production_record(jsonb, bigint) from public, anon;
revoke all on function public.commit_upload_batch(uuid, boolean) from public, anon;
grant execute on function public.save_production_record(jsonb, bigint) to authenticated;
grant execute on function public.commit_upload_batch(uuid, boolean) to authenticated;
