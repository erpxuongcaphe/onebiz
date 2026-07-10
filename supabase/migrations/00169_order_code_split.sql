-- ============================================================
-- 00169 — Tách dãy mã: nháp POS = NH, đơn đặt hàng = DH, hóa đơn = HD
-- (CEO 10/07/2026)
-- ============================================================
-- VẤN ĐỀ: nháp POS + đơn đặt hàng đều lấy số 'invoice' (HD) NGAY khi tạo →
-- nháp hủy là dãy HD của hóa đơn HOÀN THÀNH bị lỗ số. CEO yêu cầu số HD chỉ
-- cấp khi THANH TOÁN xong (đúng chuẩn KiotViet/Odoo + luật HĐĐT VN).
--
-- GIẢI PHÁP (không đụng data cũ):
--   1) Thêm 2 bộ đếm mã: 'order' → 'DH', 'pos_draft' → 'NH'. Service sẽ cấp
--      DH cho đơn đặt hàng, NH cho nháp POS (thay vì HD). Dãy DH/NH lỗ số
--      thoải mái — không ai quan tâm.
--   2) Cột invoices.order_code: khi hoàn tất, lưu mã DH/NH cũ để TRUY VẾT
--      (phiếu tạm tính khách cầm mã DH vẫn tra ra hóa đơn HD).
--   3) complete_draft_atomic v2: khi hoàn tất 1 đơn có mã CHƯA phải HD
--      (DH/NH) → cấp HD mới + order_code = mã cũ. Nếu mã ĐÃ là HD (nháp CŨ
--      tạo trước thay đổi này) → GIỮ NGUYÊN (không cấp HD mới, không đụng data
--      lịch sử). Nhờ vậy KHÔNG cần di trú hàng loạt nháp cũ.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Cột order_code + index (truy vết + tìm kiếm)
-- ────────────────────────────────────────────────────────────────
alter table public.invoices
  add column if not exists order_code text;

comment on column public.invoices.order_code is
  'CEO 10/07/2026 — mã đơn gốc (DH đặt hàng / NH nháp POS) TRƯỚC khi hoàn tất '
  'thành hóa đơn HD. Cho phép tra ngược phiếu tạm tính/đặt hàng ↔ hóa đơn. '
  'NULL = đơn bán thẳng không qua nháp, hoặc nháp cũ (mã HD giữ nguyên).';

create index if not exists idx_invoices_order_code
  on public.invoices (tenant_id, order_code)
  where order_code is not null;

-- ────────────────────────────────────────────────────────────────
-- 2. Seed 2 bộ đếm mã cho mọi tenant: DH (đơn đặt hàng) + NH (nháp POS)
--    prefix PHẢI seed đúng — nếu để next_code tự tạo sẽ ra 'OR'/'PO' (sai).
-- ────────────────────────────────────────────────────────────────
-- AN TOÀN THỨ TỰ: nếu code deploy TRƯỚC migration, next_code đã tự tạo bộ đếm
-- với prefix sai ('OR'/'PO'). Sửa lại prefix đúng (giữ current_number đang có).
update public.code_sequences set prefix = 'DH' where entity_type = 'order'     and prefix <> 'DH';
update public.code_sequences set prefix = 'NH' where entity_type = 'pos_draft' and prefix <> 'NH';

insert into public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
select t.id, 'order', 'DH', 0, 6
from public.tenants t
where not exists (
  select 1 from public.code_sequences cs
  where cs.tenant_id = t.id and cs.entity_type = 'order'
);

insert into public.code_sequences (tenant_id, entity_type, prefix, current_number, padding)
select t.id, 'pos_draft', 'NH', 0, 6
from public.tenants t
where not exists (
  select 1 from public.code_sequences cs
  where cs.tenant_id = t.id and cs.entity_type = 'pos_draft'
);

-- ────────────────────────────────────────────────────────────────
-- 3. complete_draft_atomic v2 — cấp HD lúc hoàn tất (nếu mã chưa là HD)
--    Tái tạo NGUYÊN VĂN 00139, chỉ thêm khối cấp HD + order_code ngay sau
--    claim; và dùng v_hd_code (mã HD cuối) cho mọi note/consume/return.
-- ────────────────────────────────────────────────────────────────
create or replace function public.complete_draft_atomic(
  p_invoice_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_created_by uuid,
  p_method text,
  p_paid numeric,
  p_payment_breakdown jsonb default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_invoice record;
  v_item record;
  v_total numeric;
  v_debt numeric;
  v_has_bom boolean;
  v_bom_result jsonb;
  v_bom_results jsonb := '[]'::jsonb;
  v_breakdown_item jsonb;
  v_method text;
  v_amount numeric;
  v_cash_code text;
  v_method_label text;
  v_hd_code text;  -- 00169: mã HD cuối (cấp mới nếu đơn còn mang mã DH/NH).
begin
  -- Bước 1+2: ATOMIC claim status='draft' → 'completed' với shift_id + payment_method.
  update public.invoices
  set
    status = 'completed',
    paid = coalesce(p_paid, 0),
    payment_method = p_method,
    shift_id = case when p_shift_id is not null then p_shift_id else shift_id end
  where id = p_invoice_id
    and tenant_id = p_tenant_id
    and status = 'draft'
  returning id, code, total, customer_name, branch_id
  into v_invoice;

  if not found then
    select status into v_method
    from public.invoices
    where id = p_invoice_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Không tìm thấy đơn nháp (id=%)', p_invoice_id;
    else
      raise exception 'Đơn này đã được xử lý (trạng thái: %). Không thể hoàn tất lại.', v_method;
    end if;
  end if;

  -- 00169: cấp mã HD lúc HOÀN TẤT. Đơn mang mã DH (đặt hàng) / NH (nháp POS)
  -- → cấp HD mới + lưu mã cũ vào order_code (truy vết). Đơn đã mang mã HD (nháp
  -- CŨ tạo trước thay đổi này) → GIỮ NGUYÊN, không cấp mới (không đụng lịch sử).
  v_hd_code := v_invoice.code;
  if v_invoice.code is null or v_invoice.code not like 'HD%' then
    v_hd_code := public.next_code(p_tenant_id, 'invoice');
    if v_hd_code is null or v_hd_code = '' then
      v_hd_code := 'HD' || extract(epoch from now())::bigint::text;
    end if;
    update public.invoices
    set order_code = v_invoice.code, code = v_hd_code
    where id = p_invoice_id and tenant_id = p_tenant_id;
  end if;

  v_total := coalesce(v_invoice.total, 0);
  v_debt := greatest(0, v_total - coalesce(p_paid, 0));

  update public.invoices
  set debt = v_debt
  where id = p_invoice_id and tenant_id = p_tenant_id;

  -- Bước 3+4: Loop invoice_items, trừ stock + BOM consume.
  for v_item in
    select product_id, product_name, unit, quantity
    from public.invoice_items
    where invoice_id = p_invoice_id
  loop
    if v_item.product_id is null or v_item.quantity <= 0 then
      continue;
    end if;

    select coalesce(has_bom, false) into v_has_bom
    from public.products where id = v_item.product_id;

    if v_has_bom then
      v_bom_result := public.consume_bom_for_sale(
        p_tenant_id, p_branch_id, v_item.product_id, v_item.quantity,
        p_invoice_id, p_created_by, v_hd_code
      );
      v_bom_results := v_bom_results || jsonb_build_object(
        'product_id', v_item.product_id,
        'product_name', v_item.product_name,
        'sale_qty', v_item.quantity,
        'result', v_bom_result
      );
    else
      insert into public.stock_movements (
        tenant_id, branch_id, product_id, type, quantity,
        reference_type, reference_id, note, created_by
      ) values (
        p_tenant_id, p_branch_id, v_item.product_id, 'out', v_item.quantity,
        'invoice', p_invoice_id,
        'POS hoàn tất nháp - ' || v_hd_code, p_created_by
      );

      perform public.increment_product_stock(v_item.product_id, -v_item.quantity);
      perform public.upsert_branch_stock(
        p_tenant_id, p_branch_id, v_item.product_id, -v_item.quantity
      );

      begin
        perform public.allocate_lots_fifo(
          p_tenant_id, v_item.product_id, p_branch_id, v_item.quantity,
          'invoice', p_invoice_id
        );
      exception when others then null;
      end;
    end if;
  end loop;

  -- Bước 5: Cash transactions (chỉ khi paid > 0).
  if coalesce(p_paid, 0) > 0 then
    if p_method = 'mixed' and p_payment_breakdown is not null
       and jsonb_typeof(p_payment_breakdown) = 'array'
       and jsonb_array_length(p_payment_breakdown) > 0 then
      for v_breakdown_item in select * from jsonb_array_elements(p_payment_breakdown) loop
        v_amount := coalesce((v_breakdown_item->>'amount')::numeric, 0);
        v_method := v_breakdown_item->>'method';
        if v_amount > 0 and v_method in ('cash', 'transfer', 'card') then
          v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
          if v_cash_code is null or v_cash_code = '' then
            v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
          end if;
          v_method_label := case v_method
            when 'cash' then 'tiền mặt'
            when 'transfer' then 'chuyển khoản'
            when 'card' then 'thẻ' else v_method end;
          insert into public.cash_transactions (
            tenant_id, branch_id, code, type, category, amount,
            counterparty, payment_method, reference_type, reference_id,
            note, created_by, shift_id
          ) values (
            p_tenant_id, p_branch_id, v_cash_code, 'receipt', 'Bán hàng', v_amount,
            coalesce(v_invoice.customer_name, 'Khách lẻ'), v_method,
            'invoice', p_invoice_id,
            'Thu tiền HĐ ' || v_hd_code || ' (' || v_method_label || ')',
            p_created_by, p_shift_id
          );
        end if;
      end loop;
    else
      v_cash_code := public.next_code(p_tenant_id, 'cash_receipt');
      if v_cash_code is null or v_cash_code = '' then
        v_cash_code := 'PT' || extract(epoch from now())::bigint::text;
      end if;
      insert into public.cash_transactions (
        tenant_id, branch_id, code, type, category, amount,
        counterparty, payment_method, reference_type, reference_id,
        note, created_by, shift_id
      ) values (
        p_tenant_id, p_branch_id, v_cash_code, 'receipt', 'Bán hàng', p_paid,
        coalesce(v_invoice.customer_name, 'Khách lẻ'),
        case when p_method = 'mixed' then 'cash' else p_method end,
        'invoice', p_invoice_id,
        'Thu tiền HĐ ' || v_hd_code,
        p_created_by, p_shift_id
      );
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'invoice_code', v_hd_code,
    'order_code', case when v_hd_code <> v_invoice.code then v_invoice.code else null end,
    'total', v_total,
    'paid', p_paid,
    'debt', v_debt,
    'bom_consume_results', v_bom_results
  );
end;
$$;

comment on function public.complete_draft_atomic is
  'Complete draft → invoice v2 (00169, CEO 10/07): cấp mã HD lúc hoàn tất (đơn '
  'DH/NH → HD mới + order_code = mã cũ; nháp cũ mã HD giữ nguyên). Giữ nguyên '
  '5-op atomic + BOM consume + cash của 00139.';

grant execute on function public.complete_draft_atomic to authenticated;

notify pgrst, 'reload schema';

-- ============================================================
-- VERIFY sau khi áp (CEO chạy — read-only):
-- 1) 2 bộ đếm mới đã seed đúng prefix:
--    select entity_type, prefix, current_number from public.code_sequences
--    where tenant_id = '148e8ac5-b891-4de3-9055-cfa41f39ddb0'
--      and entity_type in ('order','pos_draft','invoice');
--    -- Kỳ vọng: order=DH, pos_draft=NH, invoice=HD.
-- 2) Cột order_code tồn tại:
--    select column_name from information_schema.columns
--    where table_name='invoices' and column_name='order_code';
-- 3) Hàm cấp HD lúc hoàn tất:
--    select pg_get_functiondef('public.complete_draft_atomic'::regproc) like '%order_code%';
-- ============================================================
