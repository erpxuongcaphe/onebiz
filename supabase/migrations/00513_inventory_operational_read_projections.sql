-- Read projections preserve operational quantities without exposing cost snapshots.
-- No balances, recipes, invoices or historic quantities are rewritten.
begin;
-- Branch administration does not imply access to every branch's reports.
create or replace function public.assert_report_access(p_permission_code text,p_branch_id uuid default null)
returns void language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid;
begin
 if v_actor is null then raise exception using errcode='42501',message='REPORT_AUTH_REQUIRED';end if;
 select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
 if v_tenant is null then raise exception using errcode='42501',message='REPORT_PROFILE_INACTIVE';end if;
 if not public.user_has_permission(v_actor,p_permission_code) then
 raise exception using errcode='42501',message='REPORT_PERMISSION_DENIED';end if;
 if p_branch_id is null then
 if not public.user_has_permission(v_actor,'reports.view_all_branches') then
 raise exception using errcode='42501',message='REPORT_ALL_BRANCHES_DENIED';end if;
 elsif not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=v_tenant
 and public._can_read_branch_inventory_00476(v_actor,v_tenant,b.id)) then
 raise exception using errcode='42501',message='REPORT_BRANCH_DENIED';end if;
end;$$;
create policy product_lots_scope_00477 on public.product_lots as restrictive for select to authenticated
using(public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
create policy production_orders_scope_00477 on public.production_orders as restrictive for select to authenticated
using(public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
create policy inventory_checks_scope_00477 on public.inventory_checks as restrictive for select to authenticated
using(public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
create policy production_materials_scope_00477 on public.production_order_materials as restrictive for select to authenticated
using(exists(select 1 from public.production_orders o where o.id=production_order_materials.production_order_id));
create policy inventory_check_items_scope_00477 on public.inventory_check_items as restrictive for select to authenticated
using(exists(select 1 from public.inventory_checks o where o.id=inventory_check_items.check_id));
create policy bom_scope_00477 on public.bom as restrictive for select to authenticated
using(branch_id is null or public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
do $views$
declare spec record; cols text; safe_cols text; scope text;
begin
 for spec in select * from (values
 ('product_variants','cost_price','tenant'),
 ('bom','cached_cost','recipe'),
 ('production_orders','cogs_amount','branch'),
 ('production_order_materials','unit_cost','production'),
 ('stock_movements','unit_cost,unit_price','branch'),
 ('invoice_items','unit_cost','invoice'),
 ('inventory_check_items','unit_cost','check')
 ) s(table_name,hidden,kind) loop
 select string_agg(case when a.attname=any(string_to_array(spec.hidden,','))
 then format('case when public.user_has_permission(auth.uid(),''products.view_cost'') then t.%I else 0 end as %I',a.attname,a.attname)
 else format('t.%I',a.attname) end,',' order by a.attnum),
 string_agg(format('%I',a.attname),',' order by a.attnum) filter(where not a.attname=any(string_to_array(spec.hidden,',')))
 into cols,safe_cols from pg_attribute a where a.attrelid=('public.'||spec.table_name)::regclass and a.attnum>0 and not a.attisdropped;
 scope:=case spec.kind
 when 'tenant' then 't.tenant_id=public.get_user_tenant_id()'
 when 'recipe' then 't.tenant_id=public.get_user_tenant_id() and (t.branch_id is null or public._can_read_branch_inventory_00476(auth.uid(),t.tenant_id,t.branch_id))'
 when 'branch' then 'public._can_read_branch_inventory_00476(auth.uid(),t.tenant_id,t.branch_id)'
 when 'production' then 'exists(select 1 from public.production_orders o where o.id=t.production_order_id and public._can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id))'
 when 'check' then 'exists(select 1 from public.inventory_checks o where o.id=t.check_id and public._can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id))'
 when 'invoice' then 'exists(select 1 from public.invoices o where o.id=t.invoice_id and public._can_read_branch_inventory_00476(auth.uid(),o.tenant_id,o.branch_id))' end;
 execute format('create view public.%I with(security_barrier=true) as select %s from public.%I t where %s and exists(select 1 from public.profiles p where p.id=auth.uid() and coalesce(p.is_active,true))',spec.table_name||'_scoped',cols,spec.table_name,scope);
 execute format('revoke all on public.%I from public,anon',spec.table_name||'_scoped');
 execute format('grant select on public.%I to authenticated',spec.table_name||'_scoped');
 execute format('revoke select on public.%I from authenticated',spec.table_name);
 execute format('grant select (%s) on public.%I to authenticated',safe_cols,spec.table_name);
 end loop;
end; $views$;
-- Internal server writers still execute these helpers as their owner.
revoke execute on function public.apply_weighted_avg_cost(uuid,numeric,numeric,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.recalculate_bom_cost_cache(uuid) from public,anon,authenticated;
revoke execute on function public.seed_demo_products(uuid) from public,anon,authenticated;

create function public._guard_direct_cost_write_00477() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user='authenticated' and not public.user_has_permission(auth.uid(),'products.view_cost')
 and ((tg_op='INSERT' and coalesce(new.cost_price,0)<>0)
 or (tg_op='UPDATE' and new.cost_price is distinct from old.cost_price)) then
 raise exception 'COST_WRITE_PERMISSION_DENIED' using errcode='42501'; end if;
 return new;
end; $$;
create trigger guard_product_cost_write_00477 before insert or update of cost_price on public.products
for each row execute function public._guard_direct_cost_write_00477();
create trigger guard_variant_cost_write_00477 before insert or update of cost_price on public.product_variants
for each row execute function public._guard_direct_cost_write_00477();
CREATE OR REPLACE FUNCTION public.save_fnb_size_setup_atomic(p_product_id uuid, p_variants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
 v_actor uuid := auth.uid();
 v_tenant uuid;
 v_default_variant jsonb;
 v_result jsonb;
begin
 -- Hidden costs must never be replaced by redacted zeros from a client.
 if not public.user_has_permission(v_actor,'products.view_cost') and jsonb_typeof(p_variants)='array' then
 select coalesce(jsonb_agg(v.value || jsonb_build_object('costPrice',coalesce(pv.cost_price,0))),'[]'::jsonb)
 into p_variants from jsonb_array_elements(p_variants) v(value)
 left join public.product_variants pv on pv.id=nullif(v.value->>'id','')::uuid
 and pv.product_id=p_product_id and pv.tenant_id=public.get_user_tenant_id();
 end if;
 if v_actor is null then
 raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
 end if;

 select profile.tenant_id
 into v_tenant
 from public.profiles profile
 where profile.id = v_actor
 and profile.is_active;
 if v_tenant is null then
 raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
 end if;
 if not public.user_has_permission(v_actor, 'products.edit') then
 raise exception using
 errcode = '42501',
 message = 'FNB_SIZE_SETUP_PERMISSION_DENIED';
 end if;

 if p_variants is null
 or jsonb_typeof(p_variants) <> 'array'
 or jsonb_array_length(p_variants) = 0 then
 raise exception using
 errcode = '22023',
 message = 'FNB_SIZE_SETUP_VARIANTS_INVALID';
 end if;

 select variant.value
 into v_default_variant
 from jsonb_array_elements(p_variants) variant(value)
 where coalesce((variant.value->>'isDefault')::boolean, false)
 limit 1;

 if v_default_variant is null then
 raise exception using
 errcode = '22023',
 message = 'FNB_SIZE_SETUP_DEFAULT_REQUIRED';
 end if;

 -- 00368 -> 00367 -> 00357 performs every guarded variant/BOM write.
 v_result := public.save_fnb_size_setup_atomic_00368(
 p_product_id,
 p_variants
 );

 -- This must remain the final product write in the transaction. The default
 -- size is the canonical representative shown outside the size matrix.
 update public.products product
 set sell_price = (v_default_variant->>'sellPrice')::numeric,
 cost_price = coalesce((v_default_variant->>'costPrice')::numeric, 0),
 has_bom = true,
 updated_at = now()
 where product.id = p_product_id
 and product.tenant_id = v_tenant
 and product.product_type = 'sku'
 and product.channel = 'fnb';

 if not found then
 raise exception using
 errcode = 'P0001',
 message = 'FNB_SIZE_SETUP_PRODUCT_NOT_FNB_SKU';
 end if;

 return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_profit_and_loss_report(p_current_from timestamp with time zone, p_current_to timestamp with time zone, p_previous_from timestamp with time zone, p_previous_to timestamp with time zone, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare -- ISSUED_AT_00335
 v_tenant_id uuid;
begin
 if not public.user_has_permission(auth.uid(),'products.view_cost') then
 raise exception 'COST_VIEW_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_current_from is null or p_current_to is null
 or p_previous_from is null or p_previous_to is null
 or p_current_from >= p_current_to or p_previous_from >= p_previous_to then
 raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
 end if;

 perform public.assert_report_access('reports.analytics', p_branch_id);
 perform public.assert_report_access('reports.view_detail', p_branch_id);

 select p.tenant_id into v_tenant_id
 from public.profiles p
 where p.id = auth.uid() and coalesce(p.is_active, true);

 return (
 with periods as (
 select * from (values
 ('current'::text, p_current_from, p_current_to),
 ('previous'::text, p_previous_from, p_previous_to)
 ) p(period, date_from, date_to)
 ),
 scoped_invoices as (
 select p.period, i.id, i.total, coalesce(i.delivery_fee, 0) as delivery_fee
 from periods p
 join public.invoices i
 on i.issued_at >= p.date_from and i.issued_at < p.date_to
 where i.tenant_id = v_tenant_id
 and i.status = 'completed'
 and (p_branch_id is null or i.branch_id = p_branch_id)
 ),
 invoice_totals as (
 select
 period,
 coalesce(sum(total), 0) as revenue,
 coalesce(sum(delivery_fee), 0) as delivery_fee
 from scoped_invoices
 group by period
 ),
 cost_totals as (
 select
 si.period,
 coalesce(sum(ii.quantity * coalesce(ii.unit_cost, pr.cost_price, 0)), 0) as cogs,
 count(*) filter (where ii.unit_cost is null) as estimated_legacy_lines,
 count(*) filter (where ii.unit_cost is not null) as snapshot_lines
 from scoped_invoices si
 join public.invoice_items ii on ii.invoice_id = si.id
 left join public.products pr on pr.id = ii.product_id
 group by si.period
 ),
 return_revenue_totals as (
 select
 p.period,
 coalesce(sum(sr.total), 0) as returned
 from periods p
 join public.sales_returns sr
 on sr.created_at >= p.date_from and sr.created_at < p.date_to
 where sr.tenant_id = v_tenant_id
 and sr.status in ('confirmed', 'completed')
 and (p_branch_id is null or sr.branch_id = p_branch_id)
 group by p.period
 ),
 return_cost_lines as (
 select
 p.period,
 ri.quantity,
 source_cost.unit_cost,
 coalesce(source_cost.unit_cost, pr.cost_price, 0) as effective_unit_cost
 from periods p
 join public.sales_returns sr
 on sr.created_at >= p.date_from and sr.created_at < p.date_to
 join public.return_items ri on ri.return_id = sr.id
 left join lateral (
 select ii.unit_cost
 from public.invoice_items ii
 where ii.invoice_id = sr.invoice_id
 and ii.product_id = ri.product_id
 order by ii.id
 limit 1
 ) source_cost on true
 left join public.products pr on pr.id = ri.product_id
 where sr.tenant_id = v_tenant_id
 and sr.status in ('confirmed', 'completed')
 and (p_branch_id is null or sr.branch_id = p_branch_id)
 ),
 return_cost_totals as (
 select
 period,
 coalesce(sum(quantity * effective_unit_cost), 0) as return_cogs,
 count(*) filter (where unit_cost is null) as estimated_legacy_lines,
 count(*) filter (where unit_cost is not null) as snapshot_lines
 from return_cost_lines
 group by period
 ),
 expense_totals as (
 select
 p.period,
 coalesce(sum(ct.amount), 0) as operating_expense
 from periods p
 join public.cash_transactions ct
 on ct.created_at >= p.date_from and ct.created_at < p.date_to
 where ct.tenant_id = v_tenant_id
 and ct.type = 'payment'
 and coalesce(ct.status, 'completed') = 'completed'
 and coalesce(ct.category, '') <> all(array[
 'Nhập hàng',
 'Mua hàng nội bộ',
 'Hoàn tiền hủy đơn',
 'Hoàn trả',
 'Trả hàng', 'Tra hang',
 'Trả nhà cung cấp',
 'supplier_payment'
 ])
 and (p_branch_id is null or ct.branch_id = p_branch_id)
 group by p.period
 ),
 summary as (
 select
 p.period,
 coalesce(i.revenue, 0) - coalesce(rr.returned, 0) as revenue,
 coalesce(i.delivery_fee, 0) as delivery_fee,
 coalesce(c.cogs, 0) - coalesce(rc.return_cogs, 0) as cogs,
 coalesce(e.operating_expense, 0) as operating_expense,
 coalesce(c.estimated_legacy_lines, 0) +
 coalesce(rc.estimated_legacy_lines, 0) as estimated_legacy_lines,
 coalesce(c.snapshot_lines, 0) +
 coalesce(rc.snapshot_lines, 0) as snapshot_lines
 from periods p
 left join invoice_totals i using (period)
 left join cost_totals c using (period)
 left join return_revenue_totals rr using (period)
 left join return_cost_totals rc using (period)
 left join expense_totals e using (period)
 )
 select jsonb_build_object(
 'current', (select to_jsonb(s) - 'period' from summary s where period = 'current'),
 'previous', (select to_jsonb(s) - 'period' from summary s where period = 'previous')
 )
 );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_financial_analysis_details_report(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_branch_id uuid DEFAULT NULL::uuid, p_exclude_internal boolean DEFAULT false, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare -- ISSUED_AT_REPORT_00394
 v_tenant_id uuid;
 v_exclude_internal boolean := coalesce(p_exclude_internal, false) and p_branch_id is null;
 v_granularity text;
 v_step interval;
 v_days numeric;
 v_pnl jsonb;
 v_current jsonb;
 v_goods_revenue numeric;
 v_cogs numeric;
 v_opening_value numeric := 0;
 v_closing_value numeric := 0;
 v_average_inventory numeric := 0;
 v_turnover numeric := 0;
 v_receivables numeric := 0;
 v_average_daily_revenue numeric := 0;
begin
 if not public.user_has_permission(auth.uid(),'products.view_cost') then
 raise exception 'COST_VIEW_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
 raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
 end if;

 if p_limit is null or p_limit < 1 or p_limit > 50000 then
 raise exception using errcode = '22023', message = 'REPORT_LIMIT_INVALID';
 end if;

 perform public.assert_report_access('reports.analytics', p_branch_id);
 perform public.assert_report_access('reports.view_detail', p_branch_id);

 select p.tenant_id
 into v_tenant_id
 from public.profiles p
 where p.id = auth.uid()
 and coalesce(p.is_active, true);

 if v_tenant_id is null then
 raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
 end if;

 if p_date_to - p_date_from <= interval '45 days' then
 v_granularity := 'day';
 v_step := interval '1 day';
 elsif p_date_to - p_date_from <= interval '550 days' then
 v_granularity := 'month';
 v_step := interval '1 month';
 else
 v_granularity := 'year';
 v_step := interval '1 year';
 end if;

 v_days := greatest(
 1,
 ceil(extract(epoch from (p_date_to - p_date_from)) / 86400)
 );

 if v_exclude_internal then
 v_pnl := public.get_consolidated_profit_and_loss_report(
 p_date_from, p_date_to, p_date_from, p_date_to
 );
 else
 v_pnl := public.get_profit_and_loss_report(
 p_date_from, p_date_to, p_date_from, p_date_to, p_branch_id
 );
 end if;

 v_current := v_pnl->'current';
 v_goods_revenue :=
 coalesce((v_current->>'revenue')::numeric, 0)
 - coalesce((v_current->>'delivery_fee')::numeric, 0);
 v_cogs := coalesce((v_current->>'cogs')::numeric, 0);

 select
 coalesce(sum(x.opening_qty * x.cost_price), 0),
 coalesce(sum(x.closing_qty * x.cost_price), 0)
 into v_opening_value, v_closing_value
 from public.get_xnt_report(p_date_from, p_date_to, p_branch_id, null) x;

 v_average_inventory := (v_opening_value + v_closing_value) / 2;
 v_turnover := case
 when v_average_inventory > 0 then round(v_cogs / v_average_inventory, 2)
 else 0
 end;

 select coalesce(sum(greatest(i.debt, 0)), 0)
 into v_receivables
 from public.invoices i
 where i.tenant_id = v_tenant_id
 and i.status = 'completed'
 and coalesce(i.debt, 0) > 0
 and (p_branch_id is null or i.branch_id = p_branch_id)
 and (not v_exclude_internal or coalesce(i.source, '') <> 'internal');

 v_average_daily_revenue := v_goods_revenue / v_days;

 return (
 with scoped_invoices as (
 select
 i.id,
 i.issued_at as created_at,
 i.total,
 coalesce(i.delivery_fee, 0) as delivery_fee
 from public.invoices i
 where i.tenant_id = v_tenant_id
 and i.status = 'completed'
 and i.issued_at >= p_date_from
 and i.issued_at < p_date_to
 and (p_branch_id is null or i.branch_id = p_branch_id)
 and (not v_exclude_internal or coalesce(i.source, '') <> 'internal')
 ),
 invoice_lines as (
 select
 si.created_at,
 coalesce(ii.product_id::text, 'name:' || md5(coalesce(ii.product_name, ''))) as product_key,
 coalesce(nullif(trim(ii.product_name), ''), pr.name, 'Sản phẩm') as product_name,
 coalesce(ii.quantity, 0)::numeric as quantity,
 coalesce(ii.unit_cost, pr.cost_price, 0)::numeric as unit_cost
 from scoped_invoices si
 join public.invoice_items ii on ii.invoice_id = si.id
 left join public.products pr on pr.id = ii.product_id
 ),
 scoped_returns as (
 select sr.id, sr.invoice_id, sr.created_at, sr.total
 from public.sales_returns sr
 join public.invoices source_invoice
 on source_invoice.id = sr.invoice_id
 and source_invoice.tenant_id = v_tenant_id
 where sr.tenant_id = v_tenant_id
 and sr.status in ('confirmed', 'completed')
 and sr.created_at >= p_date_from
 and sr.created_at < p_date_to
 and (p_branch_id is null or sr.branch_id = p_branch_id)
 and (not v_exclude_internal or coalesce(source_invoice.source, '') <> 'internal')
 ),
 return_lines as (
 select
 sr.created_at,
 coalesce(ri.product_id::text, 'name:' || md5(coalesce(pr.name, ''))) as product_key,
 coalesce(pr.name, 'Sản phẩm') as product_name,
 coalesce(ri.quantity, 0)::numeric as quantity,
 coalesce(source_cost.unit_cost, pr.cost_price, 0)::numeric as unit_cost
 from scoped_returns sr
 join public.return_items ri on ri.return_id = sr.id
 left join lateral (
 select ii.unit_cost
 from public.invoice_items ii
 where ii.invoice_id = sr.invoice_id
 and ii.product_id = ri.product_id
 order by ii.id
 limit 1
 ) source_cost on true
 left join public.products pr on pr.id = ri.product_id
 ),
 product_events as (
 select product_key, product_name, quantity, quantity * unit_cost as cost
 from invoice_lines
 union all
 select product_key, product_name, -quantity, -(quantity * unit_cost)
 from return_lines
 ),
 product_totals as (
 select
 product_key,
 max(product_name) as product_name,
 sum(quantity)::numeric as quantity,
 sum(cost)::numeric as total_cost
 from product_events
 group by product_key
 ),
 product_ranked as (
 select
 pt.*,
 sum(pt.total_cost) over () as all_product_cost
 from product_totals pt
 where pt.quantity <> 0 or pt.total_cost <> 0
 ),
 cogs_breakdown as (
 select *
 from product_ranked
 order by total_cost desc, product_name
 limit p_limit
 ),
 buckets as (
 select generate_series(
 date_trunc(v_granularity, p_date_from),
 p_date_to - interval '1 microsecond',
 v_step
 ) as bucket_start
 ),
 revenue_events as (
 select
 date_trunc(v_granularity, si.created_at) as bucket_start,
 (si.total - si.delivery_fee)::numeric as revenue
 from scoped_invoices si
 union all
 select
 date_trunc(v_granularity, sr.created_at) as bucket_start,
 -sr.total::numeric as revenue
 from scoped_returns sr
 ),
 cost_events as (
 select
 date_trunc(v_granularity, il.created_at) as bucket_start,
 (il.quantity * il.unit_cost)::numeric as cogs
 from invoice_lines il
 union all
 select
 date_trunc(v_granularity, rl.created_at) as bucket_start,
 -(rl.quantity * rl.unit_cost)::numeric as cogs
 from return_lines rl
 ),
 revenue_by_bucket as (
 select bucket_start, sum(revenue)::numeric as revenue
 from revenue_events
 group by bucket_start
 ),
 cost_by_bucket as (
 select bucket_start, sum(cogs)::numeric as cogs
 from cost_events
 group by bucket_start
 ),
 trend as (
 select
 b.bucket_start,
 coalesce(r.revenue, 0)::numeric as revenue,
 coalesce(c.cogs, 0)::numeric as cogs
 from buckets b
 left join revenue_by_bucket r using (bucket_start)
 left join cost_by_bucket c using (bucket_start)
 order by b.bucket_start
 )
 select jsonb_build_object(
 'granularity', v_granularity,
 'exclude_internal', v_exclude_internal,
 'cogs_total_count', (select count(*) from product_ranked),
 'reconciliation', jsonb_build_object(
 'invoice_count', (select count(*) from scoped_invoices),
 'invoice_total', coalesce((select sum(si.total) from scoped_invoices si), 0),
 'delivery_fee', coalesce((select sum(si.delivery_fee) from scoped_invoices si), 0),
 'return_count', (select count(*) from scoped_returns),
 'returned_total', coalesce((select sum(sr.total) from scoped_returns sr), 0),
 'sales_cogs', coalesce((select sum(il.quantity * il.unit_cost) from invoice_lines il), 0),
 'returned_cogs', coalesce((select sum(rl.quantity * rl.unit_cost) from return_lines rl), 0)
 ),
 'cogs_breakdown', coalesce((
 select jsonb_agg(jsonb_build_object(
 'product_name', cb.product_name,
 'quantity', cb.quantity,
 'average_unit_cost', case
 when cb.quantity <> 0 then cb.total_cost / cb.quantity
 else 0
 end,
 'total_cost', cb.total_cost,
 'pct_of_cogs', case
 when cb.all_product_cost <> 0
 then round(cb.total_cost / cb.all_product_cost * 100, 1)
 else 0
 end
 ) order by cb.total_cost desc, cb.product_name)
 from cogs_breakdown cb
 ), '[]'::jsonb),
 'margin_trend', coalesce((
 select jsonb_agg(jsonb_build_object(
 'bucket_start', t.bucket_start,
 'revenue', t.revenue,
 'cogs', t.cogs,
 'gross_margin', case
 when t.revenue <> 0
 then round((t.revenue - t.cogs) / t.revenue * 100, 1)
 else 0
 end
 ) order by t.bucket_start)
 from trend t
 ), '[]'::jsonb),
 'turnover', jsonb_build_object(
 'turnover_ratio', v_turnover,
 'average_days_to_sell', case
 when v_turnover > 0 then round(v_days / v_turnover)
 else 0
 end,
 'cogs_period', v_cogs,
 'opening_inventory_value', v_opening_value,
 'closing_inventory_value', v_closing_value,
 'average_inventory_value', v_average_inventory,
 'period_days', v_days
 ),
 'dso', jsonb_build_object(
 'days', case
 when v_average_daily_revenue > 0
 then round(v_receivables / v_average_daily_revenue)
 else 0
 end,
 'receivables', v_receivables,
 'average_daily_revenue', v_average_daily_revenue,
 'receivables_as_of', now(),
 'period_days', v_days
 )
 )
 );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.verify_stock_invariants(p_tenant_id uuid DEFAULT NULL::uuid, p_tolerance numeric DEFAULT 0.01)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
 v_tenant_id uuid;
 v_inv1 jsonb := '[]'::jsonb;
 v_inv2 jsonb := '[]'::jsonb;
 v_inv3 jsonb := '[]'::jsonb;
 v_inv1_count int := 0;
 v_inv2_count int := 0;
 v_inv3_count int := 0;
 r record;
begin
 if auth.uid() is not null and not public.user_has_permission(auth.uid(),'reports.view_all_branches') then
 raise exception 'INVENTORY_GLOBAL_SCOPE_DENIED' using errcode='42501'; end if;
 if p_tenant_id is null then
 select tenant_id into v_tenant_id
 from public.profiles where id = auth.uid();
 if v_tenant_id is null then
 raise exception 'TENANT_REQUIRED';
 end if;
 else
 v_tenant_id := p_tenant_id;
 if v_tenant_id <> (select tenant_id from public.profiles where id = auth.uid())
 and (select role from public.profiles where id = auth.uid()) <> 'owner' then
 raise exception 'PERMISSION_DENIED';
 end if;
 end if;

 for r in
 select p.id, p.code, p.name, p.stock as product_stock,
 coalesce(bs.branch_total, 0) as branch_sum,
 p.stock - coalesce(bs.branch_total, 0) as drift
 from public.products p
 left join (
 select product_id, sum(quantity) as branch_total
 from public.branch_stock
 where tenant_id = v_tenant_id
 group by product_id
 ) bs on bs.product_id = p.id
 where p.tenant_id = v_tenant_id
 and abs(coalesce(p.stock, 0) - coalesce(bs.branch_total, 0)) > p_tolerance
 order by abs(p.stock - coalesce(bs.branch_total, 0)) desc
 limit 100
 loop
 v_inv1 := v_inv1 || jsonb_build_object(
 'product_id', r.id,
 'code', r.code,
 'name', r.name,
 'product_stock', r.product_stock,
 'branch_stock_sum', r.branch_sum,
 'drift', r.drift
 );
 v_inv1_count := v_inv1_count + 1;
 end loop;

 for r in
 select bs.branch_id, bs.product_id, bs.quantity as branch_qty,
 coalesce(sm.movement_net, 0) as movement_sum,
 p.code, p.name, b.name as branch_name,
 bs.quantity - coalesce(sm.movement_net, 0) as drift
 from public.branch_stock bs
 join public.products p on p.id = bs.product_id
 join public.branches b on b.id = bs.branch_id
 left join (
 select branch_id, product_id,
 sum(case when type = 'in' then quantity else -quantity end)
 as movement_net
 from public.stock_movements
 where tenant_id = v_tenant_id
 group by branch_id, product_id
 ) sm on sm.branch_id = bs.branch_id and sm.product_id = bs.product_id
 where bs.tenant_id = v_tenant_id
 and bs.variant_id is null
 and abs(coalesce(bs.quantity, 0) - coalesce(sm.movement_net, 0)) > p_tolerance
 order by abs(bs.quantity - coalesce(sm.movement_net, 0)) desc
 limit 100
 loop
 v_inv2 := v_inv2 || jsonb_build_object(
 'branch_id', r.branch_id,
 'branch_name', r.branch_name,
 'product_id', r.product_id,
 'product_code', r.code,
 'product_name', r.name,
 'branch_stock_qty', r.branch_qty,
 'stock_movements_net', r.movement_sum,
 'drift', r.drift
 );
 v_inv2_count := v_inv2_count + 1;
 end loop;

 -- Expired lots are still physically in stock until disposal. A pair remains
 -- tracked even when every lot has become consumed, so a missing replacement
 -- lot cannot silently disappear from this check.
 for r in
 with tracked_pairs as (
 select distinct tenant_id, branch_id, product_id
 from public.product_lots
 where tenant_id = v_tenant_id
 ), lot_totals as (
 select tenant_id, branch_id, product_id, sum(current_qty) as lot_total
 from public.product_lots
 where tenant_id = v_tenant_id
 and status in ('active', 'expired')
 group by tenant_id, branch_id, product_id
 )
 select bs.branch_id, bs.product_id, bs.quantity as branch_qty,
 coalesce(lt.lot_total, 0) as lot_sum,
 p.code, p.name, b.name as branch_name,
 bs.quantity - coalesce(lt.lot_total, 0) as drift
 from public.branch_stock bs
 join tracked_pairs tp
 on tp.tenant_id = bs.tenant_id
 and tp.branch_id = bs.branch_id
 and tp.product_id = bs.product_id
 join public.products p on p.id = bs.product_id
 join public.branches b on b.id = bs.branch_id
 left join lot_totals lt
 on lt.tenant_id = bs.tenant_id
 and lt.branch_id = bs.branch_id
 and lt.product_id = bs.product_id
 where bs.tenant_id = v_tenant_id
 and bs.variant_id is null
 and bs.quantity >= 0
 and abs(bs.quantity - coalesce(lt.lot_total, 0)) > p_tolerance
 order by abs(bs.quantity - coalesce(lt.lot_total, 0)) desc
 limit 100
 loop
 v_inv3 := v_inv3 || jsonb_build_object(
 'branch_id', r.branch_id,
 'branch_name', r.branch_name,
 'product_id', r.product_id,
 'product_code', r.code,
 'product_name', r.name,
 'branch_stock_qty', r.branch_qty,
 'product_lots_sum', r.lot_sum,
 'drift', r.drift
 );
 v_inv3_count := v_inv3_count + 1;
 end loop;

 return jsonb_build_object(
 'verified_at', now(),
 'tenant_id', v_tenant_id,
 'tolerance', p_tolerance,
 'all_ok', (v_inv1_count + v_inv2_count + v_inv3_count) = 0,
 'invariant_1', jsonb_build_object(
 'description', 'products.stock = SUM(branch_stock.quantity)',
 'violations_count', v_inv1_count,
 'violations', v_inv1
 ),
 'invariant_2', jsonb_build_object(
 'description', 'branch_stock.quantity = SUM(stock_movements: in - out)',
 'violations_count', v_inv2_count,
 'violations', v_inv2
 ),
 'invariant_3', jsonb_build_object(
 'description', 'SUM(product_lots.current_qty active + expired) = branch_stock.quantity',
 'violations_count', v_inv3_count,
 'violations', v_inv3
 )
 );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.calculate_bom_cost(p_bom_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
 v_total numeric := 0;
 v_items jsonb := '[]'::jsonb;
 r record;
begin
 if not exists(select 1 from public.bom b join public.profiles p on p.tenant_id=b.tenant_id
 where b.id=p_bom_id and p.id=auth.uid() and coalesce(p.is_active,true)
 and (b.branch_id is null or public._can_read_branch_inventory_00476(auth.uid(),b.tenant_id,b.branch_id))) then
 raise exception 'BOM_ACCESS_DENIED' using errcode='42501'; end if;
 for r in
 select
 bi.material_id,
 p.name as material_name,
 p.code as material_code,
 bi.quantity,
 bi.unit,
 bi.waste_percent,
 case when public.user_has_permission(auth.uid(),'products.view_cost') then p.cost_price else 0 end as cost_price,
 round(bi.quantity * (1 + bi.waste_percent / 100) * case when public.user_has_permission(auth.uid(),'products.view_cost') then p.cost_price else 0 end, 2) as line_cost
 from public.bom_items bi
 join public.products p on p.id = bi.material_id
 where bi.bom_id = p_bom_id
 order by bi.sort_order
 loop
 v_total := v_total + r.line_cost;
 v_items := v_items || jsonb_build_object(
 'material_id', r.material_id,
 'material_name', r.material_name,
 'material_code', r.material_code,
 'quantity', r.quantity,
 'unit', r.unit,
 'waste_percent', r.waste_percent,
 'cost_price', r.cost_price,
 'line_cost', r.line_cost
 );
 end loop;

 return jsonb_build_object(
 'bom_id', p_bom_id,
 'total_cost', v_total,
 'items', v_items
 );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_consolidated_profit_and_loss_report(p_current_from timestamp with time zone, p_current_to timestamp with time zone, p_previous_from timestamp with time zone, p_previous_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare -- ISSUED_AT_REPORT_00394
 v_tenant_id uuid;
 v_base jsonb;
begin
 if not public.user_has_permission(auth.uid(),'products.view_cost') then
 raise exception 'COST_VIEW_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_current_from is null or p_current_to is null
 or p_previous_from is null or p_previous_to is null
 or p_current_from >= p_current_to
 or p_previous_from >= p_previous_to then
 raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
 end if;

 perform public.assert_report_access('reports.analytics', null);
 perform public.assert_report_access('reports.view_detail', null);

 select p.tenant_id into v_tenant_id
 from public.profiles p
 where p.id = auth.uid() and coalesce(p.is_active, true);

 if v_tenant_id is null then
 raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
 end if;

 v_base := public.get_profit_and_loss_report(
 p_current_from, p_current_to, p_previous_from, p_previous_to, null
 );

 return (
 with periods as (
 select * from (values
 ('current'::text, p_current_from, p_current_to),
 ('previous'::text, p_previous_from, p_previous_to)
 ) p(period, date_from, date_to)
 ),
 internal_invoices as (
 select p.period, i.id, i.total, coalesce(i.delivery_fee, 0) as delivery_fee
 from periods p
 join public.invoices i
 on i.issued_at >= p.date_from and i.issued_at < p.date_to
 where i.tenant_id = v_tenant_id
 and i.status = 'completed'
 and i.source = 'internal'
 ),
 internal_invoice_totals as (
 select period, coalesce(sum(total), 0) as revenue,
 coalesce(sum(delivery_fee), 0) as delivery_fee
 from internal_invoices
 group by period
 ),
 internal_cost_totals as (
 select scope.period,
 coalesce(sum(line.quantity * coalesce(line.unit_cost, product.cost_price, 0)), 0) as cogs,
 count(*) filter (where line.unit_cost is null) as estimated_legacy_lines,
 count(*) filter (where line.unit_cost is not null) as snapshot_lines
 from internal_invoices scope
 join public.invoice_items line on line.invoice_id = scope.id
 left join public.products product on product.id = line.product_id
 group by scope.period
 ),
 internal_returns as (
 select p.period, sr.id, sr.invoice_id, sr.total
 from periods p
 join public.sales_returns sr
 on sr.created_at >= p.date_from and sr.created_at < p.date_to
 join public.invoices source_invoice
 on source_invoice.id = sr.invoice_id
 and source_invoice.tenant_id = v_tenant_id
 and source_invoice.source = 'internal'
 where sr.tenant_id = v_tenant_id
 and sr.status in ('confirmed', 'completed')
 ),
 internal_return_totals as (
 select period, coalesce(sum(total), 0) as revenue
 from internal_returns
 group by period
 ),
 internal_return_cost_lines as (
 select ir.period, return_line.quantity, source_cost.unit_cost,
 coalesce(source_cost.unit_cost, product.cost_price, 0) as effective_unit_cost
 from internal_returns ir
 join public.return_items return_line on return_line.return_id = ir.id
 left join lateral (
 select source_line.unit_cost
 from public.invoice_items source_line
 where source_line.invoice_id = ir.invoice_id
 and source_line.product_id = return_line.product_id
 order by source_line.id
 limit 1
 ) source_cost on true
 left join public.products product on product.id = return_line.product_id
 ),
 internal_return_cost_totals as (
 select period,
 coalesce(sum(quantity * effective_unit_cost), 0) as cogs,
 count(*) filter (where unit_cost is null) as estimated_legacy_lines,
 count(*) filter (where unit_cost is not null) as snapshot_lines
 from internal_return_cost_lines
 group by period
 ),
 adjustments as (
 select p.period,
 coalesce(invoice_total.revenue, 0) - coalesce(return_total.revenue, 0) as internal_revenue,
 coalesce(invoice_total.delivery_fee, 0) as internal_delivery_fee,
 coalesce(cost_total.cogs, 0) - coalesce(return_cost.cogs, 0) as internal_cogs,
 coalesce(cost_total.estimated_legacy_lines, 0)
 + coalesce(return_cost.estimated_legacy_lines, 0) as estimated_legacy_lines,
 coalesce(cost_total.snapshot_lines, 0)
 + coalesce(return_cost.snapshot_lines, 0) as snapshot_lines
 from periods p
 left join internal_invoice_totals invoice_total using (period)
 left join internal_return_totals return_total using (period)
 left join internal_cost_totals cost_total using (period)
 left join internal_return_cost_totals return_cost using (period)
 ),
 consolidated as (
 select a.period,
 coalesce(((v_base->a.period)->>'revenue')::numeric, 0) - a.internal_revenue as revenue,
 coalesce(((v_base->a.period)->>'delivery_fee')::numeric, 0)
 - a.internal_delivery_fee as delivery_fee,
 coalesce(((v_base->a.period)->>'cogs')::numeric, 0) - a.internal_cogs as cogs,
 coalesce(((v_base->a.period)->>'operating_expense')::numeric, 0) as operating_expense,
 greatest(
 coalesce(((v_base->a.period)->>'estimated_legacy_lines')::integer, 0)
 - a.estimated_legacy_lines,
 0
 ) as estimated_legacy_lines,
 greatest(
 coalesce(((v_base->a.period)->>'snapshot_lines')::integer, 0)
 - a.snapshot_lines,
 0
 ) as snapshot_lines,
 a.internal_revenue
 from adjustments a
 )
 select jsonb_build_object(
 'current', (select to_jsonb(c) - 'period' from consolidated c where c.period = 'current'),
 'previous', (select to_jsonb(c) - 'period' from consolidated c where c.period = 'previous')
 )
 );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_xnt_report(p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_branch_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(product_id uuid, code text, name text, unit text, category_name text, cost_price numeric, opening_qty numeric, in_supplier numeric, in_check numeric, in_return numeric, in_transfer numeric, in_production numeric, in_other numeric, out_sale numeric, out_disposal numeric, out_supplier_return numeric, out_check numeric, out_transfer numeric, out_production numeric, out_internal numeric, out_other numeric, closing_qty numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_tenant_id uuid;
 v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
 if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
 raise exception using
 errcode = '22007',
 message = 'REPORT_DATE_RANGE_INVALID';
 end if;

 perform public.assert_report_access('reports.analytics', p_branch_id);
 perform public.assert_report_access('reports.view_detail', p_branch_id);

 select p.tenant_id
 into v_tenant_id
 from public.profiles p
 where p.id = auth.uid()
 and coalesce(p.is_active, true);

 if v_tenant_id is null then
 raise exception using
 errcode = '42501',
 message = 'ACTIVE_PROFILE_REQUIRED';
 end if;

 return query
 with scoped_products as (
 select
 p.id,
 p.code,
 p.name,
 coalesce(p.unit, '') as unit,
 coalesce(c.name, '') as category_name,
 case when public.user_has_permission(auth.uid(),'products.view_cost') then coalesce(p.cost_price,0) else 0 end as cost_price,
 case
 when p_branch_id is null
 then coalesce(company_bs.quantity, p.stock, 0)
 else coalesce(bs.quantity, 0)
 end::numeric as current_qty
 from public.products p
 left join public.categories c
 on c.id = p.category_id
 and c.tenant_id = v_tenant_id
 left join (
 select branch_stock.product_id, sum(branch_stock.quantity)::numeric as quantity
 from public.branch_stock
 where branch_stock.tenant_id = v_tenant_id
 and branch_stock.variant_id is null
 group by branch_stock.product_id
 ) company_bs
 on p_branch_id is null
 and company_bs.product_id = p.id
 left join public.branch_stock bs
 on p_branch_id is not null
 and bs.tenant_id = v_tenant_id
 and bs.branch_id = p_branch_id
 and bs.product_id = p.id
 and bs.variant_id is null
 where p.tenant_id = v_tenant_id
 and coalesce(p.inventory_role, '') <> 'fnb_menu_item'
 and (
 v_search is null
 or p.code ilike '%' || v_search || '%'
 or p.name ilike '%' || v_search || '%'
 )
 ),
 period_movements as (
 select
 sm.product_id,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'in'
 and lower(coalesce(sm.reference_type, '')) in (
 'purchase_entry', 'purchase_order', 'goods_receipt'
 )
 ), 0)::numeric as in_supplier,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'in'
 and lower(coalesce(sm.reference_type, '')) in (
 'inventory_check', 'stock_adjustment', 'adjustment'
 )
 ), 0)::numeric as in_check,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'in'
 and lower(coalesce(sm.reference_type, '')) in (
 'sales_return', 'invoice_void', 'return_bom_restore'
 )
 ), 0)::numeric as in_return,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'in'
 and lower(coalesce(sm.reference_type, '')) in (
 'transfer', 'stock_transfer'
 )
 ), 0)::numeric as in_transfer,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'in'
 and lower(coalesce(sm.reference_type, '')) in (
 'production_order', 'production_complete',
 'production_reconcile', 'production_consume'
 )
 ), 0)::numeric as in_production,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'in'
 and lower(coalesce(sm.reference_type, '')) not in (
 'purchase_entry', 'purchase_order', 'goods_receipt',
 'inventory_check', 'stock_adjustment', 'adjustment',
 'sales_return', 'invoice_void', 'return_bom_restore',
 'transfer', 'stock_transfer',
 'production_order', 'production_complete',
 'production_reconcile', 'production_consume'
 )
 ), 0)::numeric as in_other,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) in (
 'invoice', 'sale', 'pos_sale', 'bom_consume', 'modifier_topping'
 )
 ), 0)::numeric as out_sale,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) in (
 'disposal', 'disposal_export'
 )
 ), 0)::numeric as out_disposal,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) in (
 'supplier_return', 'purchase_return', 'purchase_order_revert'
 )
 ), 0)::numeric as out_supplier_return,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) in (
 'inventory_check', 'stock_adjustment', 'adjustment'
 )
 ), 0)::numeric as out_check,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) in (
 'transfer', 'stock_transfer'
 )
 ), 0)::numeric as out_transfer,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) in (
 'production_order', 'production_complete',
 'production_reconcile', 'production_consume'
 )
 ), 0)::numeric as out_production,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) in (
 'internal_export', 'internal_sale', 'input_invoice'
 )
 ), 0)::numeric as out_internal,
 coalesce(sum(sm.quantity) filter (
 where sm.type = 'out'
 and lower(coalesce(sm.reference_type, '')) not in (
 'invoice', 'sale', 'pos_sale', 'bom_consume', 'modifier_topping',
 'disposal', 'disposal_export',
 'supplier_return', 'purchase_return', 'purchase_order_revert',
 'inventory_check', 'stock_adjustment', 'adjustment',
 'transfer', 'stock_transfer',
 'production_order', 'production_complete',
 'production_reconcile', 'production_consume',
 'internal_export', 'internal_sale', 'input_invoice'
 )
 ), 0)::numeric as out_other
 from public.stock_movements sm
 join scoped_products p on p.id = sm.product_id
 where sm.tenant_id = v_tenant_id
 and sm.created_at >= p_date_from
 and sm.created_at < p_date_to
 and (p_branch_id is null or sm.branch_id = p_branch_id)
 group by sm.product_id
 ),
 movements_after_period as (
 select
 sm.product_id,
 coalesce(sum(case
 when sm.type = 'in' then sm.quantity
 when sm.type = 'out' then -sm.quantity
 else 0
 end), 0)::numeric as net_after
 from public.stock_movements sm
 join scoped_products p on p.id = sm.product_id
 where sm.tenant_id = v_tenant_id
 and sm.created_at >= p_date_to
 and sm.created_at < now()
 and (p_branch_id is null or sm.branch_id = p_branch_id)
 group by sm.product_id
 ),
 calculated as (
 select
 p.*,
 coalesce(pm.in_supplier, 0) as in_supplier,
 coalesce(pm.in_check, 0) as in_check,
 coalesce(pm.in_return, 0) as in_return,
 coalesce(pm.in_transfer, 0) as in_transfer,
 coalesce(pm.in_production, 0) as in_production,
 coalesce(pm.in_other, 0) as in_other,
 coalesce(pm.out_sale, 0) as out_sale,
 coalesce(pm.out_disposal, 0) as out_disposal,
 coalesce(pm.out_supplier_return, 0) as out_supplier_return,
 coalesce(pm.out_check, 0) as out_check,
 coalesce(pm.out_transfer, 0) as out_transfer,
 coalesce(pm.out_production, 0) as out_production,
 coalesce(pm.out_internal, 0) as out_internal,
 coalesce(pm.out_other, 0) as out_other,
 p.current_qty - coalesce(ap.net_after, 0) as closing_at_period
 from scoped_products p
 left join period_movements pm on pm.product_id = p.id
 left join movements_after_period ap on ap.product_id = p.id
 )
 select
 c.id,
 c.code,
 c.name,
 c.unit,
 nullif(c.category_name, ''),
 c.cost_price,
 c.closing_at_period
 - (
 c.in_supplier + c.in_check + c.in_return + c.in_transfer
 + c.in_production + c.in_other
 )
 + (
 c.out_sale + c.out_disposal + c.out_supplier_return + c.out_check
 + c.out_transfer + c.out_production + c.out_internal + c.out_other
 ) as opening_qty,
 c.in_supplier,
 c.in_check,
 c.in_return,
 c.in_transfer,
 c.in_production,
 c.in_other,
 c.out_sale,
 c.out_disposal,
 c.out_supplier_return,
 c.out_check,
 c.out_transfer,
 c.out_production,
 c.out_internal,
 c.out_other,
 c.closing_at_period
 from calculated c
 order by c.name, c.code, c.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_branch_profit_and_loss_report(p_date_from timestamp with time zone, p_date_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare -- ISSUED_AT_00335
 v_tenant_id uuid;
begin
 if not public.user_has_permission(auth.uid(),'products.view_cost') then
 raise exception 'COST_VIEW_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_date_from is null or p_date_to is null or p_date_from >= p_date_to then
 raise exception using errcode = '22007', message = 'REPORT_DATE_RANGE_INVALID';
 end if;

 perform public.assert_report_access('reports.analytics', null);
 perform public.assert_report_access('reports.view_detail', null);

 select p.tenant_id into v_tenant_id
 from public.profiles p
 where p.id = auth.uid() and coalesce(p.is_active, true);

 return (
 with active_branches as (
 select b.id, b.name, coalesce(b.branch_type, 'store') as branch_type
 from public.branches b
 where b.tenant_id = v_tenant_id
 and b.is_active
 ),
 scoped_invoices as (
 select i.id, i.branch_id, i.total, coalesce(i.delivery_fee, 0) as delivery_fee
 from public.invoices i
 where i.tenant_id = v_tenant_id
 and i.status = 'completed'
 and i.issued_at >= p_date_from
 and i.issued_at < p_date_to
 ),
 invoice_totals as (
 select
 branch_id,
 coalesce(sum(total), 0) as total_revenue,
 coalesce(sum(delivery_fee), 0) as delivery_fee
 from scoped_invoices
 group by branch_id
 ),
 cost_totals as (
 select
 si.branch_id,
 coalesce(sum(ii.quantity * coalesce(ii.unit_cost, pr.cost_price, 0)), 0) as cogs,
 count(*) filter (where ii.unit_cost is null) as estimated_legacy_lines,
 count(*) filter (where ii.unit_cost is not null) as snapshot_lines
 from scoped_invoices si
 join public.invoice_items ii on ii.invoice_id = si.id
 left join public.products pr on pr.id = ii.product_id
 group by si.branch_id
 ),
 scoped_returns as (
 select sr.id, sr.invoice_id, sr.branch_id, sr.total
 from public.sales_returns sr
 where sr.tenant_id = v_tenant_id
 and sr.status in ('confirmed', 'completed')
 and sr.created_at >= p_date_from
 and sr.created_at < p_date_to
 ),
 return_totals as (
 select branch_id, coalesce(sum(total), 0) as returned
 from scoped_returns
 group by branch_id
 ),
 return_cost_lines as (
 select
 sr.branch_id,
 ri.quantity,
 source_cost.unit_cost,
 coalesce(source_cost.unit_cost, pr.cost_price, 0) as effective_unit_cost
 from scoped_returns sr
 join public.return_items ri on ri.return_id = sr.id
 left join lateral (
 select ii.unit_cost
 from public.invoice_items ii
 where ii.invoice_id = sr.invoice_id
 and ii.product_id = ri.product_id
 order by ii.id
 limit 1
 ) source_cost on true
 left join public.products pr on pr.id = ri.product_id
 ),
 return_cost_totals as (
 select
 branch_id,
 coalesce(sum(quantity * effective_unit_cost), 0) as return_cogs,
 count(*) filter (where unit_cost is null) as estimated_legacy_lines,
 count(*) filter (where unit_cost is not null) as snapshot_lines
 from return_cost_lines
 group by branch_id
 ),
 expense_totals as (
 select
 ct.branch_id,
 coalesce(sum(ct.amount), 0) as operating_expense
 from public.cash_transactions ct
 where ct.tenant_id = v_tenant_id
 and ct.type = 'payment'
 and coalesce(ct.status, 'completed') = 'completed'
 and ct.created_at >= p_date_from
 and ct.created_at < p_date_to
 and coalesce(ct.category, '') <> all(array[
 'Nhập hàng',
 'Mua hàng nội bộ',
 'Hoàn tiền hủy đơn',
 'Hoàn trả',
 'Trả hàng', 'Tra hang',
 'Trả nhà cung cấp',
 'supplier_payment'
 ])
 group by ct.branch_id
 ),
 base as (
 select
 b.id as branch_id,
 b.name as branch_name,
 b.branch_type,
 coalesce(i.total_revenue, 0) - coalesce(r.returned, 0) as total_revenue,
 coalesce(i.delivery_fee, 0) as delivery_fee,
 coalesce(c.cogs, 0) - coalesce(rc.return_cogs, 0) as cogs,
 coalesce(e.operating_expense, 0) as operating_expense,
 coalesce(c.estimated_legacy_lines, 0) +
 coalesce(rc.estimated_legacy_lines, 0) as estimated_legacy_lines,
 coalesce(c.snapshot_lines, 0) +
 coalesce(rc.snapshot_lines, 0) as snapshot_lines
 from active_branches b
 left join invoice_totals i on i.branch_id = b.id
 left join cost_totals c on c.branch_id = b.id
 left join return_totals r on r.branch_id = b.id
 left join return_cost_totals rc on rc.branch_id = b.id
 left join expense_totals e on e.branch_id = b.id
 ),
 calculated as (
 select
 base.*,
 total_revenue - delivery_fee as goods_revenue,
 total_revenue - delivery_fee - cogs as gross_profit,
 total_revenue - delivery_fee - cogs - operating_expense as operating_result
 from base
 )
 select jsonb_build_object(
 'rows',
 coalesce(
 jsonb_agg(
 jsonb_build_object(
 'branch_id', branch_id,
 'branch_name', branch_name,
 'branch_type', branch_type,
 'total_revenue', total_revenue,
 'delivery_fee', delivery_fee,
 'goods_revenue', goods_revenue,
 'cogs', cogs,
 'gross_profit', gross_profit,
 'gross_margin', coalesce(
 round(gross_profit * 100 / nullif(goods_revenue, 0), 1),
 0
 ),
 'operating_expense', operating_expense,
 'operating_result', operating_result,
 'operating_margin', coalesce(
 round(operating_result * 100 / nullif(goods_revenue, 0), 1),
 0
 ),
 'estimated_legacy_lines', estimated_legacy_lines,
 'snapshot_lines', snapshot_lines
 )
 order by branch_name
 ),
 '[]'::jsonb
 )
 )
 from calculated
 );
end;
$function$
;

notify pgrst,'reload schema';
create or replace function public.get_inventory_check_list_workspace(
  p_page integer default 0,p_page_size integer default 20,p_search text default null,p_search_field text default 'all',p_statuses text[] default null,p_date_from timestamptz default null,p_date_to_exclusive timestamptz default null,p_created_by uuid default null,p_branch_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_all boolean;v_q text:=nullif(trim(coalesce(p_search,'')),'');v_page integer:=greatest(coalesce(p_page,0),0);v_size integer:=least(greatest(coalesce(p_page_size,20),1),200);v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='INVENTORY_CHECK_LIST_AUTH_REQUIRED';end if;v_tenant:=public.get_user_tenant_id();
  if v_tenant is null or not exists(select 1 from public.profiles p where p.id=v_actor and p.tenant_id=v_tenant and coalesce(p.is_active,true)) then raise exception using errcode='42501',message='INVENTORY_CHECK_LIST_PROFILE_DENIED';end if;
  if not public.user_has_permission(v_actor,'inventory.view') then raise exception using errcode='42501',message='INVENTORY_CHECK_LIST_PERMISSION_DENIED';end if;
  v_all:=public.user_has_permission(v_actor,'reports.view_all_branches');
  if p_branch_id is not null and (not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=v_tenant) or (not v_all and not public.user_has_branch_access(v_actor,p_branch_id))) then raise exception using errcode='42501',message='INVENTORY_CHECK_LIST_BRANCH_DENIED';end if;
  with scoped as(
    select c.*,p.full_name created_by_name,b.name branch_name,coalesce(a.total_products,0)::integer total_products,coalesce(a.increase_qty,0)::numeric increase_qty,coalesce(a.decrease_qty,0)::numeric decrease_qty,coalesce(a.increase_amount,0)::numeric increase_amount,coalesce(a.decrease_amount,0)::numeric decrease_amount
    from public.inventory_checks c left join public.profiles p on p.id=c.created_by and p.tenant_id=v_tenant left join public.branches b on b.id=c.branch_id and b.tenant_id=v_tenant
    left join lateral(select count(*) total_products,coalesce(sum(greatest(i.difference,0)),0) increase_qty,coalesce(sum(abs(least(i.difference,0))),0) decrease_qty,coalesce(sum(greatest(i.difference,0)*coalesce(i.unit_cost,pr.cost_price,0)),0) increase_amount,coalesce(sum(abs(least(i.difference,0))*coalesce(i.unit_cost,pr.cost_price,0)),0) decrease_amount from public.inventory_check_items_scoped i left join public.products_scoped pr on pr.id=i.product_id and pr.tenant_id=v_tenant where i.check_id=c.id)a on true
    where c.tenant_id=v_tenant and ((p_branch_id is not null and c.branch_id=p_branch_id)or(p_branch_id is null and v_all)or(p_branch_id is null and not v_all and c.branch_id in(select x.branch_id from public.get_user_accessible_branches(v_actor)x)))
  ),filtered as(select s.* from scoped s where(v_q is null or case coalesce(p_search_field,'all') when 'code' then position(lower(v_q)in lower(coalesce(s.code,'')))>0 when 'note' then position(lower(v_q)in lower(coalesce(s.note,'')))>0 when 'creator' then position(lower(v_q)in lower(coalesce(s.created_by_name,'')))>0 when 'product' then exists(select 1 from public.inventory_check_items_scoped i left join public.products_scoped pr on pr.id=i.product_id and pr.tenant_id=v_tenant where i.check_id=s.id and(position(lower(v_q)in lower(coalesce(i.product_name,'')))>0 or position(lower(v_q)in lower(coalesce(pr.code,'')))>0)) else position(lower(v_q)in lower(coalesce(s.code,'')))>0 or position(lower(v_q)in lower(coalesce(s.note,'')))>0 or position(lower(v_q)in lower(coalesce(s.created_by_name,'')))>0 or exists(select 1 from public.inventory_check_items_scoped i left join public.products_scoped pr on pr.id=i.product_id and pr.tenant_id=v_tenant where i.check_id=s.id and(position(lower(v_q)in lower(coalesce(i.product_name,'')))>0 or position(lower(v_q)in lower(coalesce(pr.code,'')))>0)) end)and(coalesce(array_length(p_statuses,1),0)=0 or s.status=any(p_statuses))and(p_date_from is null or s.created_at>=p_date_from)and(p_date_to_exclusive is null or s.created_at<p_date_to_exclusive)and(p_created_by is null or s.created_by=p_created_by)),ranked as(select f.*,row_number()over(order by f.created_at desc,f.id)rn from filtered f),page_rows as(select * from ranked where rn>v_page*v_size and rn<=(v_page+1)*v_size order by rn),summary as(select count(*)::bigint total_count,count(*)filter(where status in('draft','in_progress'))::bigint processing_count,count(*)filter(where status='balanced')::bigint balanced_count,count(*)filter(where status='cancelled')::bigint cancelled_count,coalesce(sum(increase_amount-decrease_amount),0)::numeric net_variance from filtered)
  select jsonb_build_object('items',coalesce((select jsonb_agg((to_jsonb(r)-'rn'-'created_by_name'-'branch_name')||jsonb_build_object('profiles',case when r.created_by_name is null then null else jsonb_build_object('full_name',r.created_by_name)end,'branches',case when r.branch_name is null then null else jsonb_build_object('name',r.branch_name)end)order by r.rn)from page_rows r),'[]'::jsonb),'total',(select total_count from summary),'summary',(select jsonb_build_object('processingCount',processing_count,'balancedCount',balanced_count,'cancelledCount',cancelled_count,'netVariance',net_variance)from summary))into v_result;return v_result;
end $$;

create or replace function public.get_production_order_list_workspace(
  p_page integer default 0,p_page_size integer default 20,p_search text default null,p_search_field text default 'all',p_statuses text[] default null,p_date_from timestamptz default null,p_date_to_exclusive timestamptz default null,p_created_by uuid default null,p_qty_min numeric default null,p_qty_max numeric default null,p_branch_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_all boolean;v_q text:=nullif(trim(coalesce(p_search,'')),'');v_page integer:=greatest(coalesce(p_page,0),0);v_size integer:=least(greatest(coalesce(p_page_size,20),1),200);v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='PRODUCTION_LIST_AUTH_REQUIRED';end if;v_tenant:=public.get_user_tenant_id();if v_tenant is null or not exists(select 1 from public.profiles p where p.id=v_actor and p.tenant_id=v_tenant and coalesce(p.is_active,true))then raise exception using errcode='42501',message='PRODUCTION_LIST_PROFILE_DENIED';end if;if not public.user_has_permission(v_actor,'production.view')then raise exception using errcode='42501',message='PRODUCTION_LIST_PERMISSION_DENIED';end if;v_all:=public.user_has_permission(v_actor,'reports.view_all_branches');if p_branch_id is not null and(not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=v_tenant)or(not v_all and not public.user_has_branch_access(v_actor,p_branch_id)))then raise exception using errcode='42501',message='PRODUCTION_LIST_BRANCH_DENIED';end if;if p_qty_min is not null and p_qty_max is not null and p_qty_min>p_qty_max then raise exception using errcode='22023',message='PRODUCTION_LIST_QTY_RANGE_INVALID';end if;
  with scoped as(select o.*,pr.name product_name,pr.code product_code,b.name branch_name,p.full_name created_by_name from public.production_orders_scoped o join public.products_scoped pr on pr.id=o.product_id and pr.tenant_id=v_tenant join public.branches b on b.id=o.branch_id and b.tenant_id=v_tenant left join public.profiles p on p.id=o.created_by and p.tenant_id=v_tenant where o.tenant_id=v_tenant and((p_branch_id is not null and o.branch_id=p_branch_id)or(p_branch_id is null and v_all)or(p_branch_id is null and not v_all and o.branch_id in(select x.branch_id from public.get_user_accessible_branches(v_actor)x)))),filtered as(select s.* from scoped s where(v_q is null or case coalesce(p_search_field,'all')when 'code'then position(lower(v_q)in lower(s.code))>0 when 'product_code'then position(lower(v_q)in lower(s.product_code))>0 when 'product_name'then position(lower(v_q)in lower(s.product_name))>0 when 'lot_number'then position(lower(v_q)in lower(coalesce(s.lot_number,'')))>0 when 'creator'then position(lower(v_q)in lower(coalesce(s.created_by_name,'')))>0 when 'note'then position(lower(v_q)in lower(coalesce(s.notes,'')))>0 else position(lower(v_q)in lower(s.code))>0 or position(lower(v_q)in lower(s.product_code))>0 or position(lower(v_q)in lower(s.product_name))>0 or position(lower(v_q)in lower(coalesce(s.lot_number,'')))>0 or position(lower(v_q)in lower(coalesce(s.created_by_name,'')))>0 or position(lower(v_q)in lower(coalesce(s.notes,'')))>0 end)and(coalesce(array_length(p_statuses,1),0)=0 or s.status=any(p_statuses))and(p_date_from is null or s.created_at>=p_date_from)and(p_date_to_exclusive is null or s.created_at<p_date_to_exclusive)and(p_created_by is null or s.created_by=p_created_by)and(p_qty_min is null or s.planned_qty>=p_qty_min)and(p_qty_max is null or s.planned_qty<=p_qty_max)),ranked as(select f.*,row_number()over(order by f.created_at desc,f.id)rn from filtered f),page_rows as(select * from ranked where rn>v_page*v_size and rn<=(v_page+1)*v_size order by rn),summary as(select count(*)::bigint total_count,count(*)filter(where status in('in_production','quality_check'))::bigint in_progress_count,count(*)filter(where status='completed' and actual_end>=(current_date::timestamp at time zone 'Asia/Ho_Chi_Minh') and actual_end<((current_date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))::bigint completed_today_count,count(*)filter(where status='cancelled')::bigint cancelled_count,coalesce(sum(cogs_amount),0)::numeric total_cogs from filtered)
  select jsonb_build_object('items',coalesce((select jsonb_agg((to_jsonb(r)-'rn'-'product_name'-'product_code'-'branch_name'-'created_by_name')||jsonb_build_object('products',jsonb_build_object('name',r.product_name,'code',r.product_code),'branches',jsonb_build_object('name',r.branch_name),'profiles',case when r.created_by_name is null then null else jsonb_build_object('full_name',r.created_by_name)end)order by r.rn)from page_rows r),'[]'::jsonb),'total',(select total_count from summary),'summary',(select jsonb_build_object('inProgressCount',in_progress_count,'completedTodayCount',completed_today_count,'cancelledCount',cancelled_count,'totalCogs',total_cogs)from summary))into v_result;return v_result;
end $$;

-- Lot readers used by outlet staff must apply the same branch scope as stock.
create or replace function public.get_lots_for_product(p_product_id uuid,p_branch_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=public.get_user_tenant_id(); v_result jsonb;
begin
 if v_tenant is null or not public.user_has_permission(auth.uid(),'inventory.view') then raise exception 'LOT_READ_PERMISSION_DENIED' using errcode='42501';end if;
 if p_branch_id is not null and not public._can_read_branch_inventory_00476(auth.uid(),v_tenant,p_branch_id) then raise exception 'LOT_BRANCH_DENIED' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',pl.id,'lot_number',pl.lot_number,'source_type',pl.source_type,
 'manufactured_date',pl.manufactured_date,'expiry_date',pl.expiry_date,'received_date',pl.received_date,
 'current_qty',pl.current_qty,'initial_qty',pl.initial_qty,'branch_name',b.name,
 'expiry_status',case when pl.expiry_date is null then 'no_expiry' when pl.expiry_date<current_date then 'expired' when pl.expiry_date<current_date+30 then 'expiring_soon' else 'ok' end,
 'days_until_expiry',pl.expiry_date-current_date) order by pl.expiry_date asc nulls last,pl.received_date),'[]'::jsonb) into v_result
 from public.product_lots pl join public.branches b on b.id=pl.branch_id and b.tenant_id=pl.tenant_id
 where pl.tenant_id=v_tenant and pl.product_id=p_product_id and pl.status='active' and pl.current_qty>0
 and (p_branch_id is null or pl.branch_id=p_branch_id)
 and public._can_read_branch_inventory_00476(auth.uid(),v_tenant,pl.branch_id);
 return v_result;
end; $$;
create or replace function public.check_expiring_lots(p_tenant_id uuid,p_days_threshold integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_lots jsonb;
begin
 if p_tenant_id is distinct from public.get_user_tenant_id() or not public.user_has_permission(auth.uid(),'inventory.view') then raise exception 'LOT_READ_PERMISSION_DENIED' using errcode='42501';end if;
 p_days_threshold:=least(greatest(coalesce(p_days_threshold,30),0),3650);
 select coalesce(jsonb_agg(jsonb_build_object('lot_id',pl.id,'lot_number',pl.lot_number,'product_id',pl.product_id,
 'product_name',p.name,'product_code',p.code,'expiry_date',pl.expiry_date,'current_qty',pl.current_qty,
 'branch_name',b.name,'days_remaining',pl.expiry_date-current_date,'is_expired',pl.expiry_date<current_date) order by pl.expiry_date),'[]'::jsonb)
 into v_lots from public.product_lots pl join public.products p on p.id=pl.product_id and p.tenant_id=pl.tenant_id
 join public.branches b on b.id=pl.branch_id and b.tenant_id=pl.tenant_id
 where pl.tenant_id=p_tenant_id and pl.status='active' and pl.current_qty>0 and pl.expiry_date<=current_date+p_days_threshold
 and public._can_read_branch_inventory_00476(auth.uid(),p_tenant_id,pl.branch_id);
 return jsonb_build_object('threshold_days',p_days_threshold,'total',jsonb_array_length(v_lots),'lots',v_lots);
end; $$;

CREATE OR REPLACE FUNCTION public.create_fnb_product_with_size_setup_atomic(p_product jsonb, p_variants jsonb, p_modifier_group_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
 v_actor uuid := auth.uid();
 v_tenant uuid;
 v_product_id uuid := extensions.uuid_generate_v4();
 v_category_id uuid;
 v_code text;
 v_name text;
 v_unit text;
 v_sell_price numeric;
 v_cost_price numeric;
 v_size_result jsonb;
begin
 if v_actor is null then
 raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
 end if;
 select p.tenant_id into v_tenant
 from public.profiles p
 where p.id = v_actor and p.is_active;
 if v_tenant is null then
 raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
 end if;
 if not public.user_has_permission(v_actor, 'products.edit') then
 raise exception using errcode = '42501', message = 'FNB_PRODUCT_CREATE_PERMISSION_DENIED';
 end if;
 if p_product is null or jsonb_typeof(p_product) <> 'object'
 or p_variants is null or jsonb_typeof(p_variants) <> 'array'
 or jsonb_array_length(p_variants) = 0 then
 raise exception using errcode = '22023', message = 'FNB_PRODUCT_CREATE_PAYLOAD_INVALID';
 end if;

 begin
 v_category_id := nullif(p_product->>'categoryId', '')::uuid;
 v_sell_price := (p_product->>'sellPrice')::numeric;
 v_cost_price := coalesce((p_product->>'costPrice')::numeric, 0);
 exception when invalid_text_representation then
 raise exception using errcode = '22023', message = 'FNB_PRODUCT_CREATE_FORMAT_INVALID';
 end;
 if not public.user_has_permission(v_actor,'products.view_cost') then v_cost_price:=0;end if;
 v_code := nullif(trim(p_product->>'code'), '');
 v_name := nullif(trim(p_product->>'name'), '');
 v_unit := coalesce(nullif(trim(p_product->>'unit'), ''), 'Ly');

 if v_code is null or v_name is null or v_category_id is null
 or v_sell_price is null or v_sell_price < 0 or (v_sell_price = 0 and not coalesce((p_product->>'allowFreeSale')::boolean, false)) or v_cost_price < 0 then
 raise exception using errcode = '22023', message = 'FNB_PRODUCT_CREATE_REQUIRED_FIELDS';
 end if;
 if not exists (
 select 1 from public.categories c
 where c.id = v_category_id and c.tenant_id = v_tenant
 ) then
 raise exception using errcode = 'P0001', message = 'FNB_PRODUCT_CREATE_CATEGORY_INVALID';
 end if;
 if exists (
 select 1 from public.products p
 where p.tenant_id = v_tenant and lower(p.code) = lower(v_code)
 ) then
 raise exception using errcode = '23505', message = 'FNB_PRODUCT_CREATE_CODE_DUPLICATE';
 end if;

 insert into public.products (
 id, tenant_id, code, name, sell_price, cost_price, allow_free_sale, category_id,
 unit, purchase_unit, stock_unit, sell_unit, stock, min_stock, max_stock,
 vat_rate, barcode, weight, description, image_url, allow_sale, is_active,
 product_type, channel, has_bom, bom_code, group_code,
 shelf_life_days, shelf_life_unit, supplier_id, brand
 ) values (
 v_product_id, v_tenant, v_code, v_name, v_sell_price, v_cost_price, coalesce((p_product->>'allowFreeSale')::boolean, false),
 v_category_id, v_unit,
 coalesce(nullif(trim(p_product->>'purchaseUnit'), ''), v_unit),
 coalesce(nullif(trim(p_product->>'stockUnit'), ''), v_unit),
 coalesce(nullif(trim(p_product->>'sellUnit'), ''), v_unit),
 0,
 coalesce((p_product->>'minStock')::numeric, 0),
 coalesce((p_product->>'maxStock')::numeric, 1000),
 coalesce((p_product->>'vatRate')::numeric, 0),
 nullif(p_product->>'barcode', ''),
 nullif(p_product->>'weight', '')::numeric,
 nullif(p_product->>'description', ''),
 nullif(p_product->>'image', ''),
 coalesce((p_product->>'allowSale')::boolean, true),
 true, 'sku', 'fnb', true,
 nullif(p_product->>'bomCode', ''),
 nullif(p_product->>'groupCode', ''),
 nullif(p_product->>'shelfLifeDays', '')::integer,
 coalesce(nullif(p_product->>'shelfLifeUnit', ''), 'day'),
 nullif(p_product->>'supplierId', '')::uuid,
 nullif(p_product->>'brand', '')
 );

 if coalesce(array_length(p_modifier_group_ids, 1), 0) > 0 then
 perform public.save_product_modifier_groups_atomic(
 v_product_id,
 p_modifier_group_ids
 );
 end if;

 v_size_result := public.save_fnb_size_setup_atomic(v_product_id, p_variants);

 return jsonb_build_object(
 'success', true,
 'productId', v_product_id,
 'code', v_code,
 'variants', coalesce(v_size_result->'variants', '[]'::jsonb)
 );
end;
$function$;

commit;
