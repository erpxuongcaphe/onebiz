-- ============================================================
-- 00304 — GIA TOPPING DO MAY CHU QUYET (CEO 08/08/2026, diem 5)
--
-- Van de: _fnb_complete_payment_impl_00230 dang TIN gia topping client gui
-- (t->>'price') o CA HAI vong lap (tam tinh + tru kho/ghi dong). Mot client
-- sua payload co the tinh sai tien.
--
-- Cach va: PATCH TAI CHO tren dinh nghia DANG CAI (pg_get_functiondef) —
-- khong che lai toan van ham 20k ky tu:
--   • Idempotent: da co marker GIA_TOPPING_SERVER_00304 thi bo qua.
--   • Fingerprint: cau lenh cu phai xuat hien DUNG 2 lan, lech la DUNG ngay.
--   • Thay the: SKU topping hop le (sku + fnb + active + gia > 0) -> lay
--     sell_price tu bang products; ma khac (NVL-TOP cu / khong tim thay)
--     -> giu gia payload (Phase 1 tuong thich, chua cutover).
--
-- CHAY LUC NAO: theo checklist "Cau hinh truoc khi van hanh F&B" — KHONG
-- can chay ngay hom nay. Chi doc/ghi DINH NGHIA HAM, khong dung du lieu.
-- Rollback: 00304_rollback_fnb_topping_gia_server.sql
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
    raise exception '00304: khong tim thay public._fnb_complete_payment_impl_00230 — kiem tra chuoi 00250/00274 da chay chua.';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position('GIA_TOPPING_SERVER_00304' in v_def) > 0 then
    raise notice '00304: da ap dung truoc do — bo qua (idempotent).';
    return;
  end if;

  v_cu := $cu$v_topping_price := coalesce((t->>'price')::numeric, 0);$cu$;

  v_solan := (length(v_def) - length(replace(v_def, v_cu, ''))) / length(v_cu);
  if v_solan <> 2 then
    raise exception '00304 FINGERPRINT LECH: cau lenh gia topping xuat hien % lan (can dung 2). Ham tren prod da khac ban 00230 — DUNG LAI, doi soat dinh nghia truoc khi va.', v_solan;
  end if;

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

  execute replace(v_def, v_cu, v_moi);

  raise notice '00304: OK — gia topping chuyen sang may chu quyet (2 vi tri: tam tinh + ghi dong/tru kho).';
end
$mig$;
