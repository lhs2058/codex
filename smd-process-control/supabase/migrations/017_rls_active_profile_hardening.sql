-- PostgreSQL permissive policies are ORed. Remove every cumulative SELECT
-- policy before recreating them so no legacy "active row" predicate can turn
-- NULL app roles into readable rows through NULL OR TRUE.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'profiles',
        'models',
        'processes',
        'lines',
        'shifts',
        'time_slots',
        'downtime_reasons',
        'yield_targets',
        'standard_times',
        'production_records',
        'quality_records',
        'defect_records',
        'downtime_records',
        'upload_batches',
        'upload_rows',
        'audit_logs'
      ])
      and cmd = 'SELECT'
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

create policy profiles_active_profile_select on public.profiles for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or id = (select auth.uid())
    )
  );

create policy models_active_profile_select on public.models for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (is_active and deleted_at is null)
    )
  );

create policy processes_active_profile_select on public.processes for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (is_active and deleted_at is null)
    )
  );

create policy lines_active_profile_select on public.lines for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (is_active and deleted_at is null)
    )
  );

create policy shifts_active_profile_select on public.shifts for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (is_active and deleted_at is null)
    )
  );

create policy time_slots_active_profile_select on public.time_slots for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (is_active and deleted_at is null)
    )
  );

create policy downtime_reasons_active_profile_select on public.downtime_reasons for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (is_active and deleted_at is null)
    )
  );

create policy yield_targets_active_profile_select on public.yield_targets for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or deleted_at is null
    )
  );

create policy standard_times_active_profile_select on public.standard_times for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or deleted_at is null
    )
  );

create policy production_records_active_profile_select on public.production_records for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or deleted_at is null
    )
  );

create policy quality_records_active_profile_select on public.quality_records for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or deleted_at is null
    )
  );

create policy defect_records_active_profile_select on public.defect_records for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or deleted_at is null
    )
  );

create policy downtime_records_active_profile_select on public.downtime_records for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or deleted_at is null
    )
  );

create policy upload_batches_active_profile_select on public.upload_batches for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (
        created_by = (select auth.uid())
        and deleted_at is null
      )
    )
  );

create policy upload_rows_active_profile_select on public.upload_rows for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and (
      public.current_app_role() = 'admin'
      or (
        deleted_at is null
        and exists (
          select 1
          from public.upload_batches as batch_row
          where batch_row.id = batch_id
            and batch_row.created_by = (select auth.uid())
            and batch_row.deleted_at is null
        )
      )
    )
  );

create policy audit_logs_active_admin_select on public.audit_logs for select to authenticated
  using (
    public.current_app_role() in ('viewer', 'operator', 'admin')
    and public.current_app_role() = 'admin'
  );

-- Master/profile mutations are now RPC-only so optimistic locks and audit actor
-- assignment cannot be bypassed by a direct PostgREST table write.
revoke insert, update, delete on public.profiles from authenticated;
revoke insert, update, delete on public.models, public.processes, public.lines,
  public.shifts, public.time_slots, public.downtime_reasons,
  public.yield_targets, public.standard_times
  from authenticated;

drop policy if exists smd_upload_originals_insert on storage.objects;
create policy smd_upload_originals_insert
on storage.objects
for insert
to authenticated
with check (
  public.current_app_role() in ('operator', 'admin')
  and bucket_id = 'smd-upload-originals'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists smd_upload_originals_select on storage.objects;
create policy smd_upload_originals_select
on storage.objects
for select
to authenticated
using (
  public.current_app_role() in ('viewer', 'operator', 'admin')
  and bucket_id = 'smd-upload-originals'
  and (
    public.current_app_role() = 'admin'
    or (
      public.current_app_role() = 'operator'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
);
