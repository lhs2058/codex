create or replace function private.retire_quality_defects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.defect_records
    set deleted_at = new.deleted_at,
        deleted_by = coalesce(new.deleted_by, auth.uid()),
        updated_at = now(),
        updated_by = coalesce(new.updated_by, auth.uid()),
        version = version + 1
    where quality_record_id = old.id and deleted_at is null;
  end if;
  return new;
end;
$$;

create trigger quality_records_retire_defects
before update on public.quality_records
for each row execute function private.retire_quality_defects();
