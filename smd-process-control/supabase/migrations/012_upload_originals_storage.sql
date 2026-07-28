insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'smd-upload-originals',
  'smd-upload-originals',
  false,
  52428800,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists smd_upload_originals_insert on storage.objects;
create policy smd_upload_originals_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'smd-upload-originals'
  and public.current_app_role() in ('operator', 'admin')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists smd_upload_originals_select on storage.objects;
create policy smd_upload_originals_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'smd-upload-originals'
  and (
    public.current_app_role() = 'admin'
    or (
      public.current_app_role() = 'operator'
      and (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
);
