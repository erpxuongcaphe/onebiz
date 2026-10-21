-- MANUAL OPERATION ONLY, after explicit approval of the deltas below.
-- Add inventory adjustments linked to the affected closed bills; never rewrite their snapshots or revenue.
begin;
set local lock_timeout='3s';
do $repair$
declare
 v_tenant uuid:='148e8ac5-b891-4de3-9055-cfa41f39ddb0';
 v_branch uuid:='0dfc218e-0b32-4096-8205-d5f82ab42492';
 v_actor uuid:='7f763419-5392-49de-9796-af2402c8cd23'; -- existing tenant administrative account, recorded in the audit
 v_reference uuid:='f5e8e6bc-819a-4af7-92f4-202610210001';
 v_honey_items uuid[]:=array['00b66ad4-3e3d-4456-a2de-90bd5f212979','02ba5cc9-a0f9-4cc5-a4da-f3af6f543405','06511126-286e-4ef3-914a-a0d5f16c689b','f147bbf6-929e-46ba-8012-4aaae6adac60','d30a867d-2149-46bf-aff9-2fdc3582b982']::uuid[];
 v_lemon_items uuid[]:=array['6f8fdb87-f681-4a82-906a-a94102130b65','c5f50c0a-e50c-4976-9a08-e188588d73a7','0b07952d-75f6-4591-9ed6-a7c860a51592','9546c4ea-01c3-465f-861f-7cd13b07d92a','69abd274-385a-435b-96f8-04f1ec2f8c25','86dbc344-9c90-4899-a33e-116ebc5ed2eb','4635b595-9d60-4792-8ca5-6660969ced9f','a53dab0f-dccc-4bab-9346-10458931e54c']::uuid[];
 v_evidence jsonb;v_count integer;v_before jsonb;v_result jsonb;v_material uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_reference::text,0));
 if exists(select 1 from public.audit_log where tenant_id=v_tenant and entity_id=v_reference and action='confirmed_recipe_stock_correction_20261021') then return;end if;
 if exists(select 1 from public.stock_movements where tenant_id=v_tenant and reference_id=v_reference) then raise exception 'RECIPE_CORRECTION_PARTIAL_REVIEW_REQUIRED';end if;
 if not exists(select 1 from public.profiles where id=v_actor and tenant_id=v_tenant and is_active and role::text='owner') then raise exception 'RECIPE_CORRECTION_ADMIN_CHANGED';end if;
 perform set_config('request.jwt.claim.sub',v_actor::text,true);
 perform 1 from public.products where id in('0a398b76-4de8-4317-8e34-0e594fe59b0b','34617a2e-d6e4-40b3-b20a-3587266ddf9b','64ce6219-d22d-4313-97b7-49add8a8bd6b') order by id for update;
 perform 1 from public.invoices where id in(select invoice_id from public.invoice_items where id=any(v_honey_items||v_lemon_items)) order by id for update;
 with wanted as(
 select unnest(v_honey_items) item_id,'240e906d-e95e-4e9b-bdba-dea969feca96'::uuid product_id,'0a398b76-4de8-4317-8e34-0e594fe59b0b'::uuid material_id,0.0003::numeric old_qty
 union all select ii,'dd1f9569-604b-458c-a43e-eb5217a4c736'::uuid,q.material_id,q.old_qty
 from unnest(v_lemon_items) ii cross join(values('34617a2e-d6e4-40b3-b20a-3587266ddf9b'::uuid,2::numeric),('64ce6219-d22d-4313-97b7-49add8a8bd6b'::uuid,1::numeric))q(material_id,old_qty)
 ) select count(*),jsonb_agg(jsonb_build_object('invoice',i.code,'invoice_id',i.id,'invoice_item_id',ii.id,'material_id',c.material_id,'old_quantity',c.quantity) order by ii.id,c.material_id)
 into v_count,v_evidence from wanted w join public.invoice_items ii on ii.id=w.item_id and ii.product_id=w.product_id and ii.quantity=1
 join public.invoices i on i.id=ii.invoice_id and i.tenant_id=v_tenant and i.branch_id=v_branch and i.status='completed'
 join public.fnb_invoice_item_bom_snapshots_00410 s on s.invoice_item_id=ii.id and s.invoice_id=i.id and s.tenant_id=v_tenant and s.branch_id=v_branch
 join public.fnb_invoice_item_bom_snapshot_components_00410 c on c.invoice_item_id=ii.id and c.material_id=w.material_id and c.quantity=w.old_qty
 where s.created_at>='2026-10-21 00:00+07' and s.created_at<'2026-10-22 00:00+07';
 if v_count<>21 or exists(select 1 from public.sales_returns sr where sr.invoice_id in(select (e->>'invoice_id')::uuid from jsonb_array_elements(v_evidence)e) and sr.status<>'cancelled') then
 raise exception 'RECIPE_CORRECTION_BILL_EVIDENCE_CHANGED';end if;
 for v_material in select distinct (e->>'material_id')::uuid from jsonb_array_elements(v_evidence)e loop
 if not exists(select 1 from public.branch_stock bs join public.fnb_branch_product_cost_balances cb using(tenant_id,branch_id,product_id)
 where bs.tenant_id=v_tenant and bs.branch_id=v_branch and bs.product_id=v_material and bs.variant_id is null
 and abs(bs.quantity-cb.costed_quantity)<=0.0001 and cb.costed_quantity>0) then raise exception 'RECIPE_CORRECTION_COST_REVIEW_REQUIRED';end if;
 end loop;
 select jsonb_agg(to_jsonb(bs) order by bs.product_id) into v_before from public.branch_stock bs where bs.tenant_id=v_tenant and bs.branch_id=v_branch and bs.variant_id is null and bs.product_id in(select distinct (e->>'material_id')::uuid from jsonb_array_elements(v_evidence)e);
 v_result:=public.apply_manual_stock_movement_atomic(null,v_branch,null,jsonb_build_array(
 jsonb_build_object('product_id','34617a2e-d6e4-40b3-b20a-3587266ddf9b','type','in','quantity',4,'reference_type','stock_adjustment','reference_id',v_reference,'note','Owner-approved correction 21/10: 8 HTR Chanh bills, restore 0.5 lemon/cup; original bills preserved'),
 jsonb_build_object('product_id','64ce6219-d22d-4313-97b7-49add8a8bd6b','type','in','quantity',4,'reference_type','stock_adjustment','reference_id',v_reference,'note','Owner-approved correction 21/10: 8 HTR Chanh bills, restore 0.5 tac/cup; original bills preserved'),
 jsonb_build_object('product_id','0a398b76-4de8-4317-8e34-0e594fe59b0b','type','out','quantity',0.087,'reference_type','stock_adjustment','reference_id',v_reference,'note','Owner-approved correction 21/10: 5 HTR Mat Ong bills, extra 0.0174 bottle/cup; 53g input rounds to 0.0177 bottle/cup; original bills preserved')));
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(v_tenant,v_actor,'confirmed_recipe_stock_correction_20261021','stock_adjustment',v_reference,
 jsonb_build_object('stocks',v_before,'bill_evidence',v_evidence),
 jsonb_build_object('result',v_result,'deltas',jsonb_build_object('lemon',4,'tac',4,'honey_bottles',-0.087),'basis','Owner confirmed recipes; inventory adjustment only, no invoice/snapshot or revenue rewrite'));
end;$repair$;
commit;
