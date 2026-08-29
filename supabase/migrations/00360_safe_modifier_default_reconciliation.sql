-- 00360: Let a legacy-invalid modifier option be healed one field at a time.
--
-- 00359 only clears duplicate is_default flags. Some old active options also
-- contain both scale_factor and linked_product_id, so the 00349 trigger blocks
-- even that harmless true -> false default cleanup. Keep every stock-effect
-- guard, but permit the narrow operation of unsetting a default while all
-- guarded stock fields remain unchanged. Then rerun the duplicate cleanup.

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

  -- Retiring an option is always a safe way to remove legacy-invalid data.
  if not new.is_active then
    return new;
  end if;

  -- Narrow healing path: only remove a default flag. This does not alter how
  -- the option consumes stock and lets 00359/this migration reconcile old
  -- duplicate defaults without disabling the trigger for concurrent writes.
  if tg_op = 'UPDATE'
     and old.is_default
     and not new.is_default
     and new.group_id is not distinct from old.group_id
     and new.scale_factor is not distinct from old.scale_factor
     and new.linked_product_id is not distinct from old.linked_product_id
     and new.is_active is not distinct from old.is_active then
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
       select 1
         from public.products p
        where p.id = new.linked_product_id
          and p.tenant_id = v_tenant_id
     ) then
    raise exception 'MODIFIER_OPTION_LINKED_PRODUCT_TENANT_MISMATCH'
      using errcode = '23503';
  end if;

  if new.is_default
     and v_group_rule in ('single', 'single_required') then
    update public.modifier_options o
       set is_default = false,
           updated_at = now()
     where o.group_id = new.group_id
       and o.id is distinct from new.id
       and o.is_active
       and o.is_default;
  end if;

  return new;
end;
$function$;

alter function public.enforce_modifier_option_integrity_00347() owner to postgres;
revoke all on function public.enforce_modifier_option_integrity_00347()
  from public, anon, authenticated, service_role;

with ranked_defaults as (
  select
    o.id,
    row_number() over (
      partition by o.group_id
      order by o.sort_order desc, o.id desc
    ) as default_rank
  from public.modifier_options o
  join public.modifier_groups g on g.id = o.group_id
  where o.is_active
    and o.is_default
    and g.rule in ('single', 'single_required')
), duplicate_defaults as (
  select id
  from ranked_defaults
  where default_rank > 1
)
update public.modifier_options o
set is_default = false,
    updated_at = now()
from duplicate_defaults d
where o.id = d.id;

commit;

notify pgrst, 'reload schema';
