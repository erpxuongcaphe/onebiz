-- 00362: Supersede 00361 for sites where 00361 has not been run manually.
--
-- Display labels are user-owned text (for example "Binh thuong" or "It ngot").
-- They are not persistent business keys. This repair removes the legacy direct
-- SKU consumption that conflicts with BOM scaling, while preserving both the
-- current labels and the current default option. The CASE below repairs known
-- legacy rows once; future behavior must use option_id and exact quantities,
-- never parse the display label. Exact per-product quantities are not touched.

begin;

do $preflight$
begin
  if to_regclass('public.modifier_groups') is null
     or to_regclass('public.modifier_options') is null
     or to_regclass('public.products') is null then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00362_REQUIRED_SCHEMA_MISSING';
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

-- A sugar modifier changes a BOM ingredient. It must not also consume one
-- whole linked inventory item. Preserve label and is_default. Normalize only
-- the four known legacy factors found by the 00360 postflight.
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
  and o.linked_product_id = sugar.id
  and o.scale_factor is not null
  and btrim(o.label) in ('Không đường', '80%', '100%', '120%');

do $verify$
declare
  v_conflicts integer;
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
      message = 'FNB_00362_STOCK_EFFECT_CONFLICT_REMAINS',
      detail = format('remaining=%s', v_conflicts);
  end if;

  select count(*)
    into v_bad_defaults
    from public.modifier_groups g
   where lower(btrim(g.name)) = lower('Mức đường')
     and exists (
       select 1
       from public.products p
       where p.tenant_id = g.tenant_id
         and p.code = 'SKU-BOT-009'
     )
     and (
       select count(*)
       from public.modifier_options o
       where o.group_id = g.id
         and o.is_active
         and o.is_default
     ) <> 1;

  if v_bad_defaults <> 0 then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00362_SINGLE_DEFAULT_REQUIRED',
      detail = format('groups=%s', v_bad_defaults);
  end if;
end;
$verify$;

commit;

notify pgrst, 'reload schema';
