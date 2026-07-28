create or replace function public.set_my_language(new_language text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = actor_id
      and profile.is_active
  ) then
    raise exception using errcode = '42501', message = 'active_profile_required';
  end if;

  if new_language is null or new_language not in ('ko', 'vi') then
    raise exception using errcode = '22023', message = 'invalid_language';
  end if;

  update public.profiles
  set language = new_language,
      updated_at = now(),
      updated_by = actor_id,
      version = version + 1
  where id = actor_id
    and is_active;

  if not found then
    raise exception using errcode = '42501', message = 'active_profile_required';
  end if;
end
$$;

revoke all on function public.set_my_language(text) from public, anon;
grant execute on function public.set_my_language(text) to authenticated;
