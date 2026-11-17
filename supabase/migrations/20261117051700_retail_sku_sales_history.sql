begin;

create function public.read_retail_sku_sales_history(
  p_product_id uuid, p_branch_id uuid, p_offset integer, p_limit integer
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  tenant uuid := public.get_user_tenant_id();
  result jsonb;
begin
  if tenant is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.tenant_id = tenant and p.is_active
  ) then
    raise exception 'RETAIL_SKU_HISTORY_NOT_ACCESSIBLE' using errcode = '42501';
  end if;

  with candidates as materialized (
    select l.id, l.quantity, l.unit_price, l.discount, l.total,
           i.code, coalesce(i.ngay_chung_tu, i.created_at) as ngay_chung_tu,
           i.customer_name, i.created_by, i.branch_id,
           coalesce(i.source, 'pos') as source
    from public.invoice_items l
    join public.invoices i on i.id = l.invoice_id
    where l.product_id = p_product_id and i.tenant_id = tenant
      and i.status = 'completed' and i.deleted_at is null and i.branch_id is not null
      and i.source is distinct from 'fnb' and i.source is distinct from 'order'
      and (p_branch_id is null or i.branch_id = p_branch_id)
  ), requested_scopes as materialized (
    select distinct branch_id, source from candidates
  ), allowed_scopes as materialized (
    select s.branch_id, s.source from requested_scopes s
    where public.can_read_branch_document_00567(tenant, s.branch_id)
      and public._can_read_branch_inventory_00476(auth.uid(), tenant, s.branch_id)
      and public._staff_invoice_item_read(tenant, s.branch_id, s.source)
      -- POS and internal pass the header scope through the same item check.
      -- Other sources are normalized by the existing header policy.
      and (s.source in ('pos', 'internal')
        or (public._staff_invoice_header_exception_flags() & 1) = 0
        or public._staff_invoice_header_read(tenant, s.branch_id, 'other'))
  ), visible as materialized (
    select c.* from candidates c join allowed_scopes using (branch_id, source)
  ), page as (
    select v.id, v.quantity, v.unit_price, v.discount, v.total, v.code,
           v.ngay_chung_tu, v.customer_name, p.full_name
    from visible v
    left join public.profiles p on p.id = v.created_by and p.tenant_id = tenant
    order by v.ngay_chung_tu desc, v.id desc
    offset greatest(coalesce(p_offset, 0), 0)
    limit least(greatest(coalesce(p_limit, 20), 1), 200)
  )
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(to_jsonb(page) order by ngay_chung_tu desc, id desc) from page), '[]'::jsonb),
    'total', (select count(*) from visible)
  ) into result;
  return result;
end;
$$;

revoke all on function public.read_retail_sku_sales_history(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.read_retail_sku_sales_history(uuid, uuid, integer, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
