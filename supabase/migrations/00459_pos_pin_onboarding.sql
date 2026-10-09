-- Only the server may reset a PIN after verifying the account password.
-- No existing PIN, order, receipt or stock is changed by applying this migration.
alter table public.profiles add column if not exists pos_pin_reset_required boolean not null default false;
-- Managers request a reset; the employee chooses the new PIN personally.
revoke all on function public.set_user_pos_pin(uuid,text) from public,anon,authenticated;
grant execute on function public.set_user_pos_pin(uuid,text) to service_role;
create or replace function public.reset_my_pos_pin_after_password_00459(p_user_id uuid, p_new_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_profile record;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'SERVER_ONLY'; end if;
  if p_new_pin is null or p_new_pin !~ '^[0-9]{6}$' then raise exception 'INVALID_PIN_FORMAT'; end if;
  select id, tenant_id, is_active into v_profile from public.profiles where id = p_user_id for update;
  if not found or not v_profile.is_active then raise exception 'USER_INACTIVE'; end if;
  update public.profiles set pos_pin_hash = public.hash_pos_pin(p_new_pin), pos_pin_set_at = now(),
    pos_pin_set_by = p_user_id, pos_pin_failed_attempts = 0, pos_pin_locked_until = null, pos_pin_reset_required = false, updated_at = now()
    where id = p_user_id;
  insert into public.audit_log(tenant_id, user_id, action, entity_type, entity_id, new_data)
    values(v_profile.tenant_id, p_user_id, 'reset_pos_pin_self', 'user', p_user_id,
      jsonb_build_object('verified_by', 'account_password', 'changed_at', now()));
  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.reset_my_pos_pin_after_password_00459(uuid,text) from public, anon, authenticated;
grant execute on function public.reset_my_pos_pin_after_password_00459(uuid,text) to service_role;

create or replace function public.change_my_pos_pin_00459(p_old_pin text, p_new_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb;
begin
  perform 1 from public.profiles where id=auth.uid() for update;
  result := public.change_my_pos_pin(p_old_pin,p_new_pin);
  update public.profiles set pos_pin_reset_required=false where id=auth.uid();
  return result;
end;
$$;
create or replace function public.request_pos_pin_reset_00459(p_target_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare result jsonb; actor_tenant uuid;
begin
  select tenant_id into actor_tenant from public.profiles where id=auth.uid() and is_active;
  if actor_tenant is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.profiles where id=p_target_user_id and tenant_id=actor_tenant and is_active for update;
  if not found then raise exception 'TARGET_USER_DENIED'; end if;
  -- Existing RPC checks actor authority and the target tenant before modifying.
  result := public.remove_user_pos_pin(p_target_user_id);
  update public.profiles set pos_pin_reset_required=true where id=p_target_user_id and tenant_id=actor_tenant;
  return result;
end;
$$;
create or replace function public.pos_pin_statuses_00459()
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare actor uuid:=auth.uid(); tenant uuid; result jsonb;
begin
  select tenant_id into tenant from profiles where id=actor and is_active;
  if tenant is null or not public.user_has_permission(actor,'system.manage_users') then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'hasPin',pos_pin_hash is not null,'resetRequired',pos_pin_reset_required)),'[]'::jsonb)
    into result from profiles where tenant_id=tenant;
  return result;
end;
$$;
revoke all on function public.change_my_pos_pin_00459(text,text),public.request_pos_pin_reset_00459(uuid),public.pos_pin_statuses_00459() from public,anon;
grant execute on function public.change_my_pos_pin_00459(text,text),public.request_pos_pin_reset_00459(uuid),public.pos_pin_statuses_00459() to authenticated;
notify pgrst, 'reload schema';
