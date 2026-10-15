-- One valuation ledger for tracked F&B branches. Read-only; no stock/cost/document updates.
begin;
create function public._inventory_value_timeline_00540(p_from timestamptz,p_to timestamptz,p_branch uuid,p_tenant uuid)
returns table(product_id uuid,branch_id uuid,created_at timestamptz,direction text,reference_type text,quantity numeric,amount numeric)
language sql stable security definer set search_path='' as $$
 select e.product_id,e.branch_id,e.created_at,e.direction,e.source_reference_type,e.quantity,e.total_cost
 from public.fnb_branch_product_cost_events e
 where e.tenant_id=p_tenant and e.created_at>=p_from and e.created_at<p_to
 and (p_branch is null or e.branch_id=p_branch)
 and public._can_read_branch_inventory_00476(auth.uid(),e.tenant_id,e.branch_id)
 and public._fnb_branch_cost_tracking_enabled_00390(e.tenant_id,e.branch_id)

 union all
 select s.product_id,s.branch_id,s.created_at,s.type,lower(coalesce(s.reference_type,'')),s.quantity,
 case when e.id is not null and e.direction=s.type and abs(e.quantity-s.quantity)<0.0000001 then e.total_cost
 when e.id is not null then null
 when s.unit_cost>=0 then s.quantity*s.unit_cost
 when s.type='in' and s.unit_price>=0 then s.quantity*s.unit_price else null end
 from public.stock_movements s left join public.fnb_branch_product_cost_events e
 on e.tenant_id=s.tenant_id and e.source_stock_movement_id=s.id
 where s.tenant_id=p_tenant and s.created_at>=p_from and s.created_at<p_to and s.type in ('in','out')
 and (p_branch is null or s.branch_id=p_branch)
 and public._can_read_branch_inventory_00476(auth.uid(),s.tenant_id,s.branch_id)
 and not public._fnb_branch_cost_tracking_enabled_00390(s.tenant_id,s.branch_id)
$$;
revoke all on function public._inventory_value_timeline_00540(timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;

create or replace function public.get_xnt_report_v2(
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_branch_id uuid default null,
  p_search text default null
) returns table (
  product_id uuid,
  code text,
  name text,
  unit text,
  category_name text,
  opening_qty numeric,
  in_supplier numeric,
  in_check numeric,
  in_return numeric,
  in_transfer numeric,
  in_production numeric,
  in_other numeric,
  out_sale numeric,
  out_disposal numeric,
  out_supplier_return numeric,
  out_check numeric,
  out_transfer numeric,
  out_production numeric,
  out_internal numeric,
  out_other numeric,
  closing_qty numeric,
  opening_value numeric,
  in_value numeric,
  out_value numeric,
  closing_value numeric,
  valued_movement_count bigint,
  missing_cost_movement_count bigint,
  valuation_complete boolean
)

language plpgsql stable security definer set search_path='' as $$
declare tenant uuid;
begin
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 select p.tenant_id into tenant from public.profiles p where p.id=auth.uid() and p.is_active;
 if tenant is null then raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED';end if;
 return query
 with quantities as (select * from public.get_xnt_report(p_date_from,p_date_to,p_branch_id,p_search)),
 values_by_product as (
 select v.product_id,
 coalesce(sum(case when v.created_at<p_date_from then (case v.direction when 'in' then 1 else -1 end)*v.quantity else 0 end),0) oq,
 sum((case v.direction when 'in' then 1 else -1 end)*v.quantity) cq,
 coalesce(sum(case when v.created_at<p_date_from then (case v.direction when 'in' then 1 else -1 end)*v.amount else 0 end),0) ov,
 coalesce(sum(v.amount) filter(where v.created_at>=p_date_from and v.direction='in'),0) iv,
 coalesce(sum(v.amount) filter(where v.created_at>=p_date_from and v.direction='out'),0) xv,
 count(*) filter(where v.amount is not null) vc,
 count(*) filter(where v.amount is null) mc,
 count(*) filter(where v.amount is null and v.created_at>=p_date_from and v.direction='in') im,
 count(*) filter(where v.amount is null and v.created_at>=p_date_from and v.direction='out') om
 from public._inventory_value_timeline_00540('-infinity',p_date_to,p_branch_id,tenant) v group by v.product_id
 ), resolved as (
 select q.*,coalesce(v.oq,0) oq,coalesce(v.cq,0) cq,coalesce(v.ov,0) ov,coalesce(v.iv,0) iv,coalesce(v.xv,0) xv,
 coalesce(v.vc,0) vc,coalesce(v.mc,0) mc,coalesce(v.im,0) im,coalesce(v.om,0) om,
 coalesce(v.mc,0)=0 and abs(q.opening_qty-coalesce(v.oq,0))<=0.0001
 and abs(q.closing_qty-coalesce(v.cq,0))<=0.0001 and q.opening_qty>=0 and q.closing_qty>=0
 and coalesce(v.ov,0)>=-0.0001 and coalesce(v.ov,0)+coalesce(v.iv,0)-coalesce(v.xv,0)>=-0.0001
 and (abs(q.opening_qty)>0.0001 or abs(coalesce(v.ov,0))<=0.0001)
 and (abs(q.closing_qty)>0.0001 or abs(coalesce(v.ov,0)+coalesce(v.iv,0)-coalesce(v.xv,0))<=0.0001) complete
 from quantities q left join values_by_product v on v.product_id=q.product_id
 ) select r.product_id,r.code,r.name,r.unit,r.category_name,r.opening_qty,
 r.in_supplier,r.in_check,r.in_return,r.in_transfer,r.in_production,r.in_other,
 r.out_sale,r.out_disposal,r.out_supplier_return,r.out_check,r.out_transfer,r.out_production,r.out_internal,r.out_other,r.closing_qty,
 case when r.complete then r.ov else null end,
 case when r.im=0 then r.iv else null end,case when r.om=0 then r.xv else null end,
 case when r.complete then r.ov+r.iv-r.xv else null end,r.vc,r.mc,r.complete
 from resolved r order by r.name,r.code;
end $$;
revoke all on function public.get_xnt_report_v2(timestamptz,timestamptz,uuid,text) from public,anon;
grant execute on function public.get_xnt_report_v2(timestamptz,timestamptz,uuid,text) to authenticated;

create or replace function public.get_xnt_movement_values(p_date_from timestamptz,p_date_to timestamptz,p_branch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tenant uuid;
begin
 if p_date_from is null or p_date_to is null or p_date_to<=p_date_from then raise exception 'REPORT_DATE_RANGE_INVALID';end if;
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 select p.tenant_id into tenant from public.profiles p where p.id=auth.uid() and p.is_active;
 if tenant is null then raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED';end if;
 return (with classified as (
 select v.*,case when v.direction='in' then case
 when v.reference_type in ('purchase_entry','purchase_order','goods_receipt') then 'inSupplier'
 when v.reference_type in ('inventory_check','stock_adjustment','adjustment') then 'inCheck'
 when v.reference_type in ('sales_return','invoice_void','return_bom_restore') then 'inReturn'
 when v.reference_type in ('transfer','stock_transfer') then 'inTransfer'
 when v.reference_type in ('production_order','production_complete','production_reconcile','production_consume') then 'inProduction'
 else 'inOther' end else case
 when v.reference_type in ('invoice','sale','pos_sale','bom_consume','modifier_topping') then 'outSale'
 when v.reference_type in ('disposal','disposal_export') then 'outDisposal'
 when v.reference_type in ('supplier_return','purchase_return','purchase_order_revert') then 'outSupplierReturn'
 when v.reference_type in ('inventory_check','stock_adjustment','adjustment') then 'outCheck'
 when v.reference_type in ('transfer','stock_transfer') then 'outTransfer'
 when v.reference_type in ('production_order','production_complete','production_reconcile','production_consume') then 'outProduction'
 when v.reference_type in ('internal_export','internal_sale','input_invoice') then 'outInternal'
 else 'outOther' end end bucket
 from public._inventory_value_timeline_00540(p_date_from,p_date_to,p_branch_id,tenant) v
 join public.products p on p.id=v.product_id and p.tenant_id=tenant where p.inventory_role<>'fnb_menu_item'
 ), grouped as (select product_id,bucket,sum(case when reference_type in ('production_correction','opening') then 0 else quantity end) quantity,
 case when count(*) filter(where amount is null)>0 then null else sum(amount) end amount,
 count(*) filter(where amount is null) missing_cost_count from classified group by product_id,bucket)
 select coalesce(jsonb_agg(to_jsonb(g)),'[]') from grouped g);
end $$;
revoke all on function public.get_xnt_movement_values(timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.get_xnt_movement_values(timestamptz,timestamptz,uuid) to authenticated;

create function public.get_branch_stock_values_00540(p_product_ids uuid[],p_branch_ids uuid[] default null)
returns table(branch_id uuid,product_id uuid,quantity numeric,unit_cost numeric,stock_value numeric,valuation_complete boolean)
language sql stable security definer set search_path='' as $$
 with scoped as (select s.branch_id,s.product_id,sum(s.quantity) qty,p.cost_price,
 public._fnb_branch_cost_tracking_enabled_00390(s.tenant_id,s.branch_id) tracked,
 b.costed_quantity,b.deficit_quantity,b.total_cost,
 (select sum(case e.direction when 'in' then e.total_cost else -e.total_cost end)
 from public.fnb_branch_product_cost_events e where e.tenant_id=s.tenant_id and e.branch_id=s.branch_id and e.product_id=s.product_id) journal_value
 from public.branch_stock s join public.products p on p.id=s.product_id and p.tenant_id=s.tenant_id
 left join public.fnb_branch_product_cost_balances b on b.tenant_id=s.tenant_id and b.branch_id=s.branch_id and b.product_id=s.product_id
 where s.tenant_id=public.get_user_tenant_id() and s.product_id=any(p_product_ids)
 and (p_branch_ids is null or s.branch_id=any(p_branch_ids))
 and public.user_has_permission(auth.uid(),'products.view_cost')
 and public._can_read_branch_inventory_00476(auth.uid(),s.tenant_id,s.branch_id)
 group by s.tenant_id,s.branch_id,s.product_id,p.cost_price,b.costed_quantity,b.deficit_quantity,b.total_cost),
 valued as (select *,case when tracked then case
 when abs(qty-coalesce(costed_quantity,0)+coalesce(deficit_quantity,0))<=0.0001 and coalesce(deficit_quantity,0)=0
 and (qty=0 or costed_quantity is not null) then coalesce(journal_value,total_cost,0) else null end
 else qty*cost_price end value from scoped)
 select branch_id,product_id,qty,case when qty>0 then value/qty when value=0 then 0 else null end,value,value is not null from valued
$$;
revoke all on function public.get_branch_stock_values_00540(uuid[],uuid[]) from public,anon;
grant execute on function public.get_branch_stock_values_00540(uuid[],uuid[]) to authenticated;
commit;
notify pgrst,'reload schema';
