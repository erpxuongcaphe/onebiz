-- ============================================================
-- 00191: Optional contact email for staff accounts
--
-- Supabase Auth still receives an internal, non-deliverable email when a
-- staff account is created with phone only. The public profile keeps contact
-- email nullable, while phone login resolves the private Auth identity.
-- ============================================================

alter table public.profiles
  alter column email drop not null;

create or replace function public.get_email_by_phone(p_phone text)
returns text
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_normalized text;
  v_auth_email text;
begin
  v_normalized := public.normalize_phone(p_phone);

  if v_normalized is null or length(v_normalized) < 9 then
    return null;
  end if;

  select au.email
  into v_auth_email
  from public.profiles p
  join auth.users au on au.id = p.id
  where p.is_active = true
    and p.phone is not null
    and public.normalize_phone(p.phone) = v_normalized
  order by p.updated_at desc
  limit 1;

  return v_auth_email;
end;
$$;

comment on function public.get_email_by_phone(text) is
  'Resolve the private Supabase Auth email from a staff phone number. Returns NULL when no active account matches.';

revoke all on function public.get_email_by_phone(text) from public;
grant execute on function public.get_email_by_phone(text) to anon, authenticated;

notify pgrst, 'reload schema';
