-- Separate viewing return documents from permissions that post stock and debt.
begin;
set local lock_timeout = '3s';
create or replace function public.get_internal_stock_returns(p_branch_id uuid,p_sale_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
  actor uuid := auth.uid();
  t uuid := public.get_user_tenant_id();
  result jsonb;
begin
  if actor is null or t is null
     or not coalesce(public.user_has_permission(actor,'inventory.view'),false)
     or not coalesce(public.user_has_branch_access(actor,p_branch_id),false)
     or not (
       coalesce(public.user_has_permission(actor,'inventory.internal_return_view'),false)
       or coalesce(public.user_has_permission(actor,'inventory.internal_return_send'),false)
       or coalesce(public.user_has_permission(actor,'inventory.internal_return_receive'),false)
     ) then
    raise exception 'RETURN_LIST_DENIED';
  end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]') into result from (
 select r.*,s.code sale_code,b.name from_branch_name,w.name to_branch_name,p.full_name created_by_name,
 (select greatest(coalesce(v.debt,0),0) from invoices v where v.id=s.invoice_id) invoice_debt,
 (select coalesce(jsonb_agg((to_jsonb(i)-'warehouse_unit_cost'-'branch_unit_cost'-'lots') order by i.product_name),'[]') from internal_stock_return_items i where i.return_id=r.id) items,
 (select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',ep.full_name) order by e.created_at),'[]')
  from internal_stock_return_events e left join profiles ep on ep.id=e.actor_id where e.return_id=r.id) events
 from internal_stock_returns r join internal_sales s on s.id=r.sale_id
 join branches b on b.id=r.from_branch_id join branches w on w.id=r.to_branch_id
 left join profiles p on p.id=r.created_by
 where r.tenant_id=t and p_branch_id in (r.from_branch_id,r.to_branch_id) and (p_sale_id is null or r.sale_id=p_sale_id)
 order by r.created_at desc,r.id limit 200) q;
 return result;
end $$;

revoke all on function public.get_internal_stock_returns(uuid,uuid) from public,anon;
grant execute on function public.get_internal_stock_returns(uuid,uuid) to authenticated;
commit;
