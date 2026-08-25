-- 00347: Guard modifier option data at the database boundary.
--
-- Problem this prevents:
--   1. A single-choice group can accidentally retain two active defaults.
--   2. One option can both scale an ingredient in the BOM and subtract a
--      linked SKU directly, consuming inventory twice.
--
-- Data safety:
--   * Does not rewrite existing business data or modifier setup.
--   * Future saves are serialized per group. Choosing a new default heals
--     the former default atomically for single-choice groups.
--   * Existing invalid setup is reported by the read-only postflight and is
--     corrected deliberately through the UI.

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
  -- Lock the parent group. This makes two concurrent "set default" saves
  -- serialize instead of committing two defaults for one group.
  select g.rule, g.tenant_id
    into v_group_rule, v_tenant_id
    from public.modifier_groups g
   where g.id = new.group_id
   for update;

  if not found then
    raise exception 'MODIFIER_GROUP_NOT_FOUND'
      using errcode = '23503';
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

  if new.is_active
     and new.is_default
     and v_group_rule in ('single', 'single_required') then
    -- A user selecting a new default expects the prior one to be replaced,
    -- not an error or a second default. The group lock keeps this atomic.
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
revoke all on function public.enforce_modifier_option_integrity_00347() from public;

drop trigger if exists trg_enforce_modifier_option_integrity_00347
  on public.modifier_options;
create trigger trg_enforce_modifier_option_integrity_00347
before insert or update of group_id, scale_factor, linked_product_id, is_default, is_active
on public.modifier_options
for each row execute function public.enforce_modifier_option_integrity_00347();

create or replace function public.enforce_modifier_group_integrity_00347()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_default_count integer;
begin
  if new.rule not in ('single', 'single_required') then
    return new;
  end if;

  select count(*)
    into v_default_count
    from public.modifier_options o
   where o.group_id = new.id
     and o.is_active
     and o.is_default;

  if v_default_count > 1 then
    raise exception 'MODIFIER_SINGLE_GROUP_MULTIPLE_DEFAULTS'
      using errcode = '23514',
            detail = 'Choose one active default before changing this group to a single-choice rule.';
  end if;

  return new;
end;
$function$;

alter function public.enforce_modifier_group_integrity_00347() owner to postgres;
revoke all on function public.enforce_modifier_group_integrity_00347() from public;

drop trigger if exists trg_enforce_modifier_group_integrity_00347
  on public.modifier_groups;
create trigger trg_enforce_modifier_group_integrity_00347
before update of rule
on public.modifier_groups
for each row execute function public.enforce_modifier_group_integrity_00347();

commit;

notify pgrst, 'reload schema';
