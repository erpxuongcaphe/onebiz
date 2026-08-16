-- ============================================================================
-- POSTFLIGHT 00329 — kiểm sau khi chạy migration. CHỈ ĐỌC.
-- Bôi đen toàn bộ → Run. Tenant OneBiz dán sẵn.
-- ============================================================================

with t as (select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as id),
ham as (
  select p.oid, p.proname, pg_get_functiondef(p.oid) as def, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('fnb_void_invoice_atomic','_fnb_void_invoice_impl_00165',
                      '_reconcile_product_lots_to_branch_00284',
                      'void_completed_invoice_atomic_v2','create_sales_return_atomic')
)

select 1 as stt, '1. LỚP BỌC' as muc,
       'tồn tại=' || (to_regprocedure('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is not null)::text
    || ' | gọi hàm nội bộ=' || (h.def ~ '_fnb_void_invoice_impl_00165')::text
    || ' | gọi đối soát lô=' || (h.def ~ '_reconcile_product_lots_to_branch_00284')::text
    || ' | lọc invoice_void=' || (h.def ~ 'invoice_void')::text as ket_qua
from ham h where h.proname = 'fnb_void_invoice_atomic'

union all
select 2, '2. HÀM NỘI BỘ (bản 00165 nguyên vẹn)',
       'tồn tại=' || (to_regprocedure('public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)') is not null)::text
    || ' | dài=' || length(h.def)::text
    || ' | vẫn có 2 vòng hoàn kho=' || (h.def ~ 'bom_consume')::text
from ham h where h.proname = '_fnb_void_invoice_impl_00165'

union all
select 3, '3. QUYỀN GỌI',
       'lớp bọc → authenticated=' ||
       (exists (select 1 from information_schema.role_routine_grants g
                where g.routine_schema='public' and g.routine_name='fnb_void_invoice_atomic'
                  and g.grantee='authenticated' and g.privilege_type='EXECUTE'))::text
    || ' | hàm nội bộ còn quyền ngoài=' ||
       (select count(*)::text from information_schema.role_routine_grants g
        where g.routine_schema='public' and g.routine_name='_fnb_void_invoice_impl_00165'
          and g.grantee in ('anon','authenticated','PUBLIC'))

union all
select 4, '4. RETAIL KHÔNG BỊ ĐỤNG',
       'void_completed_invoice_atomic_v2 tồn tại=' ||
       (select count(*)::text from ham where proname='void_completed_invoice_atomic_v2')
    || ' | trả hàng vẫn gọi đối soát=' ||
       (select coalesce(max((def ~ '_reconcile_product_lots_to_branch_00284')::text),'không thấy hàm')
        from ham where proname='create_sales_return_atomic')

union all
select 5, '5. DỮ LIỆU KHÔNG ĐỔI — hoá đơn F&B',
       'tổng=' || count(*)::text || ' | đã huỷ=' || count(*) filter (where i.status='cancelled')::text
from public.invoices i cross join t where i.tenant_id = t.id and i.source = 'fnb'

union all
select 6, '6. DỮ LIỆU KHÔNG ĐỔI — movement theo loại',
       coalesce(string_agg(x.reference_type || '=' || x.so::text, ' | ' order by x.reference_type), 'KHÔNG CÓ')
from (select sm.reference_type, count(*) as so
      from public.stock_movements sm cross join t
      where sm.tenant_id = t.id
        and sm.reference_type in ('invoice','bom_consume','modifier_topping','invoice_void')
      group by sm.reference_type) x

union all
select 7, '7. LỊCH SỬ HUỶ — đếm ĐÚNG số hoá đơn (distinct), tách kênh',
       coalesce(string_agg(y.nguon || ': ' || y.so_hoa_don::text || ' hoá đơn / ' || y.so_dong::text || ' dòng',
                           ' | ' order by y.nguon), 'KHÔNG CÓ')
from (
  select coalesce(i.source, '(không rõ)') as nguon,
         count(distinct sm.reference_id) as so_hoa_don,
         count(*) as so_dong
  from public.stock_movements sm
  cross join t
  left join public.invoices i on i.id = sm.reference_id and i.tenant_id = t.id
  where sm.tenant_id = t.id and sm.reference_type = 'invoice_void'
  group by coalesce(i.source, '(không rõ)')
) y

order by 1;
