-- ============================================================
-- 00079: Phase A báo cáo KHO chi tiết (CEO 16/05/2026)
--
-- 3 báo cáo:
--   1. Aging tồn kho / Dead-stock — tồn nằm kho bao lâu, SP nào không bán
--   2. Tổn thất tồn kho — xuất hủy tổng hợp theo SP/lý do/chi nhánh + giá trị
--   3. Chênh lệch kiểm kê — variance giá trị từ inventory_checks
--
-- Bước 1: thêm cột `unit_cost` (snapshot giá vốn) vào:
--   - disposal_export_items: cho báo cáo tổn thất chính xác (giá hiện tại có thể khác giá lúc hủy)
--   - inventory_check_items: cho báo cáo chênh lệch giá trị
--
-- Bước 2: cập nhật 2 RPC atomic để populate unit_cost khi tạo phiếu:
--   - apply_disposal_export_atomic (00074) → snapshot products.cost_price
--   - apply_inventory_check_atomic (đã có ở migration trước) → snapshot tại thời điểm apply
--
-- Bước 3: 3 RPC báo cáo mới
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1. Thêm cột unit_cost snapshot
-- ────────────────────────────────────────────────────────────────
alter table public.disposal_export_items
  add column if not exists unit_cost numeric(15, 2);
comment on column public.disposal_export_items.unit_cost is
  'Snapshot giá vốn (products.cost_price) tại thời điểm hoàn tất phiếu xuất hủy. Null = phiếu cũ trước migration 00079 → fallback products.cost_price hiện tại khi tính báo cáo. CEO 16/05/2026.';

alter table public.inventory_check_items
  add column if not exists unit_cost numeric(15, 2);
comment on column public.inventory_check_items.unit_cost is
  'Snapshot giá vốn (products.cost_price) tại thời điểm chốt kiểm kê. Null = phiếu cũ trước migration 00079 → fallback products.cost_price hiện tại. CEO 16/05/2026.';

-- ────────────────────────────────────────────────────────────────
-- 2. Cập nhật apply_disposal_export_atomic — snapshot unit_cost
-- ────────────────────────────────────────────────────────────────
create or replace function public.apply_disposal_export_atomic(
  p_disposal_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_disposal record;
  v_actor uuid := coalesce(p_actor_id, auth.uid());
  v_tenant_id uuid;
  v_branch_id uuid;
  v_items_count int := 0;
  v_cost numeric(15, 2);
  r record;
begin
  select * into v_disposal
  from public.disposal_exports
  where id = p_disposal_id
  for update;

  if not found then
    raise exception 'DISPOSAL_NOT_FOUND: %', p_disposal_id;
  end if;

  if v_disposal.status <> 'draft' then
    raise exception 'INVALID_STATUS: phiếu xuất hủy đang ở trạng thái "%" — không thể hoàn tất.', v_disposal.status;
  end if;

  v_tenant_id := v_disposal.tenant_id;
  v_branch_id := v_disposal.branch_id;

  update public.disposal_exports
  set status = 'completed',
      updated_at = now()
  where id = p_disposal_id;

  for r in
    select id, product_id, product_name, quantity
    from public.disposal_export_items
    where disposal_id = p_disposal_id
  loop
    if coalesce(r.quantity, 0) <= 0 then
      continue;
    end if;

    -- Day 13 16/05/2026: snapshot giá vốn vào item để báo cáo tổn thất chính xác
    select coalesce(cost_price, 0) into v_cost
    from public.products
    where id = r.product_id;

    update public.disposal_export_items
    set unit_cost = v_cost
    where id = r.id;

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_tenant_id, v_branch_id, r.product_id, 'out', r.quantity,
      'disposal_export', p_disposal_id,
      v_disposal.code || ' - Xuất hủy - ' || r.product_name || ' (-' || r.quantity || ')',
      coalesce(v_actor, v_disposal.created_by)
    );

    perform public.increment_product_stock(r.product_id, -r.quantity);
    perform public.upsert_branch_stock(v_tenant_id, v_branch_id, r.product_id, -r.quantity);

    begin
      perform public.allocate_lots_fifo(
        v_tenant_id, r.product_id, v_branch_id, r.quantity,
        'disposal_export', p_disposal_id
      );
    exception when others then null;
    end;

    v_items_count := v_items_count + 1;
  end loop;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_tenant_id,
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    'complete_disposal',
    'disposal_export',
    p_disposal_id,
    jsonb_build_object(
      'code', v_disposal.code,
      'items_count', v_items_count,
      'completed_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'disposal_id', p_disposal_id,
    'code', v_disposal.code,
    'items_processed', v_items_count
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────
-- 3. RPC: get_inventory_aging_report
-- Trả về list SP có tồn > 0, kèm last_in_date / days_in_stock / last_sale_date
-- + aging bucket (0-30 / 31-60 / 61-90 / 91+).
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_inventory_aging_report(
  p_tenant_id uuid default null,
  p_branch_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant_id uuid;
begin
  v_tenant_id := coalesce(
    p_tenant_id,
    (select tenant_id from public.profiles where id = auth.uid())
  );

  if v_tenant_id is null then
    raise exception 'TENANT_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      with stock_with_branch as (
        -- Nếu p_branch_id null → tổng hợp; có branch → filter theo branch
        select
          p.id as product_id,
          p.code,
          p.name,
          coalesce(p.cost_price, 0) as cost_price,
          case
            when p_branch_id is null then coalesce(p.stock, 0)
            else coalesce(bs.quantity, 0)
          end as current_qty
        from public.products p
        left join public.branch_stock bs on bs.product_id = p.id
          and bs.branch_id = p_branch_id
        where p.tenant_id = v_tenant_id
      ),
      last_in as (
        select sm.product_id, max(sm.created_at) as last_in_date
        from public.stock_movements sm
        where sm.tenant_id = v_tenant_id
          and sm.type = 'in'
          and (p_branch_id is null or sm.branch_id = p_branch_id)
        group by sm.product_id
      ),
      last_sale as (
        select ii.product_id, max(i.created_at) as last_sale_date
        from public.invoice_items ii
        join public.invoices i on i.id = ii.invoice_id
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and (p_branch_id is null or i.branch_id = p_branch_id)
        group by ii.product_id
      )
      select coalesce(jsonb_agg(row_to_json(t) order by t.days_in_stock desc nulls last), '[]'::jsonb)
      from (
        select
          s.product_id,
          s.code,
          s.name,
          s.current_qty,
          s.cost_price,
          (s.current_qty * s.cost_price) as stock_value,
          li.last_in_date,
          extract(day from (now() - li.last_in_date))::int as days_in_stock,
          ls.last_sale_date,
          case
            when ls.last_sale_date is null then null
            else extract(day from (now() - ls.last_sale_date))::int
          end as days_since_last_sale,
          case
            when li.last_in_date is null then 'unknown'
            when (now() - li.last_in_date) <= interval '30 days' then '0-30'
            when (now() - li.last_in_date) <= interval '60 days' then '31-60'
            when (now() - li.last_in_date) <= interval '90 days' then '61-90'
            else '91+'
          end as aging_bucket,
          -- Dead-stock = không bán trong 60 ngày + tồn > 0
          case
            when s.current_qty > 0
              and (ls.last_sale_date is null
                or (now() - ls.last_sale_date) > interval '60 days')
            then true
            else false
          end as is_dead_stock
        from stock_with_branch s
        left join last_in li on li.product_id = s.product_id
        left join last_sale ls on ls.product_id = s.product_id
        where s.current_qty > 0
      ) t
    )
  );
end;
$$;

comment on function public.get_inventory_aging_report is
  'Báo cáo aging tồn kho: SP có tồn > 0, ngày nhập gần nhất, days_in_stock, aging bucket, dead-stock flag. CEO 16/05/2026.';

grant execute on function public.get_inventory_aging_report(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 4. RPC: get_disposal_loss_report
-- Tổng hợp xuất hủy theo SP/lý do/chi nhánh trong kỳ
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_disposal_loss_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
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

  -- Default range = 30 ngày gần nhất
  v_from := coalesce(p_date_from, now() - interval '30 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.loss_value desc nulls last), '[]'::jsonb)
      from (
        select
          de.id as disposal_id,
          de.code as disposal_code,
          de.created_at as disposal_date,
          de.branch_id,
          b.name as branch_name,
          coalesce(de.reason, 'Không ghi rõ') as reason,
          dei.product_id,
          dei.product_name,
          dei.quantity,
          -- Fallback: nếu unit_cost null (phiếu cũ trước 00079), lấy giá hiện tại
          coalesce(dei.unit_cost, p.cost_price, 0) as unit_cost,
          (dei.quantity * coalesce(dei.unit_cost, p.cost_price, 0)) as loss_value,
          de.created_by
        from public.disposal_exports de
        join public.disposal_export_items dei on dei.disposal_id = de.id
        left join public.products p on p.id = dei.product_id
        left join public.branches b on b.id = de.branch_id
        where de.tenant_id = v_tenant_id
          and de.status = 'completed'
          and de.created_at >= v_from
          and de.created_at <= v_to
          and (p_branch_id is null or de.branch_id = p_branch_id)
      ) t
    )
  );
end;
$$;

comment on function public.get_disposal_loss_report is
  'Báo cáo tổn thất tồn kho: chi tiết từng item xuất hủy + giá trị (unit_cost snapshot từ 00079, fallback products.cost_price). CEO 16/05/2026.';

grant execute on function public.get_disposal_loss_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- 5. RPC: get_inventory_variance_report
-- Chênh lệch kiểm kê — chi tiết từng item + giá trị
-- ────────────────────────────────────────────────────────────────
create or replace function public.get_inventory_variance_report(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_branch_id uuid default null,
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

  v_from := coalesce(p_date_from, now() - interval '90 days');
  v_to := coalesce(p_date_to, now());

  return jsonb_build_object(
    'generated_at', now(),
    'date_from', v_from,
    'date_to', v_to,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.variance_value asc nulls last), '[]'::jsonb)
      from (
        select
          ic.id as check_id,
          ic.code as check_code,
          ic.created_at as check_date,
          ic.branch_id,
          b.name as branch_name,
          ici.product_id,
          ici.product_name,
          ici.system_stock,
          ici.actual_stock,
          ici.difference,
          coalesce(ici.unit_cost, p.cost_price, 0) as unit_cost,
          (ici.difference * coalesce(ici.unit_cost, p.cost_price, 0)) as variance_value,
          case
            when ici.difference > 0 then 'thừa'
            when ici.difference < 0 then 'thiếu'
            else 'khớp'
          end as variance_type,
          ic.status
        from public.inventory_checks ic
        join public.inventory_check_items ici on ici.check_id = ic.id
        left join public.products p on p.id = ici.product_id
        left join public.branches b on b.id = ic.branch_id
        where ic.tenant_id = v_tenant_id
          and ic.status = 'balanced'
          and ic.created_at >= v_from
          and ic.created_at <= v_to
          and (p_branch_id is null or ic.branch_id = p_branch_id)
          and ici.difference <> 0  -- chỉ list các dòng có chênh lệch
      ) t
    )
  );
end;
$$;

comment on function public.get_inventory_variance_report is
  'Báo cáo chênh lệch kiểm kê: từng dòng có variance, giá trị thiệt hại/dư. CEO 16/05/2026.';

grant execute on function public.get_inventory_variance_report(timestamptz, timestamptz, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
