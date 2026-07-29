-- ============================================================
-- 00234 — Sửa phiếu nhập KHÔNG cần huỷ (phần không đụng kho)
-- ============================================================
-- CEO 29/07: "sửa phiếu nhập có thể nhập sai gì đó mà không cần hủy".
--
-- BỐI CẢNH
-- Trước đây muốn sửa bất cứ gì trên phiếu đã nhập kho đều phải hoàn nhập
-- toàn bộ rồi làm lại. Sửa một con số giá cũng bắt đụng tới kho — và nếu
-- hàng đã bán bớt thì bị chặn luôn (đúng: rút hàng ra sẽ âm kho).
-- Đo trên dữ liệu thật: 120/128 phiếu hoàn thành đã bán bớt, nên đường
-- "huỷ rồi làm lại" gần như luôn tắc.
--
-- Hàm này cho sửa PHẦN KHÔNG ĐỤNG KHO: nhà cung cấp, ghi chú, đơn giá,
-- chiết khấu, thuế, phí vận chuyển, chi phí khác, giảm giá cả phiếu.
--
-- TUYỆT ĐỐI KHÔNG ĐỤNG
--   quantity · received_quantity · products.stock · branch_stock
--   stock_movements · product_lots · paid
-- Muốn đổi SỐ LƯỢNG thì vẫn phải hoàn nhập như cũ — không có đường tắt.
--
-- ⚠️ CHỈ CỘNG PHẦN CHÊNH, KHÔNG TÍNH LẠI TỪ ĐẦU
-- Kiểm ngược 40 phiếu gần nhất: công thức dòng / tổng phụ / công nợ khớp
-- 100%, nhưng TỔNG TIỀN PHIẾU chỉ khớp 37/40 — vài phiếu cũ tính theo cách
-- khác (PO000147 không trừ discount_amount, PO000121 lệch 1.119.001,
-- PO000115 lệch 1đ do làm tròn).
-- Nếu tính lại tổng từ đầu thì 3 phiếu đó bị đổi số oan dù người dùng chỉ
-- sửa một dòng. Nên hàm này CỘNG DỒN phần chênh vào số đang có — mọi sai
-- lệch lịch sử được giữ nguyên vẹn.
--
-- ⚠️ GIÁ VỐN KHÔNG ĐỔI. Hàng đã bán thì giá vốn đã chốt vào hoá đơn bán từ
-- lúc đó (đúng chuẩn kế toán, không hồi tố). Màn hình sẽ nói rõ điều này.
-- ============================================================

create or replace function public.update_purchase_order_prices(
  p_order_id uuid,
  p_items jsonb,                      -- [{id, unit_price, discount, vat_rate}]
  p_supplier_id uuid default null,
  p_supplier_name text default null,
  p_note text default null,
  p_shipping_cost numeric default null,
  p_other_cost numeric default null,
  p_order_discount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po           public.purchase_orders%rowtype;
  v_it           record;
  v_moi          jsonb;
  v_gia          numeric;
  v_ck           numeric;
  v_vat_rate     numeric;
  v_total_moi    numeric;
  v_vat_moi      numeric;
  v_delta_sub    numeric := 0;
  v_delta_vat    numeric := 0;
  v_delta_khac   numeric := 0;
  v_so_dong      int := 0;
  v_total_cu     numeric;
begin
  -- Khoá phiếu: hai người sửa cùng lúc phải xếp hàng
  select * into v_po
    from public.purchase_orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Không tìm thấy phiếu nhập';
  end if;

  if coalesce(v_po.status, '') = 'cancelled' then
    raise exception 'Phiếu đã huỷ — không sửa được';
  end if;

  v_total_cu := coalesce(v_po.total, 0);

  -- ── Từng dòng hàng: chỉ đụng GIÁ, giữ nguyên SỐ LƯỢNG ──
  for v_moi in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    select * into v_it
      from public.purchase_order_items
     where id = (v_moi->>'id')::uuid
       and purchase_order_id = p_order_id
     for update;

    if not found then
      raise exception 'Dòng hàng % không thuộc phiếu này', v_moi->>'id';
    end if;

    v_gia      := coalesce((v_moi->>'unit_price')::numeric, v_it.unit_price);
    v_ck       := coalesce((v_moi->>'discount')::numeric, coalesce(v_it.discount, 0));
    v_vat_rate := coalesce((v_moi->>'vat_rate')::numeric, coalesce(v_it.vat_rate, 0));

    if v_gia < 0 or v_ck < 0 or v_vat_rate < 0 then
      raise exception 'Giá, chiết khấu và thuế không được âm';
    end if;

    -- Công thức đã kiểm ngược trên 133 dòng thật: khớp 100%
    v_total_moi := round(v_it.quantity * v_gia - v_ck, 0);
    if v_total_moi < 0 then
      raise exception 'Chiết khấu (%) lớn hơn tiền hàng của dòng "%"', v_ck, v_it.product_name;
    end if;
    v_vat_moi := round(v_total_moi * v_vat_rate / 100, 0);

    v_delta_sub := v_delta_sub + (v_total_moi - coalesce(v_it.total, 0));
    v_delta_vat := v_delta_vat + (v_vat_moi - coalesce(v_it.vat_amount, 0));

    update public.purchase_order_items
       set unit_price = v_gia,
           discount   = v_ck,
           vat_rate   = v_vat_rate,
           vat_amount = v_vat_moi,
           total      = v_total_moi
     where id = v_it.id;
    -- KHÔNG đụng quantity / received_quantity

    v_so_dong := v_so_dong + 1;
  end loop;

  -- ── Chi phí cấp phiếu: cũng chỉ lấy phần chênh ──
  if p_shipping_cost is not null then
    v_delta_khac := v_delta_khac + (p_shipping_cost - coalesce(v_po.shipping_cost, 0));
  end if;
  if p_other_cost is not null then
    v_delta_khac := v_delta_khac + (p_other_cost - coalesce(v_po.other_cost, 0));
  end if;
  if p_order_discount is not null then
    v_delta_khac := v_delta_khac - (p_order_discount - coalesce(v_po.order_discount, 0));
  end if;

  -- ── Cập nhật phiếu: CỘNG DỒN, không tính lại từ đầu ──
  update public.purchase_orders
     set subtotal      = coalesce(subtotal, 0) + v_delta_sub,
         tax_amount    = coalesce(tax_amount, 0) + v_delta_vat,
         total         = coalesce(total, 0) + v_delta_sub + v_delta_vat + v_delta_khac,
         shipping_cost = coalesce(p_shipping_cost, shipping_cost),
         other_cost    = coalesce(p_other_cost, other_cost),
         order_discount = coalesce(p_order_discount, order_discount),
         supplier_id   = coalesce(p_supplier_id, supplier_id),
         supplier_name = coalesce(p_supplier_name, supplier_name),
         note          = coalesce(p_note, note),
         updated_at    = now()
   where id = p_order_id;

  -- Công nợ đi theo tổng mới (công thức này khớp 40/40 phiếu thật)
  update public.purchase_orders
     set debt = greatest(0, coalesce(total, 0) - coalesce(paid, 0))
   where id = p_order_id;

  select * into v_po from public.purchase_orders where id = p_order_id;

  return jsonb_build_object(
    'so_dong_sua', v_so_dong,
    'tong_cu',     v_total_cu,
    'tong_moi',    v_po.total,
    'chenh_lech',  v_po.total - v_total_cu,
    'da_tra',      v_po.paid,
    'con_no',      v_po.debt
  );
end;
$$;

grant execute on function public.update_purchase_order_prices(
  uuid, jsonb, uuid, text, text, numeric, numeric, numeric
) to authenticated;

-- ============================================================
-- ĐỐI CHIẾU — chạy sau khi áp, KHÔNG đụng dữ liệu
-- ============================================================
-- 1) Hàm đã có:
-- select proname from pg_proc where proname = 'update_purchase_order_prices';
--
-- 2) Sau khi sửa thử 1 phiếu, ba thứ này PHẢI y nguyên:
-- select sum(quantity), sum(received_quantity) from public.purchase_order_items
--  where purchase_order_id = '<id>';
-- select quantity from public.branch_stock where product_id = '<id hàng>';
-- select count(*) from public.stock_movements where reference_id = '<id phiếu>';
