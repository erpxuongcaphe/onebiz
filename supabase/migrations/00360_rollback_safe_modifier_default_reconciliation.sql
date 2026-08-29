-- 00360 rollback restores the stricter 00349 trigger behavior. It does not
-- recreate duplicate defaults removed by 00360 because that state is invalid.

begin;

create or replace function public.enforce_modifier_option_integrity_00347()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_group_rule text;
  v_tenant_id uuid;
begin
  select g.rule, g.tenant_id
    into v_group_rule, v_tenant_id
    from public.modifier_groups g
   where g.id = new.group_id
   for update;

  if not found then
    raise exception 'MODIFIER_GROUP_NOT_FOUND'
      using errcode = '23503';
  end if;

  if not new.is_active then
    return new;
  end if;

  if new.scale_factor is not null and new.linked_product_id is not null then
    raise exception 'MODIFIER_OPTION_STOCK_EFFECT_CONFLICT'
      using errcode = '23514',
            detail = 'Use either scale_factor for a BOM line or linked_product_id for direct stock consumption.';
  end if;

  if new.scale_factor is not null and new.scale_factor < 0 then
    raise exception 'MODIFIER_OPTION_SCALE_FACTOR_NEGATIVE'
      using errcode = '23514';
  end if;

  if new.linked_product_id is not null
     and not exists (
       select 1 from public.products p
       where p.id = new.linked_product_id and p.tenant_id = v_tenant_id
     ) then
    raise exception 'MODIFIER_OPTION_LINKED_PRODUCT_TENANT_MISMATCH'
      using errcode = '23503';
  end if;

  if new.is_default and v_group_rule in ('single', 'single_required') then
    update public.modifier_options o
       set is_default = false, updated_at = now()
     where o.group_id = new.group_id
       and o.id is distinct from new.id
       and o.is_active and o.is_default;
  end if;

  return new;
end;
$function$;

alter function public.enforce_modifier_option_integrity_00347() owner to postgres;
revoke all on function public.enforce_modifier_option_integrity_00347()
  from public, anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
