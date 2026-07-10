-- ============================================================
-- 00167 - DB-level guard: F&B menu items never keep stock directly
--
-- Cách B invariant:
--   products.inventory_role = 'fnb_menu_item' is a menu item, not a stock item.
--   It must not receive direct stock_movements from POS, Excel, inventory
--   check, manual adjustment, transfer, purchase, or any legacy code path.
--
-- Allowed exception:
--   invoice_void may reverse an old legacy direct stock movement for the same
--   product/reference_id. This lets the system clean old wrong ledger rows
--   without opening a new path to create menu stock.
-- ============================================================

create or replace function public.guard_fnb_menu_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text;
begin
  if new.product_id is null then
    return new;
  end if;

  select p.inventory_role
    into v_role
    from public.products p
   where p.id = new.product_id
     and (new.tenant_id is null or p.tenant_id = new.tenant_id);

  if v_role = 'fnb_menu_item' then
    if new.reference_type = 'invoice_void'
       and new.reference_id is not null
       and exists (
         select 1
           from public.stock_movements sm
          where sm.tenant_id = new.tenant_id
            and sm.branch_id = new.branch_id
            and sm.product_id = new.product_id
            and sm.reference_id = new.reference_id
            and sm.reference_type in ('invoice', 'modifier_topping', 'bom_consume')
            and sm.type = 'out'
       ) then
      return new;
    end if;

    raise exception 'MENU_NO_DIRECT_STOCK: Món F&B không giữ tồn trực tiếp. Hãy thiết lập công thức BOM hoặc đảo theo sổ cái cũ.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_fnb_menu_stock_movements on public.stock_movements;

create trigger trg_guard_fnb_menu_stock_movements
before insert or update of tenant_id, branch_id, product_id, type, quantity, reference_type, reference_id
on public.stock_movements
for each row
execute function public.guard_fnb_menu_stock_movement();

comment on function public.guard_fnb_menu_stock_movement is
  '00167 Cách B: chặn mọi stock_movements trực tiếp lên products.inventory_role=fnb_menu_item; chỉ cho invoice_void đảo movement legacy cùng hóa đơn.';

notify pgrst, 'reload schema';
