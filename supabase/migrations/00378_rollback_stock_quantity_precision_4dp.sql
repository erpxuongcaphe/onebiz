-- Rollback for 00378. It intentionally refuses to discard newly recorded
-- four-decimal quantities. Run only before any such stock transaction exists.

begin;
set local lock_timeout = '5s';

do $guard$
begin
  if exists (select 1 from public.products
              where stock <> round(stock, 2)
                 or min_stock <> round(min_stock, 2)
                 or max_stock <> round(max_stock, 2))
     or exists (select 1 from public.branch_stock
                 where quantity <> round(quantity, 2)
                    or reserved <> round(reserved, 2))
     or exists (select 1 from public.stock_movements
                 where quantity <> round(quantity, 2))
     or exists (select 1 from public.inventory_check_items
                 where system_stock <> round(system_stock, 2)
                    or actual_stock <> round(actual_stock, 2)
                    or difference <> round(difference, 2)) then
    raise exception using errcode = 'P0001',
      message = '00378_ROLLBACK_WOULD_LOSE_STOCK_PRECISION';
  end if;
end;
$guard$;

alter table public.products
  alter column stock type numeric(15,2),
  alter column min_stock type numeric(15,2),
  alter column max_stock type numeric(15,2);
alter table public.branch_stock
  alter column quantity type numeric(15,2),
  alter column reserved type numeric(15,2);
alter table public.stock_movements
  alter column quantity type numeric(15,2);
alter table public.inventory_check_items
  drop column difference;
alter table public.inventory_check_items
  alter column system_stock type numeric(15,2),
  alter column actual_stock type numeric(15,2);
alter table public.inventory_check_items
  add column difference numeric(15,2)
    generated always as (actual_stock - system_stock) stored;

comment on column public.inventory_check_items.difference is
  'Chenh lech = actual_stock - system_stock. GENERATED; DB tu tinh, client khong the ghi.';

commit;
