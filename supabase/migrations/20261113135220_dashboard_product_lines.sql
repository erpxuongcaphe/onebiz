begin;
-- Bounded, keyset-paged report input.  Authorization is evaluated once per
-- branch, not through the stock-bearing product view for every invoice row.
create function public.get_dashboard_product_lines(
  p_from timestamptz, p_to timestamptz, p_branch uuid default null, p_after uuid default null
) returns table(id uuid, invoice_id uuid, product_id uuid, product_name text, unit text,
  quantity numeric, total numeric, discount numeric, invoice_discount numeric,
  product_code text, category_name text, product_present boolean)
language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid(); tenant uuid;
begin
  perform public.assert_report_access('reports.analytics', p_branch);
  perform public.assert_report_access('reports.view_detail', p_branch);
  select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,true);
  if tenant is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_from >= p_to or p_to-p_from > interval '6 years' then
    raise exception 'REPORT_DATE_RANGE_INVALID' using errcode='22007';
  end if;
  return query
  with permitted as materialized (
    select b.id from public.branches b where b.tenant_id=tenant
      and (p_branch is null or b.id=p_branch)
      and public._can_read_branch_inventory_00476(actor,tenant,b.id)
  ), selected_invoices as materialized (
    select i.id, i.discount_amount from public.invoices i join permitted b on b.id=i.branch_id
    where i.tenant_id=tenant and i.deleted_at is null and i.status='completed'
      and i.ngay_chung_tu>=p_from and i.ngay_chung_tu<p_to
      and (p_branch is not null or coalesce(i.source,'') <> 'internal')
  )
  select ii.id,ii.invoice_id,ii.product_id,ii.product_name,ii.unit,ii.quantity,ii.total,ii.discount,
    coalesce(i.discount_amount,0),p.code,c.name,(p.id is not null)
  from selected_invoices i join public.invoice_items ii on ii.invoice_id=i.id
    left join public.products p on p.id=ii.product_id and p.tenant_id=tenant
    left join public.categories c on c.id=p.category_id and c.tenant_id=tenant
  where p_after is null or ii.id>p_after
  order by ii.id limit 1000;
end $$;
revoke all on function public.get_dashboard_product_lines(timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.get_dashboard_product_lines(timestamptz,timestamptz,uuid,uuid) to authenticated;
commit;
