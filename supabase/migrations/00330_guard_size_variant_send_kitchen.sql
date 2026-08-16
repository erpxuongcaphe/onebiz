-- ============================================================================
-- 00330 — Guard Size (tầng máy chủ): bắt buộc chọn quy cách, giá > 0, có công thức
--
-- CHỐT MÔ HÌNH (CEO 16/08): mỗi cỡ là MỘT QUY CÁCH riêng, giá riêng, công thức
-- riêng. Không dùng hệ số nhân chung cho Size vì công thức M/L/XL không tăng đều.
--
-- LỖ HỔNG ĐANG CÓ (đo trên production):
--   • Máy chủ KHÔNG bắt buộc gửi mã quy cách, kể cả khi món đang có quy cách bật
--     → bán ly L nhưng không kèm quy cách thì trừ kho y hệt ly M.
--   • Máy chủ vẫn nhận giá gốc 0 → bán 0đ do quên nhập giá.
--   • `get_active_bom_for_branch`: quy cách KHÔNG có mã công thức thì **âm thầm
--     kế thừa công thức món cha** → mọi cỡ trừ kho như nhau, không ai biết.
--
-- CÁCH VÁ — bọc, không chép (đúng mẫu 00287 / 00329):
--   1. Đổi tên hàm gửi bếp hiện tại thành `_fnb_send_to_kitchen_impl_00303`
--      (giữ nguyên 100% thân hàm).
--   2. Tạo lại `fnb_send_to_kitchen_atomic_v2` cùng chữ ký 12 tham số: kiểm
--      từng dòng hàng TRƯỚC, đạt hết mới gọi hàm nội bộ.
--   3. Thu hồi quyền gọi thẳng hàm nội bộ.
--
-- Thông báo lỗi bằng tiếng Việt, nêu rõ tên món để người bán biết phải làm gì.
-- Giỏ hàng phía POS không bị xoá vì lỗi ném ra trước khi ghi bất cứ thứ gì.
--
-- KHÔNG đụng: Retail, luồng thanh toán, huỷ, trả hàng, dữ liệu.
-- Chạy lặp an toàn.
-- ============================================================================

-- ── 1. Đổi tên bản hiện tại thành hàm nội bộ (chỉ lần đầu) ──
do $$
declare
  v_md5 text;
begin
  if to_regprocedure('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null then
    raise notice '00330: ham noi bo da ton tai — bo qua doi ten (chay lap an toan)';
    return;
  end if;

  if to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception '00330 dung: khong tim thay fnb_send_to_kitchen_atomic_v2 dung chu ky 12 tham so';
  end if;

  select md5(pg_get_functiondef(p.oid)) into v_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fnb_send_to_kitchen_atomic_v2';
  raise notice '00330: dau van tay ban dang boc = %', v_md5;

  execute 'alter function public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'
       || ' rename to _fnb_send_to_kitchen_impl_00303';
  raise notice '00330: da doi ten thanh _fnb_send_to_kitchen_impl_00303';
end $$;

-- ── 2. Lớp bọc: kiểm quy cách trước, rồi mới gửi bếp ──
create or replace function public.fnb_send_to_kitchen_atomic_v2(
  p_branch_id uuid,
  p_table_id uuid default null,
  p_order_type text default 'dine_in',
  p_note text default null,
  p_idempotency_key text default null,
  p_items jsonb default '[]'::jsonb,
  p_delivery_platform text default null,
  p_delivery_fee numeric default 0,
  p_platform_commission_percent numeric default null,
  p_delivery_staff_id uuid default null,
  p_delivery_distance_tier text default null,
  p_existing_order_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor    uuid := auth.uid();
  v_tenant   uuid;
  v_item     jsonb;
  v_pid      uuid;
  v_vid      uuid;
  v_ten      text;
  v_so_qc    int;
  v_gia      numeric;
  v_bom_code text;
begin
  if v_actor is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select tenant_id into v_tenant from public.profiles
  where id = v_actor and is_active limit 1;
  if v_tenant is null then
    raise exception 'Tai khoan chua gan cong ty hoac da bi khoa';
  end if;

  -- Kiểm từng dòng hàng TRƯỚC khi ghi bất cứ thứ gì.
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_pid := nullif(v_item->>'productId', '')::uuid;
    if v_pid is null then
      v_pid := nullif(v_item->>'product_id', '')::uuid;
    end if;
    continue when v_pid is null;

    select p.name into v_ten from public.products p
    where p.id = v_pid and p.tenant_id = v_tenant;
    if v_ten is null then
      raise exception 'Món không thuộc công ty này — vui lòng tải lại trang.';
    end if;

    v_vid := nullif(v_item->>'variantId', '')::uuid;
    if v_vid is null then
      v_vid := nullif(v_item->>'variant_id', '')::uuid;
    end if;

    select count(*) into v_so_qc
    from public.product_variants pv
    where pv.product_id = v_pid and pv.tenant_id = v_tenant and pv.is_active;

    -- (a) Món có quy cách đang bật → BẮT BUỘC chọn cỡ
    if v_so_qc > 0 and v_vid is null then
      raise exception 'Món "%" có nhiều cỡ — vui lòng chọn cỡ trước khi gửi bếp.', v_ten;
    end if;

    if v_vid is not null then
      -- (b) Quy cách phải đúng công ty, đúng món, đang bật
      select pv.sell_price, pv.bom_code into v_gia, v_bom_code
      from public.product_variants pv
      where pv.id = v_vid
        and pv.product_id = v_pid
        and pv.tenant_id = v_tenant
        and pv.is_active;
      if not found then
        raise exception 'Cỡ đã chọn của món "%" không còn dùng được — vui lòng chọn lại.', v_ten;
      end if;

      -- (c) Giá của cỡ phải > 0
      if coalesce(v_gia, 0) <= 0 then
        raise exception 'Cỡ đã chọn của món "%" chưa có giá bán. Báo quản lý nhập giá rồi bán lại.', v_ten;
      end if;

      -- (d) Cỡ phải có công thức riêng — KHÔNG để âm thầm dùng công thức món cha
      if v_bom_code is null or v_bom_code = '' then
        raise exception 'Cỡ đã chọn của món "%" chưa có công thức riêng. Nhập công thức cho từng cỡ rồi bán lại.', v_ten;
      end if;

      -- (e) Công thức phải tồn tại và đang bật, đúng chi nhánh hoặc dùng chung
      if not exists (
        select 1 from public.bom b
        where b.tenant_id = v_tenant
          and b.code = v_bom_code
          and b.is_active
          and (b.branch_id = p_branch_id or b.branch_id is null)
      ) then
        raise exception 'Công thức của cỡ đã chọn (món "%") chưa áp dụng cho chi nhánh này.', v_ten;
      end if;
    else
      -- Món KHÔNG có quy cách → giá gốc phải > 0
      select p.sell_price into v_gia from public.products p
      where p.id = v_pid and p.tenant_id = v_tenant;
      if coalesce(v_gia, 0) <= 0 then
        raise exception 'Món "%" chưa có giá bán. Báo quản lý nhập giá rồi bán lại.', v_ten;
      end if;
    end if;
  end loop;

  -- Qua hết vòng kiểm mới thực hiện nghiệp vụ gốc, giữ nguyên 100%.
  return public._fnb_send_to_kitchen_impl_00303(
    p_branch_id, p_table_id, p_order_type, p_note, p_idempotency_key, p_items,
    p_delivery_platform, p_delivery_fee, p_platform_commission_percent,
    p_delivery_staff_id, p_delivery_distance_tier, p_existing_order_id
  );
end $$;

-- ── 3. Quyền ──
revoke all on function public._fnb_send_to_kitchen_impl_00303(
  uuid, uuid, text, text, text, jsonb, text, numeric, numeric, uuid, text, uuid
) from public, anon, authenticated;

revoke all on function public.fnb_send_to_kitchen_atomic_v2(
  uuid, uuid, text, text, text, jsonb, text, numeric, numeric, uuid, text, uuid
) from public, anon;

grant execute on function public.fnb_send_to_kitchen_atomic_v2(
  uuid, uuid, text, text, text, jsonb, text, numeric, numeric, uuid, text, uuid
) to authenticated;

comment on function public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid) is
  '00330: lop boc guard Size. Kiem bat buoc chon quy cach, gia > 0, quy cach dung cong ty/mon/dang bat, co cong thuc rieng ap dung dung chi nhanh. Nghiep vu gui bep giu nguyen o _fnb_send_to_kitchen_impl_00303.';

-- ── 4. Hậu kiểm ──
do $$
declare v_n int;
begin
  if to_regprocedure('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception '00330 that bai: khong thay ham noi bo';
  end if;

  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fnb_send_to_kitchen_atomic_v2'
    and pg_get_functiondef(p.oid) like '%_fnb_send_to_kitchen_impl_00303%'
    and pg_get_functiondef(p.oid) like '%product_variants%';
  if v_n <> 1 then
    raise exception '00330 that bai: lop boc chua goi ham noi bo hoac chua kiem quy cach';
  end if;

  select count(*) into v_n
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = '_fnb_send_to_kitchen_impl_00303'
    and grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then
    raise exception '00330 that bai: ham noi bo van con % quyen goi truc tiep', v_n;
  end if;

  raise notice '00330: OK — guard Size da bat o may chu';
end $$;
