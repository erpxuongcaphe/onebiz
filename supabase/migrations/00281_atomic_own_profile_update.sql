-- ============================================================
-- 00281: Atomic own-profile update
-- ============================================================
-- Definition only. Existing profile rows are not changed.

create or replace function public.update_own_profile_atomic(
  p_full_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old record;
  v_saved record;
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if v_name is null or length(v_name) > 160 then
    raise exception using errcode = '22023', message = 'FULL_NAME_INVALID';
  end if;
  if v_phone is null or length(v_phone) > 32 then
    raise exception using errcode = '22023', message = 'PHONE_INVALID';
  end if;
  select p.* into v_old
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true)
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  update public.profiles p
     set full_name = v_name, phone = v_phone, updated_at = now()
   where p.id = v_actor and p.tenant_id = v_old.tenant_id
  returning * into v_saved;
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_old.tenant_id, v_actor, 'update_profile', 'user', v_actor,
    jsonb_build_object('full_name', v_old.full_name, 'phone', v_old.phone),
    jsonb_build_object('full_name', v_saved.full_name, 'phone', v_saved.phone, 'atomic', true)
  );
  return jsonb_build_object(
    'id', v_saved.id, 'full_name', v_saved.full_name, 'phone', v_saved.phone
  );
end;
$$;

revoke all on function public.update_own_profile_atomic(text, text) from public, anon;
grant execute on function public.update_own_profile_atomic(text, text) to authenticated;

select to_regprocedure('public.update_own_profile_atomic(text,text)') is not null
  as update_own_profile_atomic_ok;
