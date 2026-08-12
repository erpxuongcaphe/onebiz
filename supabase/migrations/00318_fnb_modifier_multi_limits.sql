-- ============================================================
-- 00318 - Gioi han lua chon cho nhom tuy chon FnB "chon nhieu".
--
-- An toan du lieu:
--   * Chi ADD 2 cot cau hinh, mac dinh giu nguyen hanh vi cu.
--   * Khong UPDATE/DELETE bat ky dong nghiep vu nao.
--   * Trigger chi kiem tra dong bep moi/sua sau khi cai migration.
-- ============================================================

alter table public.modifier_groups
  add column if not exists min_select integer not null default 0,
  add column if not exists max_select integer;

alter table public.modifier_groups
  drop constraint if exists modifier_groups_multi_limits_check;

alter table public.modifier_groups
  add constraint modifier_groups_multi_limits_check check (
    min_select >= 0
    and (max_select is null or max_select >= 1)
    and (max_select is null or max_select >= min_select)
    and (
      rule = 'multi'
      or (min_select = 0 and max_select is null)
    )
  ) not valid;

alter table public.modifier_groups
  validate constraint modifier_groups_multi_limits_check;

comment on column public.modifier_groups.min_select is
  'So lua chon toi thieu cua nhom multi. 0 = khong bat buoc; nhom khac multi luon bang 0.';
comment on column public.modifier_groups.max_select is
  'So lua chon toi da cua nhom multi. NULL = khong gioi han; nhom khac multi luon NULL.';

create or replace function public.enforce_fnb_modifier_multi_limits_00318()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_category_id uuid;
  v_group record;
  v_selected_count integer;
begin
  select ko.tenant_id, p.category_id
    into v_tenant_id, v_category_id
    from public.kitchen_orders ko
    join public.products p
      on p.id = new.product_id
     and p.tenant_id = ko.tenant_id
   where ko.id = new.kitchen_order_id;

  if not found then
    raise exception 'MODIFIER_LIMIT_CONTEXT_INVALID' using errcode = 'P0001';
  end if;

  for v_group in
    select distinct mg.id, mg.name, mg.min_select, mg.max_select
      from public.modifier_groups mg
      left join public.product_modifier_groups pmg
        on pmg.modifier_group_id = mg.id
       and pmg.product_id = new.product_id
       and pmg.tenant_id = v_tenant_id
      left join public.category_modifier_groups cmg
        on cmg.modifier_group_id = mg.id
       and cmg.category_id = v_category_id
       and cmg.tenant_id = v_tenant_id
     where mg.tenant_id = v_tenant_id
       and mg.is_active
       and mg.channel in ('fnb', 'all')
       and (
         (
           exists (
             select 1 from public.product_modifier_groups own_link
              where own_link.product_id = new.product_id
                and own_link.tenant_id = v_tenant_id
           )
           and pmg.id is not null
         )
         or (
           not exists (
             select 1 from public.product_modifier_groups own_link
              where own_link.product_id = new.product_id
                and own_link.tenant_id = v_tenant_id
           )
           and cmg.id is not null
         )
       )
       and coalesce(pmg.rule_override, mg.rule) = 'multi'
       and (mg.min_select > 0 or mg.max_select is not null)
  loop
    select coalesce(jsonb_array_length(s.value->'options'), 0)
      into v_selected_count
      from jsonb_array_elements(coalesce(new.modifier_selections, '[]'::jsonb)) s
     where s.value->>'groupId' = v_group.id::text
       and jsonb_typeof(s.value->'options') = 'array'
     limit 1;

    v_selected_count := coalesce(v_selected_count, 0);

    if v_selected_count < v_group.min_select then
      raise exception 'MODIFIER_MIN_NOT_MET:%:%', v_group.name, v_group.min_select
        using errcode = 'P0001';
    end if;
    if v_group.max_select is not null and v_selected_count > v_group.max_select then
      raise exception 'MODIFIER_MAX_EXCEEDED:%:%', v_group.name, v_group.max_select
        using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.enforce_fnb_modifier_multi_limits_00318() from public;

drop trigger if exists trg_enforce_fnb_modifier_multi_limits_00318
  on public.kitchen_order_items;
create trigger trg_enforce_fnb_modifier_multi_limits_00318
before insert or update of product_id, modifier_selections
on public.kitchen_order_items
for each row execute function public.enforce_fnb_modifier_multi_limits_00318();

notify pgrst, 'reload schema';

select
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'modifier_groups'
       and column_name = 'min_select'
  )
  and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'modifier_groups'
       and column_name = 'max_select'
  )
  and to_regprocedure('public.enforce_fnb_modifier_multi_limits_00318()') is not null
  and exists (
    select 1 from pg_trigger
     where tgname = 'trg_enforce_fnb_modifier_multi_limits_00318'
       and not tgisinternal
  ) as fnb_modifier_limits_ok;
