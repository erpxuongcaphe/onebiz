-- ============================================================================
-- ROLLBACK 00330 — bỏ guard Size ở máy chủ, trả hàm gửi bếp về như cũ
-- Chỉ khôi phục mã hàm. Không sửa dữ liệu.
-- Sau khi lui: máy chủ lại nhận đơn thiếu quy cách, giá 0, và cỡ thiếu công
-- thức sẽ âm thầm dùng công thức món cha.
-- ============================================================================

do $$
begin
  if to_regprocedure('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise notice 'Rollback 00330: khong thay ham noi bo — co le 00330 chua chay. Khong lam gi.';
    return;
  end if;

  execute 'drop function if exists public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)';
  execute 'alter function public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
       || ' rename to fnb_send_to_kitchen_atomic_v2';

  execute 'revoke all on function public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid) from public, anon';
  execute 'grant execute on function public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid) to authenticated';

  raise notice 'Rollback 00330: da tra ham gui bep ve ban cu, khong doi du lieu';
end $$;

do $$
begin
  if to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception 'Rollback 00330 that bai: khong con ham gui bep';
  end if;
  if to_regprocedure('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null then
    raise exception 'Rollback 00330 that bai: ham noi bo van con';
  end if;
end $$;
