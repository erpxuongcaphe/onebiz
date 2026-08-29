-- 00361: Repair the legacy shared sugar modifier without changing exact BOM recipes.
--
-- The shared "Muc duong" options were carrying both stock mechanisms:
--   * scale_factor: scales the sugar BOM line (legacy fallback)
--   * linked_product_id: consumes one whole linked product per sold item
-- Keeping both double-consumes inventory. Direct links are for toppings, while
-- sugar remains a BOM ingredient. Exact per-product quantities from 00350 still
-- take precedence over these fallback factors.

begin;

do $preflight$
begin
  if to_regclass('public.modifier_groups') is null
     or to_regclass('public.modifier_options') is null
     or to_regclass('public.products') is null then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00361_REQUIRED_SCHEMA_MISSING';
  end if;
end;
$preflight$;

-- Lock only the shared sugar groups belonging to tenants that own SKU-BOT-009.
do $lock_groups$
declare
  v_group_id uuid;
begin
  for v_group_id in
    select g.id
    from public.modifier_groups g
    where lower(btrim(g.name)) = lower('Mức đường')
      and exists (
        select 1
        from public.products p
        where p.tenant_id = g.tenant_id
          and p.code = 'SKU-BOT-009'
      )
    for update
  loop
    null;
  end loop;
end;
$lock_groups$;

-- A sugar choice modifies a BOM ingredient. It must never also consume one
-- whole linked SKU as if it were a topping.
update public.modifier_options o
set linked_product_id = null,
    scale_factor = case btrim(o.label)
      when 'Không đường' then 0
      when '80%' then 0.8
      when '100%' then 1
      when '120%' then 1.2
      else o.scale_factor
    end,
    updated_at = now()
from public.modifier_groups g
join public.products sugar
  on sugar.tenant_id = g.tenant_id
 and sugar.code = 'SKU-BOT-009'
where o.group_id = g.id
  and lower(btrim(g.name)) = lower('Mức đường')
  and btrim(o.label) in ('Không đường', '80%', '100%', '120%')
  and (
    o.linked_product_id = sugar.id
    or o.linked_product_id is null
  );

-- The base recipe is 100%. Make that business meaning explicit and deterministic.
update public.modifier_options o
set is_default = false,
    updated_at = now()
from public.modifier_groups g
where o.group_id = g.id
  and lower(btrim(g.name)) = lower('Mức đường')
  and exists (
    select 1 from public.products p
    where p.tenant_id = g.tenant_id and p.code = 'SKU-BOT-009'
  )
  and o.is_active
  and o.is_default;

update public.modifier_options o
set is_default = true,
    updated_at = now()
from public.modifier_groups g
where o.group_id = g.id
  and lower(btrim(g.name)) = lower('Mức đường')
  and exists (
    select 1 from public.products p
    where p.tenant_id = g.tenant_id and p.code = 'SKU-BOT-009'
  )
  and o.is_active
  and btrim(o.label) = '100%';

do $verify$
declare
  v_conflicts integer;
  v_bad_factors integer;
  v_bad_defaults integer;
begin
  select count(*)
    into v_conflicts
    from public.modifier_options o
    join public.modifier_groups g on g.id = o.group_id
   where o.is_active
     and lower(btrim(g.name)) = lower('Mức đường')
     and o.scale_factor is not null
     and o.linked_product_id is not null;

  if v_conflicts <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00361_STOCK_EFFECT_CONFLICT_REMAINS',
      detail = format('remaining=%s', v_conflicts);
  end if;

  select count(*)
    into v_bad_factors
    from public.modifier_options o
    join public.modifier_groups g on g.id = o.group_id
   where o.is_active
     and lower(btrim(g.name)) = lower('Mức đường')
     and btrim(o.label) in ('Không đường', '80%', '100%', '120%')
     and o.scale_factor is distinct from case btrim(o.label)
       when 'Không đường' then 0::numeric
       when '80%' then 0.8::numeric
       when '100%' then 1::numeric
       when '120%' then 1.2::numeric
     end;

  if v_bad_factors <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00361_SUGAR_FACTOR_MISMATCH',
      detail = format('remaining=%s', v_bad_factors);
  end if;

  select count(*)
    into v_bad_defaults
    from public.modifier_groups g
   where lower(btrim(g.name)) = lower('Mức đường')
     and (
       select count(*)
       from public.modifier_options o
       where o.group_id = g.id
         and o.is_active
         and o.is_default
         and btrim(o.label) = '100%'
     ) <> 1;

  if v_bad_defaults <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00361_DEFAULT_NOT_100_PERCENT',
      detail = format('groups=%s', v_bad_defaults);
  end if;
end;
$verify$;

commit;

notify pgrst, 'reload schema';
