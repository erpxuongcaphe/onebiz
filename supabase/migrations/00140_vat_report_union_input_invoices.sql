-- ============================================================
-- 00140: get_vat_report — UNION input_invoices + exclude internal
-- (CEO P0-13, 13/06/2026)
--
-- KHẢO SÁT NGUỒN GỐC TAX:
--   1. invoices.tax_amount: tạo từ POS Retail/FnB + createInternalSale.
--      → source='internal' = bán nội bộ chuỗi (KHÔNG khai thuế).
--   2. purchase_orders.tax_amount: nhập hàng từ NCC ngoài.
--   3. input_invoices.tax_amount:
--      a. Auto-tạo từ receive_purchase_items_atomic (00028): tax=0 +
--         purchase_order_id link (PO đã count tax → KHÔNG count lại).
--      b. createInternalSale (internal-sales.ts): supplier is_internal,
--         tax > 0 → KHÔNG khai thuế (internal).
--      c. Có thể tạo từ form manual sau này (chưa có nhưng để phòng):
--         supplier KHÔNG is_internal, purchase_order_id IS NULL → KHAI THUẾ.
--
-- FIX:
--   - Output: EXCLUDE invoices.source='internal' (không khai bán nội bộ).
--   - Input: UNION purchase_orders + input_invoices WHERE
--     supplier KHÔNG is_internal AND purchase_order_id IS NULL.
--     → Chống double với PO + exclude internal.
--
-- Không break service signature (vẫn trả jsonb cùng shape).
--
-- LƯU Ý 13/06/2026: DB có nhiều overload get_vat_report cũ → PG báo
-- "function name not unique" khi CREATE OR REPLACE. DROP signature
-- exact trước khi CREATE để đảm bảo idempotent.
-- ============================================================

-- Drop signature cũ exact (chỉ overload 3-arg). Các overload khác (nếu có)
-- giữ nguyên — sẽ được PG dispatch theo arg list.
drop function if exists public.get_vat_report(timestamptz, timestamptz, uuid);

create or replace function public.get_vat_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
  v_from timestamptz;
  v_to timestamptz;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );

  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  v_from := coalesce(p_date_from, date_trunc('month', now()));
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    -- VAT output (bán ra) — P0-13: EXCLUDE source='internal' để không khai
    -- bán nội bộ chuỗi vào báo cáo VAT khai thuế.
    'output', (
      select row_to_json(o) from (
        select
          coalesce(sum(i.tax_amount), 0) as total_tax,
          coalesce(sum(i.subtotal), 0) as total_taxable,
          count(*) as invoice_count
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and coalesce(i.source, 'pos') <> 'internal'
          and i.created_at >= v_from
          and i.created_at <= v_to
      ) o
    ),
    -- VAT input (mua vào) — P0-13: UNION purchase_orders + input_invoices.
    -- input_invoices EXCLUDE:
    --   - supplier is_internal (mua nội bộ — không khai khấu trừ)
    --   - purchase_order_id IS NOT NULL (chống double — PO đã count tax)
    'input', (
      select row_to_json(t) from (
        select
          coalesce(po_sum.total_tax, 0) + coalesce(ii_sum.total_tax, 0) as total_tax,
          coalesce(po_sum.total_taxable, 0) + coalesce(ii_sum.total_taxable, 0) as total_taxable,
          coalesce(po_sum.po_count, 0) + coalesce(ii_sum.ii_count, 0) as po_count
        from (
          select
            coalesce(sum(po.tax_amount), 0) as total_tax,
            coalesce(sum(po.total - po.tax_amount), 0) as total_taxable,
            count(*) as po_count
          from public.purchase_orders po
          where po.tenant_id = v_tenant_id
            and po.status = 'completed'
            and po.created_at >= v_from
            and po.created_at <= v_to
        ) po_sum
        cross join (
          select
            coalesce(sum(ii.tax_amount), 0) as total_tax,
            coalesce(sum(ii.total_amount - ii.tax_amount), 0) as total_taxable,
            count(*) as ii_count
          from public.input_invoices ii
          left join public.suppliers s on s.id = ii.supplier_id
          where ii.tenant_id = v_tenant_id
            and ii.status = 'recorded'
            and ii.tax_amount > 0
            and ii.purchase_order_id is null
            and coalesce(s.is_internal, false) = false
            and ii.created_at >= v_from
            and ii.created_at <= v_to
        ) ii_sum
      ) t
    ),
    -- Chi tiết invoices có VAT (đầu ra) — EXCLUDE internal
    'output_detail', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
      from (
        select
          i.id,
          i.code,
          i.created_at,
          i.customer_name,
          i.subtotal,
          i.tax_amount,
          i.total
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.tax_amount > 0
          and coalesce(i.source, 'pos') <> 'internal'
          and i.created_at >= v_from
          and i.created_at <= v_to
        limit 500
      ) t
    ),
    -- Chi tiết đầu vào — UNION purchase_orders + input_invoices (cùng filter input sum)
    'input_detail', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
      from (
        select id, code, created_at, supplier_name, tax_amount, total
        from (
          select
            po.id,
            po.code,
            po.created_at,
            po.supplier_name,
            po.tax_amount,
            po.total
          from public.purchase_orders po
          where po.tenant_id = v_tenant_id
            and po.status = 'completed'
            and po.tax_amount > 0
            and po.created_at >= v_from
            and po.created_at <= v_to
          union all
          select
            ii.id,
            ii.code,
            ii.created_at,
            ii.supplier_name,
            ii.tax_amount,
            ii.total_amount as total
          from public.input_invoices ii
          left join public.suppliers s on s.id = ii.supplier_id
          where ii.tenant_id = v_tenant_id
            and ii.status = 'recorded'
            and ii.tax_amount > 0
            and ii.purchase_order_id is null
            and coalesce(s.is_internal, false) = false
            and ii.created_at >= v_from
            and ii.created_at <= v_to
        ) merged
        order by created_at desc
        limit 500
      ) t
    )
  );
end;
$$;

comment on function public.get_vat_report(timestamptz, timestamptz, uuid) is
  'Báo cáo VAT đầu vào / đầu ra theo kỳ. P0-13 fix (13/06/2026): EXCLUDE '
  'invoices.source=internal khỏi output + UNION input_invoices vào input '
  '(filter: NOT internal supplier + NOT purchase_order_id link).';

grant execute on function public.get_vat_report(timestamptz, timestamptz, uuid) to authenticated;
