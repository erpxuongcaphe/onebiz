-- ============================================================================
-- 00351 - Dong bo co BOM cua SKU voi BOM dang hieu luc
--
-- Van de sua:
--   BOM tao tu man hinh danh muc co product_id dung, gia von da tinh, nhung
--   products.has_bom co the van false. Danh muc va POS vi the hien "Mua ban"
--   du da co cong thuc. Day la co hien thi/van hanh, KHONG phai cap nhat ton.
--
-- An toan:
--   * Chi sua products.has_bom va updated_at khi gia tri thuc su lech.
--   * Khong sua gia, BOM item, ton, so cai kho, don bep, hoa don hay ca lam.
--   * BOM tu chua chinh SKU bi loai tru de khong lap lai loi tru kho hai lan.
--   * BOM phai co it nhat mot dong nguyen lieu moi duoc danh dau la co BOM.
-- ============================================================================

begin;

create or replace function public.sync_product_has_bom_from_active_bom(
  p_product_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_tenant_id uuid;
  v_bom_code text;
  v_has_bom boolean;
  v_actual boolean;
begin
  select p.tenant_id, p.bom_code, coalesce(p.has_bom, false)
    into v_tenant_id, v_bom_code, v_has_bom
    from public.products p
   where p.id = p_product_id;

  if v_tenant_id is null then
    return false;
  end if;

  -- Giu dung thu tu lookup cua get_active_bom_for_branch:
  -- SKU da co bom_code chi dung BOM cung code; SKU chua co bom_code moi
  -- fallback theo product_id. Khong co dong NVL hoac tu chua SKU thi khong
  -- duoc coi la BOM de ban/tru kho.
  select exists (
    select 1
      from public.bom b
     where b.tenant_id = v_tenant_id
       and b.is_active
       and (
         (v_bom_code is not null and b.code = v_bom_code)
         or (v_bom_code is null and b.product_id = p_product_id)
       )
       and exists (
         select 1
           from public.bom_items bi
          where bi.bom_id = b.id
       )
       and not exists (
         select 1
           from public.bom_items bi
          where bi.bom_id = b.id
            and bi.material_id = p_product_id
       )
  ) into v_actual;

  if v_has_bom is distinct from v_actual then
    update public.products
       set has_bom = v_actual,
           updated_at = now()
     where id = p_product_id;
  end if;

  return v_actual;
end;
$function$;

comment on function public.sync_product_has_bom_from_active_bom(uuid) is
  '00351: Dong bo products.has_bom voi BOM dang bat, co dong NVL va khong tu chua SKU. Khong dong vao ton hay chung tu.';

revoke all on function public.sync_product_has_bom_from_active_bom(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.sync_product_bom_status_for_bom(
  p_bom_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_tenant_id uuid;
  v_product_id uuid;
  v_code text;
  r record;
begin
  select b.tenant_id, b.product_id, b.code
    into v_tenant_id, v_product_id, v_code
    from public.bom b
   where b.id = p_bom_id;
  if v_tenant_id is null then
    return;
  end if;

  for r in
    select p.id
      from public.products p
     where p.tenant_id = v_tenant_id
       and (
         p.id = v_product_id
         or (v_code is not null and p.bom_code = v_code)
       )
  loop
    perform public.sync_product_has_bom_from_active_bom(r.id);
  end loop;
end;
$function$;

revoke all on function public.sync_product_bom_status_for_bom(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.trg_sync_product_bom_status_00351()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  r record;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- Bom cu co the da doi code/product/tenant hoac bi tat. Hieu chinh moi
    -- SKU da tung duoc no tham chieu truoc khi xu ly ban ghi moi.
    for r in
      select p.id
        from public.products p
       where p.tenant_id = old.tenant_id
         and (
           p.id = old.product_id
           or (old.code is not null and p.bom_code = old.code)
         )
    loop
      perform public.sync_product_has_bom_from_active_bom(r.id);
    end loop;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_product_bom_status_for_bom(new.id);
  end if;

  return null;
end;
$function$;

revoke all on function public.trg_sync_product_bom_status_00351()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_sync_product_bom_status_00351 on public.bom;
create trigger trg_sync_product_bom_status_00351
after insert or delete or update of tenant_id, product_id, code, is_active
on public.bom
for each row execute function public.trg_sync_product_bom_status_00351();

create or replace function public.trg_sync_product_bom_status_item_00351()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sync_product_bom_status_for_bom(old.bom_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op <> 'UPDATE' or new.bom_id is distinct from old.bom_id) then
    perform public.sync_product_bom_status_for_bom(new.bom_id);
  end if;
  return null;
end;
$function$;

revoke all on function public.trg_sync_product_bom_status_item_00351()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_sync_product_bom_status_item_00351 on public.bom_items;
create trigger trg_sync_product_bom_status_item_00351
after insert or update or delete on public.bom_items
for each row execute function public.trg_sync_product_bom_status_item_00351();

-- Dong bo mot lan cac SKU cu. CHI dong co boolean khi no khac ket qua BOM
-- hien tai; khong co thao tac nao voi ton kho hay chung tu.
do $backfill$
declare
  r record;
  v_changed integer := 0;
  v_before boolean;
  v_after boolean;
begin
  for r in select id, coalesce(has_bom, false) as has_bom from public.products
  loop
    v_before := r.has_bom;
    v_after := public.sync_product_has_bom_from_active_bom(r.id);
    if v_before is distinct from v_after then
      v_changed := v_changed + 1;
    end if;
  end loop;
  raise notice '00351: da dong bo % co BOM cua SKU, khong dong ton hay chung tu.', v_changed;
end;
$backfill$;

-- Hau kiem trong transaction: neu con lech giua flag va BOM thuc te thi dung
-- ca migration, khong de danh muc va POS nhin hai trang thai khac nhau.
do $verify$
declare
  v_mismatch integer;
begin
  select count(*) into v_mismatch
    from public.products p
   where coalesce(p.has_bom, false) is distinct from exists (
     select 1
       from public.bom b
      where b.tenant_id = p.tenant_id
        and b.is_active
        and (
          (p.bom_code is not null and b.code = p.bom_code)
          or (p.bom_code is null and b.product_id = p.id)
        )
        and exists (select 1 from public.bom_items bi where bi.bom_id = b.id)
        and not exists (
          select 1 from public.bom_items bi
           where bi.bom_id = b.id and bi.material_id = p.id
        )
   );
  if v_mismatch <> 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00351_PRODUCT_BOM_FLAG_MISMATCH';
  end if;

  if to_regprocedure('public.sync_product_has_bom_from_active_bom(uuid)') is null
     or to_regprocedure('public.sync_product_bom_status_for_bom(uuid)') is null
     or not exists (
       select 1 from pg_trigger
        where tgrelid = 'public.bom'::regclass
          and tgname = 'trg_sync_product_bom_status_00351'
          and not tgisinternal
     )
     or not exists (
       select 1 from pg_trigger
        where tgrelid = 'public.bom_items'::regclass
          and tgname = 'trg_sync_product_bom_status_item_00351'
          and not tgisinternal
     ) then
    raise exception using errcode = 'P0001', message = 'FNB_00351_SYNC_GUARD_MISSING';
  end if;
end;
$verify$;

commit;
notify pgrst, 'reload schema';
