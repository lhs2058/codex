drop policy if exists upload_batches_active_profile_select
  on public.upload_batches;

create policy upload_batches_active_profile_select
on public.upload_batches
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1
    from private.current_profile() as caller
    where caller.profile_id = (select auth.uid())
      and caller.profile_is_active
      and caller.app_role in ('viewer', 'operator', 'admin')
      and (
        caller.app_role in ('viewer', 'admin')
        or upload_batches.created_by = caller.profile_id
      )
  )
);
