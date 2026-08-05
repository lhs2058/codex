drop policy if exists upload_batches_active_profile_select
  on public.upload_batches;

create policy upload_batches_active_profile_select
on public.upload_batches
for select
to authenticated
using (
  deleted_at is null
  and public.current_app_role() in ('viewer', 'operator', 'admin')
  and (
    public.current_app_role() in ('viewer', 'admin')
    or upload_batches.created_by = (select auth.uid())
  )
);
