-- ============================================================
-- 00307: Secure customer-code change
--
-- Definition only. This migration does not update customer rows.
-- ============================================================

create or replace function public.change_customer_code_atomic(
  p_customer_id uuid,
  p_new_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_customer record;
  v_new_code text := upper(trim(coalesce(p_new_code, '')));
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);

  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'customers.edit') then
    raise exception using errcode = '42501', message = 'CUSTOMER_EDIT_PERMISSION_REQUIRED';
  end if;

  if p_customer_id is null then
    raise exception using errcode = '22023', message = 'CUSTOMER_REQUIRED';
  end if;

  if v_new_code = ''
     or length(v_new_code) > 50
     or v_new_code !~ '^[A-Z0-9][A-Z0-9_-]*$' then
    raise exception using errcode = '22023', message = 'CUSTOMER_CODE_INVALID';
  end if;

  select c.id, c.tenant_id, c.code, c.name, c.is_internal
    into v_customer
    from public.customers c
   where c.id = p_customer_id
     and c.tenant_id = v_profile.tenant_id
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'CUSTOMER_NOT_FOUND';
  end if;

  if coalesce(v_customer.is_internal, false) or v_customer.code = 'KL-VL' then
    raise exception using errcode = '42501', message = 'SYSTEM_CUSTOMER_CODE_LOCKED';
  end if;

  if v_customer.code = v_new_code then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'customer_id', v_customer.id,
      'old_code', v_customer.code,
      'new_code', v_new_code
    );
  end if;

  if exists (
    select 1
      from public.customers c
     where c.tenant_id = v_profile.tenant_id
       and c.code = v_new_code
       and c.id <> p_customer_id
  ) then
    raise exception using errcode = '23505', message = 'CUSTOMER_CODE_DUPLICATE';
  end if;

  begin
    update public.customers c
       set code = v_new_code,
           updated_at = now()
     where c.id = p_customer_id
       and c.tenant_id = v_profile.tenant_id;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'CUSTOMER_CODE_DUPLICATE';
  end;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'customer_code_changed',
    'customer',
    p_customer_id,
    jsonb_build_object('code', v_customer.code),
    jsonb_build_object('code', v_new_code, 'atomic', true)
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'customer_id', v_customer.id,
    'old_code', v_customer.code,
    'new_code', v_new_code
  );
end;
$$;

revoke all on function public.change_customer_code_atomic(uuid, text) from public, anon;
grant execute on function public.change_customer_code_atomic(uuid, text) to authenticated;

comment on function public.change_customer_code_atomic(uuid, text) is
  'Changes only customers.code after active-profile, tenant, permission, system-customer and duplicate guards; records audit_log.';

select
  to_regprocedure('public.change_customer_code_atomic(uuid,text)') is not null
    as customer_code_rpc_ok;
