-- ============================================================
-- ROLLBACK 00304 — tra gia topping ve doc tu payload nhu ban 00230.
-- Patch nguoc tai cho: tim khoi GIA_TOPPING_SERVER_00304 (phai xuat hien
-- DUNG 2 lan) va thay bang cau lenh cu. Idempotent: chua ap dung thi bo qua.
-- ============================================================

do $mig$
declare
  v_oid   oid;
  v_def   text;
  v_cu    text;
  v_moi   text;
  v_solan int;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = '_fnb_complete_payment_impl_00230'
    and p.prokind = 'f';

  if v_oid is null then
    raise exception 'ROLLBACK 00304: khong tim thay public._fnb_complete_payment_impl_00230.';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('GIA_TOPPING_SERVER_00304' in v_def) = 0 then
    raise notice 'ROLLBACK 00304: chua ap dung 00304 — khong co gi de go.';
    return;
  end if;

  v_cu := $cu$v_topping_price := coalesce((t->>'price')::numeric, 0);$cu$;

  -- Khoi nay PHAI trung TUNG BYTE voi v_moi cua 00304 (co test khoa 2 file).
  v_moi := $moi$-- GIA_TOPPING_SERVER_00304: gia topping do MAY CHU quyet voi SKU topping
          -- hop le (sku + fnb + active + gia > 0); ma khac (vd NVL-TOP cu)
          -- hoac khong tim thay san pham -> giu gia payload (tuong thich).
          select case
                   when p304.product_type = 'sku' and p304.channel = 'fnb'
                        and p304.is_active and coalesce(p304.sell_price, 0) > 0
                   then p304.sell_price
                   else coalesce((t->>'price')::numeric, 0)
                 end
            into v_topping_price
            from public.products p304
           where p304.id = nullif(t->>'product_id', '')::uuid;
          if v_topping_price is null then
            v_topping_price := coalesce((t->>'price')::numeric, 0);
          end if;$moi$;

  v_solan := (length(v_def) - length(replace(v_def, v_moi, ''))) / length(v_moi);
  if v_solan <> 2 then
    raise exception 'ROLLBACK 00304 FINGERPRINT LECH: khoi 00304 xuat hien % lan (can dung 2) — DUNG LAI, doi soat dinh nghia.', v_solan;
  end if;

  execute replace(v_def, v_moi, v_cu);

  raise notice 'ROLLBACK 00304: OK — gia topping tro ve doc tu payload (2 vi tri).';
end
$mig$;
