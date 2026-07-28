create schema if not exists private;

create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

revoke all on function private.current_app_role() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_app_role() to authenticated;

create or replace function public.current_app_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$ select private.current_app_role() $$;

revoke all on function public.current_app_role() from public;
grant execute on function public.current_app_role() to authenticated;

alter table public.profiles enable row level security;
alter table public.models enable row level security;
alter table public.processes enable row level security;
alter table public.lines enable row level security;
alter table public.shifts enable row level security;
alter table public.time_slots enable row level security;
alter table public.downtime_reasons enable row level security;
alter table public.yield_targets enable row level security;
alter table public.standard_times enable row level security;
alter table public.production_records enable row level security;
alter table public.quality_records enable row level security;
alter table public.defect_records enable row level security;
alter table public.downtime_records enable row level security;
alter table public.upload_batches enable row level security;
alter table public.upload_rows enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from public, anon;
grant select on public.profiles, public.models, public.processes, public.lines, public.shifts,
  public.time_slots, public.downtime_reasons, public.yield_targets, public.standard_times,
  public.production_records, public.quality_records, public.defect_records,
  public.downtime_records, public.upload_batches, public.upload_rows, public.audit_logs to authenticated;
grant insert, update, delete on public.profiles, public.models, public.processes, public.lines,
  public.shifts, public.time_slots, public.downtime_reasons, public.yield_targets,
  public.standard_times, public.production_records, public.quality_records,
  public.defect_records, public.downtime_records, public.upload_batches, public.upload_rows
  to authenticated;

create policy profiles_self_or_admin_select on public.profiles for select to authenticated
  using (public.current_app_role() = 'admin' or ((select auth.uid()) = id and is_active));
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.current_app_role() = 'admin')
  with check (public.current_app_role() = 'admin');

create policy models_active_or_admin_select on public.models for select to authenticated using
  (public.current_app_role() = 'admin' or (deleted_at is null and is_active));
create policy models_admin_write on public.models for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy processes_active_or_admin_select on public.processes for select to authenticated using
  (public.current_app_role() = 'admin' or (deleted_at is null and is_active));
create policy processes_admin_write on public.processes for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy lines_active_or_admin_select on public.lines for select to authenticated using
  (public.current_app_role() = 'admin' or (deleted_at is null and is_active));
create policy lines_admin_write on public.lines for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy shifts_active_or_admin_select on public.shifts for select to authenticated using
  (public.current_app_role() = 'admin' or (deleted_at is null and is_active));
create policy shifts_admin_write on public.shifts for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy time_slots_active_or_admin_select on public.time_slots for select to authenticated using
  (public.current_app_role() = 'admin' or (deleted_at is null and is_active));
create policy time_slots_admin_write on public.time_slots for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy downtime_reasons_active_or_admin_select on public.downtime_reasons for select to authenticated using
  (public.current_app_role() = 'admin' or (deleted_at is null and is_active));
create policy downtime_reasons_admin_write on public.downtime_reasons for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy yield_targets_active_or_admin_select on public.yield_targets for select to authenticated using
  (public.current_app_role() = 'admin' or deleted_at is null);
create policy yield_targets_admin_write on public.yield_targets for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
create policy standard_times_active_or_admin_select on public.standard_times for select to authenticated using
  (public.current_app_role() = 'admin' or deleted_at is null);
create policy standard_times_admin_write on public.standard_times for all to authenticated using
  (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');

create policy production_records_active_or_admin_select on public.production_records for select to authenticated using
  (public.current_app_role() = 'admin' or deleted_at is null);
create policy production_records_operator_insert on public.production_records for insert to authenticated with check
  (public.current_app_role() in ('operator', 'admin')
    and created_by = (select auth.uid()) and updated_by = (select auth.uid())
    and (public.current_app_role() = 'admin' or production_date = (now() at time zone 'Asia/Bangkok')::date));
create policy production_records_operator_today_update on public.production_records for update to authenticated using
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and production_date = (now() at time zone 'Asia/Bangkok')::date and deleted_at is null))
  with check
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and updated_by = (select auth.uid()) and production_date = (now() at time zone 'Asia/Bangkok')::date and deleted_at is null));
create policy production_records_admin_delete on public.production_records for delete to authenticated using
  (public.current_app_role() = 'admin');

create policy quality_records_active_or_admin_select on public.quality_records for select to authenticated using
  (public.current_app_role() = 'admin' or deleted_at is null);
create policy quality_records_operator_insert on public.quality_records for insert to authenticated with check
  (public.current_app_role() in ('operator', 'admin') and created_by = (select auth.uid()) and updated_by = (select auth.uid())
    and (public.current_app_role() = 'admin' or production_date = (now() at time zone 'Asia/Bangkok')::date));
create policy quality_records_operator_today_update on public.quality_records for update to authenticated using
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and production_date = (now() at time zone 'Asia/Bangkok')::date and deleted_at is null))
  with check
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and updated_by = (select auth.uid()) and production_date = (now() at time zone 'Asia/Bangkok')::date and deleted_at is null));
create policy quality_records_admin_delete on public.quality_records for delete to authenticated using (public.current_app_role() = 'admin');

create policy defect_records_active_or_admin_select on public.defect_records for select to authenticated using
  (public.current_app_role() = 'admin' or deleted_at is null);
create policy defect_records_operator_insert on public.defect_records for insert to authenticated with check
  (public.current_app_role() in ('operator', 'admin') and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy defect_records_operator_today_update on public.defect_records for update to authenticated using
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and exists (select 1 from public.quality_records q where q.id = quality_record_id and q.production_date = (now() at time zone 'Asia/Bangkok')::date)))
  with check
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and updated_by = (select auth.uid())
    and exists (select 1 from public.quality_records q where q.id = quality_record_id and q.production_date = (now() at time zone 'Asia/Bangkok')::date)));
create policy defect_records_admin_delete on public.defect_records for delete to authenticated using (public.current_app_role() = 'admin');

create policy downtime_records_active_or_admin_select on public.downtime_records for select to authenticated using
  (public.current_app_role() = 'admin' or deleted_at is null);
create policy downtime_records_operator_insert on public.downtime_records for insert to authenticated with check
  (public.current_app_role() in ('operator', 'admin') and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy downtime_records_operator_today_update on public.downtime_records for update to authenticated using
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and exists (select 1 from public.production_records p where p.id = production_record_id and p.production_date = (now() at time zone 'Asia/Bangkok')::date)))
  with check
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and updated_by = (select auth.uid())
    and exists (select 1 from public.production_records p where p.id = production_record_id and p.production_date = (now() at time zone 'Asia/Bangkok')::date)));
create policy downtime_records_admin_delete on public.downtime_records for delete to authenticated using (public.current_app_role() = 'admin');

create policy upload_batches_owner_or_admin_select on public.upload_batches for select to authenticated using
  (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and deleted_at is null));
create policy upload_batches_operator_insert on public.upload_batches for insert to authenticated with check
  (public.current_app_role() in ('operator', 'admin') and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
create policy upload_batches_owner_or_admin_update on public.upload_batches for update to authenticated using
  (public.current_app_role() = 'admin' or created_by = (select auth.uid()))
  with check (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and updated_by = (select auth.uid())));
create policy upload_batches_admin_delete on public.upload_batches for delete to authenticated using (public.current_app_role() = 'admin');
create policy upload_rows_owner_or_admin_select on public.upload_rows for select to authenticated using
  (public.current_app_role() = 'admin' or exists (select 1 from public.upload_batches b where b.id = batch_id and b.created_by = (select auth.uid()) and b.deleted_at is null));
create policy upload_rows_operator_insert on public.upload_rows for insert to authenticated with check
  (public.current_app_role() in ('operator', 'admin') and created_by = (select auth.uid()) and updated_by = (select auth.uid())
    and exists (select 1 from public.upload_batches b where b.id = batch_id and (b.created_by = (select auth.uid()) or public.current_app_role() = 'admin')));
create policy upload_rows_owner_or_admin_update on public.upload_rows for update to authenticated using
  (public.current_app_role() = 'admin' or exists (select 1 from public.upload_batches b where b.id = batch_id and b.created_by = (select auth.uid())))
  with check (public.current_app_role() = 'admin' or (created_by = (select auth.uid()) and updated_by = (select auth.uid())));
create policy upload_rows_admin_delete on public.upload_rows for delete to authenticated using (public.current_app_role() = 'admin');

create policy audit_logs_admin_select on public.audit_logs for select to authenticated using (public.current_app_role() = 'admin');
create policy audit_logs_admin_write on public.audit_logs for all to authenticated using (public.current_app_role() = 'admin') with check (public.current_app_role() = 'admin');
