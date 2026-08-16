-- ============================================================================
-- 00329 — Huỷ hoá đơn F&B: đối soát lại SỔ LÔ (FIFO) sau khi hoàn kho
--
-- VẤN ĐỀ (đo trên production 16/08/2026):
--   • Khi bán, `consume_bom_for_sale` cấp phát lô cho NGUYÊN LIỆU:
--       allocate_lots_fifo(tenant, material_id, branch, qty, 'invoice', invoice_id)
--   • Khi huỷ, `fnb_void_invoice_atomic` (00165) có hai vòng:
--       – vòng 3  (reference_type='invoice')  → hoàn tồn VÀ đảo lô  ✔
--       – vòng 3b (bom_consume, modifier_topping) → CHỈ hoàn tồn tổng +
--         tồn chi nhánh, KHÔNG đụng product_lots / lot_allocations  ✘
--   → Nguyên liệu và topping hoàn đúng tồn nhưng SỔ LÔ không được đảo,
--     tồn theo lô lệch dần so với tồn chi nhánh.
--
-- CÁCH VÁ (theo đúng mẫu wrapper 00287 của luồng trả hàng):
--   1. Đổi tên hàm 00165 hiện tại thành hàm nội bộ `_fnb_void_invoice_impl_00165`
--      — GIỮ NGUYÊN 100% thân hàm, không chép lại, không sửa một dòng logic.
--   2. Tạo lại `fnb_void_invoice_atomic` cùng chữ ký làm lớp bọc: gọi hàm nội bộ,
--      sau đó lấy DISTINCT (branch_id, product_id) từ chính stock_movements vừa
--      được ghi (reference_id = hoá đơn, reference_type = 'invoice_void',
--      type = 'in') rồi gọi `_reconcile_product_lots_to_branch_00284` cho từng cặp.
--      Dựa trên movement THỰC TẾ, không tính lại công thức (công thức có thể đã đổi).
--   3. Thu hồi quyền gọi thẳng hàm nội bộ; chỉ `authenticated` gọi được lớp bọc.
--
-- KHÔNG đổi: tiền hoàn, công nợ, tồn tổng, tồn chi nhánh, trạng thái hoá đơn,
-- nhật ký, luồng trả hàng (đã có wrapper 00287), và KHÔNG đụng
-- `void_completed_invoice_atomic_v2` của Retail. KHÔNG sửa dữ liệu lịch sử.
--
-- Chạy lặp an toàn: lần 2 trở đi thấy hàm nội bộ đã tồn tại thì bỏ qua bước đổi tên.
-- ============================================================================

-- ── 1. Đổi tên bản 00165 thành hàm nội bộ (chỉ lần đầu) ──
do $$
declare
  v_impl_ton_tai boolean;
  v_dau_van_tay text;
begin
  v_impl_ton_tai := to_regprocedure(
    'public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'
  ) is not null;

  if v_impl_ton_tai then
    raise notice '00329: ham noi bo da ton tai — bo qua buoc doi ten (chay lap an toan)';
    return;
  end if;

  if to_regprocedure(
       'public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'
     ) is null then
    raise exception '00329 dung: khong tim thay fnb_void_invoice_atomic dung chu ky 8 tham so';
  end if;

  -- Dấu vân tay bản đang cài trên production (đo 16/08/2026).
  select md5(pg_get_functiondef(p.oid)) into v_dau_van_tay
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fnb_void_invoice_atomic';

  if v_dau_van_tay <> '5c5d85efa6fbc4f3d91a064f96899234' then
    raise exception
      '00329 DUNG AN TOAN: ban ham tren may chu (md5=%) khac ban da kiem (5c5d85ef...). '
      'Ai do da sua fnb_void_invoice_atomic — doc lai roi cap nhat migration.',
      v_dau_van_tay;
  end if;

  execute 'alter function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'
       || ' rename to _fnb_void_invoice_impl_00165';
  raise notice '00329: da doi ten ban 00165 thanh _fnb_void_invoice_impl_00165';
end $$;

-- ── 2. Lớp bọc cùng chữ ký ──
create or replace function public.fnb_void_invoice_atomic(
  p_invoice_id uuid,
  p_kitchen_order_id uuid,
  p_void_reason text,
  p_voided_by uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid default null,
  p_otp_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_ket_qua jsonb;
  v_cap record;
  v_so_cap int := 0;
begin
  -- Toàn bộ nghiệp vụ huỷ giữ nguyên ở hàm nội bộ (bản 00165).
  v_ket_qua := public._fnb_void_invoice_impl_00165(
    p_invoice_id, p_kitchen_order_id, p_void_reason, p_voided_by,
    p_tenant_id, p_branch_id, p_shift_id, p_otp_id
  );

  -- Đối soát sổ lô theo movement THỰC TẾ vừa ghi khi huỷ.
  -- Không tính lại công thức: công thức có thể đã thay đổi sau khi bán.
  for v_cap in
    select distinct sm.branch_id, sm.product_id
    from public.stock_movements sm
    where sm.tenant_id = p_tenant_id
      and sm.reference_id = p_invoice_id
      and sm.reference_type = 'invoice_void'
      and sm.type = 'in'
      and sm.branch_id is not null
      and sm.product_id is not null
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      p_tenant_id, v_cap.branch_id, v_cap.product_id,
      'invoice_void', p_invoice_id, p_voided_by,
      'Doi soat lo sau khi huy hoa don F&B'
    );
    v_so_cap := v_so_cap + 1;
  end loop;

  -- Bổ sung thông tin đối soát, giữ nguyên mọi khoá cũ của kết quả.
  return coalesce(v_ket_qua, '{}'::jsonb)
      || jsonb_build_object('lots_reconciled_pairs', v_so_cap);
end $$;

-- ── 3. Quyền ──
revoke all on function public._fnb_void_invoice_impl_00165(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;

revoke all on function public.fnb_void_invoice_atomic(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid
) from public, anon;

grant execute on function public.fnb_void_invoice_atomic(
  uuid, uuid, text, uuid, uuid, uuid, uuid, uuid
) to authenticated;

comment on function public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) is
  '00329: lop boc quanh _fnb_void_invoice_impl_00165. Giu nguyen nghiep vu huy, bo sung doi soat so lo (FIFO) theo movement invoice_void thuc te.';
comment on function public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid) is
  '00329: ban 00165 nguyen ven, chi duoc goi tu lop boc fnb_void_invoice_atomic. Khong cap quyen goi truc tiep.';

-- ── 4. Hậu kiểm ngay trong migration ──
do $$
declare
  v_n int;
begin
  if to_regprocedure('public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is null then
    raise exception '00329 that bai: khong thay ham noi bo';
  end if;
  if to_regprocedure('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is null then
    raise exception '00329 that bai: khong thay lop boc';
  end if;

  -- Lớp bọc phải thật sự gọi hàm nội bộ và hàm đối soát
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'fnb_void_invoice_atomic'
    and pg_get_functiondef(p.oid) like '%_fnb_void_invoice_impl_00165%'
    and pg_get_functiondef(p.oid) like '%_reconcile_product_lots_to_branch_00284%';
  if v_n <> 1 then
    raise exception '00329 that bai: lop boc chua goi du ham noi bo + ham doi soat';
  end if;

  -- Hàm nội bộ không được cấp quyền gọi trực tiếp
  select count(*) into v_n
  from information_schema.role_routine_grants
  where routine_schema = 'public'
    and routine_name = '_fnb_void_invoice_impl_00165'
    and grantee in ('anon','authenticated','PUBLIC');
  if v_n <> 0 then
    raise exception '00329 that bai: ham noi bo van con % quyen goi truc tiep', v_n;
  end if;

  -- Luồng Retail không được đụng tới
  if to_regprocedure('public.void_completed_invoice_atomic_v2(uuid,uuid,text,uuid,text,uuid)') is null then
    raise notice '00329: luu y — khong tim thay void_completed_invoice_atomic_v2 dung chu ky mac dinh (khong sao, migration nay khong dung toi)';
  end if;

  raise notice '00329: OK — lop boc da san sang, so lo se duoc doi soat sau moi lan huy hoa don F&B';
end $$;
