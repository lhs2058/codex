do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'production_records'
    ) then
      alter publication supabase_realtime add table public.production_records;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'quality_records'
    ) then
      alter publication supabase_realtime add table public.quality_records;
    end if;
  end if;
end
$$;
