-- New approvals and future checkouts only. Historical invoice allocations stay immutable.
begin;
set local lock_timeout='3s';

create function public._validate_fnb_item_discount_20261020(p_meta jsonb) returns jsonb
language plpgsql set search_path=public,pg_temp as $$
declare gross numeric; selected numeric; available numeric; expected numeric; value numeric; mode text; existing numeric;
begin
 if coalesce(p_meta->>'discount_scope','bill')='bill' then return p_meta; end if;
 if p_meta->>'discount_scope'<>'items' or exists(select 1 from jsonb_array_elements(p_meta->'items') e where jsonb_typeof(e->'discount_selected') is distinct from 'boolean') then raise exception 'APPROVAL_ITEMS_SCOPE_INVALID'; end if;
 mode:=p_meta->>'discount_mode'; value:=(p_meta->>'discount_value')::numeric;
 if mode not in ('amount','percent') or mode is null or value is null or value<=0 or value in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or (mode='percent' and value>100) then raise exception 'APPROVAL_ITEMS_SCOPE_INVALID'; end if;
 select coalesce(sum(q.gross),0),coalesce(sum(q.gross) filter(where (q.e->>'discount_selected')::boolean),0) into gross,selected
 from (select e, (e->>'quantity')::numeric*((e->>'unitPrice')::numeric+coalesce((select sum((t->>'quantity')::numeric*(t->>'price')::numeric) from jsonb_array_elements(coalesce(nullif(e->'toppings','null'::jsonb),'[]')) t),0)) gross from jsonb_array_elements(p_meta->'items') e) q;
 existing:=coalesce((p_meta->>'existing_discount')::numeric,0);
 if gross is distinct from (p_meta->>'subtotal')::numeric or selected<=0 or existing<0 or existing>gross then raise exception 'APPROVAL_ITEMS_SCOPE_INVALID'; end if;
 available:=greatest(0,least(selected,gross-existing));
 expected:=case when mode='percent' then round(available*value/100) else least(round(value),available) end;
 if expected<=0 or expected is distinct from (p_meta->>'amount')::numeric then raise exception 'APPROVAL_AMOUNT_CHANGED'; end if;
 return jsonb_set(p_meta,'{items}',(select jsonb_agg(e||jsonb_build_object('productName',case when (e->>'discount_selected')::boolean then '[Giảm món này] ' else '' end||coalesce(e->>'productName','Món')) order by n) from jsonb_array_elements(p_meta->'items') with ordinality x(e,n)));
end $$;
revoke all on function public._validate_fnb_item_discount_20261020(jsonb) from public,anon,authenticated;

-- Resolve the approved selection against server rows. Identical unsent rows are
-- interchangeable; sent rows bind their exact kitchen item ID as well.
create function public._fnb_selected_kitchen_items_20261020(p_otp uuid,p_order uuid) returns uuid[]
language plpgsql security definer set search_path=public,pg_temp as $$
declare meta jsonb; item jsonb; matched uuid; used uuid[]:='{}';
begin
 select r.payload into meta from manager_approval_requests r join kitchen_orders k on k.id=p_order and k.tenant_id=r.tenant_id
 where r.otp_id=p_otp and r.action_code='fnb.discount_override' and r.status in ('authorized','executed') order by r.created_at desc limit 1;
 if meta is null or coalesce(meta->>'discount_scope','bill')<>'items' then return null; end if;
 perform public._validate_fnb_item_discount_20261020(meta);
 for item in select value from jsonb_array_elements(meta->'items') where (value->>'discount_selected')::boolean loop
   matched:=null;
   select k.id into matched from public._fnb_active_kitchen_items_00454 k
   where k.kitchen_order_id=p_order and not k.id=any(used)
     and (nullif(item->>'kitchen_item_id','') is null or k.id=(item->>'kitchen_item_id')::uuid)
     and coalesce(k.note,'')=coalesce(item->>'note','')
     and public._manager_approval_items_00566(jsonb_build_array(to_jsonb(k)),true)=public._manager_approval_items_00566(jsonb_build_array(item),true)
   order by k.id limit 1;
   if matched is null then raise exception 'APPROVAL_ITEMS_CHANGED'; end if;
   used:=array_append(used,matched);
 end loop;
 if cardinality(used)=0 then raise exception 'APPROVAL_ITEMS_SCOPE_INVALID'; end if;
 return used;
end $$;
revoke all on function public._fnb_selected_kitchen_items_20261020(uuid,uuid) from public,anon,authenticated;

create or replace function public._fnb_allocate_invoice_discounts_20261020(p_invoice uuid,p_promotion uuid,p_coupon text,p_promo_amount numeric,p_coupon_amount numeric,p_manual_otp uuid,p_manual_amount numeric,p_order uuid) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare selected_ids uuid[]; source_order uuid; manual_meta jsonb; inv record; line record; promo public.promotions%rowtype; coupon public.coupons%rowtype; rows jsonb:='[]'; row jsonb;
 n integer; j integer; pass integer; weight numeric; amount numeric; assigned numeric; remainder integer;
 gross numeric; cut numeric; remaining numeric; total_gross numeric:=0; total_cut numeric:=0; eligible boolean;
begin
 select * into inv from invoices where id=p_invoice for update;
 if not found or inv.source<>'fnb' then raise exception 'FNB_ALLOCATION_INVOICE_REQUIRED'; end if;
 if exists(select 1 from fnb_invoice_discount_snapshots where invoice_id=p_invoice) then return; end if;
 source_order:=p_order;
 selected_ids:=public._fnb_selected_kitchen_items_20261020(p_manual_otp,source_order);
 if selected_ids is null then perform public._fnb_allocate_invoice_discounts_00457(p_invoice,p_promotion,p_coupon,p_promo_amount,p_coupon_amount); return; end if;
 select payload into manual_meta from manager_approval_requests where otp_id=p_manual_otp and action_code='fnb.discount_override' order by created_at desc limit 1;
 if p_manual_amount is distinct from (manual_meta->>'amount')::numeric then raise exception 'APPROVAL_AMOUNT_CHANGED'; end if;

 if p_promotion is not null then select * into promo from promotions where id=p_promotion and tenant_id=inv.tenant_id; end if;
 if p_coupon is not null then select * into coupon from coupons where upper(code)=upper(p_coupon) and tenant_id=inv.tenant_id; end if;
 for line in select ii.*,pr.category_id,ki.toppings,ki.id as kitchen_item_id,ki.note as kitchen_note from invoice_items ii
 left join fnb_invoice_kitchen_line_sources s on s.invoice_item_id=ii.id
 left join kitchen_order_items ki on ki.id=s.kitchen_order_item_id
 join products pr on pr.id=ii.product_id and pr.tenant_id=inv.tenant_id
 where ii.invoice_id=inv.id order by ii.id for update of ii loop
   gross:=round(line.quantity*(line.unit_price+coalesce((select sum(coalesce((t->>'price')::numeric,0)*coalesce((t->>'quantity')::numeric,0)) from jsonb_array_elements(coalesce(line.toppings,'[]')) t),0)));
   if gross<0 then raise exception 'FNB_ALLOCATION_INVALID_PRICE'; end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('id',line.id,'gross',gross,'discount',0,'note',coalesce(line.note,line.kitchen_note),'manual_discount',0,'manual_eligible',line.kitchen_item_id=any(selected_ids),'vat',line.vat_amount,
     'promotion_eligible',case when p_promotion is null then false else promo.applies_to='all' or (promo.applies_to='product' and line.product_id=any(promo.applies_to_ids)) or (promo.applies_to='category' and line.category_id=any(promo.applies_to_ids)) end,
     'coupon_eligible',case when p_coupon is null then false else coupon.applies_to='all' or (coupon.applies_to='product' and line.product_id=any(coupon.applies_to_ids)) or (coupon.applies_to='category' and line.category_id=any(coupon.applies_to_ids)) end));
   total_gross:=total_gross+gross;
 end loop;
 if total_gross<>round(inv.subtotal) or coalesce(inv.discount_amount,0)<0 or inv.discount_amount>total_gross then raise exception 'FNB_ALLOCATION_TOTAL_MISMATCH'; end if;
 n:=jsonb_array_length(rows);
 -- Approved selected-item reduction first; other benefits retain their scopes.
 for pass in 0..3 loop
   amount:=case pass when 0 then p_manual_amount when 1 then coalesce(p_promo_amount,0) when 2 then coalesce(p_coupon_amount,0) else inv.discount_amount-total_cut end;
   if amount<=0 then continue; end if;
   weight:=0;
   for j in 0..n-1 loop
     row:=rows->j; eligible:=case pass when 0 then coalesce((row->>'manual_eligible')::boolean,false) when 1 then coalesce((row->>'promotion_eligible')::boolean,false) when 2 then coalesce((row->>'coupon_eligible')::boolean,false) else true end;
     if eligible then weight:=weight+(row->>'gross')::numeric-(row->>'discount')::numeric; end if;
   end loop;
   if pass<3 and round(amount)>weight then raise exception 'FNB_DISCOUNT_SCOPES_OVERLAP'; end if;
   amount:=least(round(amount),weight,inv.discount_amount-total_cut);
   if amount<=0 then continue; end if;
   assigned:=0;
   for j in 0..n-1 loop
     row:=rows->j; eligible:=case pass when 0 then coalesce((row->>'manual_eligible')::boolean,false) when 1 then coalesce((row->>'promotion_eligible')::boolean,false) when 2 then coalesce((row->>'coupon_eligible')::boolean,false) else true end;
     if eligible then
       remaining:=(row->>'gross')::numeric-(row->>'discount')::numeric;
       cut:=floor(amount*remaining/weight); assigned:=assigned+cut;
       rows:=jsonb_set(rows,array[j::text,'discount'],to_jsonb((row->>'discount')::numeric+cut));
       if pass=0 then rows:=jsonb_set(rows,array[j::text,'manual_discount'],to_jsonb(cut)); end if;
     end if;
   end loop;
   remainder:=(amount-assigned)::integer;
   for j in 0..n-1 loop
     exit when remainder=0;
     row:=rows->j; eligible:=case pass when 0 then coalesce((row->>'manual_eligible')::boolean,false) when 1 then coalesce((row->>'promotion_eligible')::boolean,false) when 2 then coalesce((row->>'coupon_eligible')::boolean,false) else true end;
     if eligible and (row->>'gross')::numeric>(row->>'discount')::numeric then
       rows:=jsonb_set(rows,array[j::text,'discount'],to_jsonb((row->>'discount')::numeric+1)); remainder:=remainder-1;
       if pass=0 then rows:=jsonb_set(rows,array[j::text,'manual_discount'],to_jsonb((row->>'manual_discount')::numeric+1)); end if;
     end if;
   end loop;
   if remainder<>0 then raise exception 'FNB_ALLOCATION_ROUNDING_MISMATCH'; end if;
   total_cut:=total_cut+amount;
 end loop;
 if total_cut<>inv.discount_amount then raise exception 'FNB_ALLOCATION_DISCOUNT_MISMATCH'; end if;
 for row in select value from jsonb_array_elements(rows) loop
   gross:=(row->>'gross')::numeric; cut:=(row->>'discount')::numeric;
   update invoice_items set fnb_gross_amount=gross,discount=cut,total=gross-cut,
     note=case when (row->>'manual_discount')::numeric>0 then concat_ws(E'\n',nullif(row->>'note',''),'Giảm món: -'||(row->>'manual_discount')||'đ') else row->>'note' end,
     vat_amount=case when gross>0 then round(coalesce((row->>'vat')::numeric,0)*(gross-cut)/gross,2) else 0 end
   where id=(row->>'id')::uuid and invoice_id=inv.id;
 end loop;
 update invoices set tax_amount=(select coalesce(sum(vat_amount),0) from invoice_items where invoice_id=inv.id) where id=inv.id;
 insert into fnb_invoice_discount_snapshots(invoice_id,tenant_id,customer_id,promotion_id,coupon_code,lines,policy_snapshot) values(inv.id,inv.tenant_id,inv.customer_id,p_promotion,p_coupon,rows,jsonb_build_object('promotion',jsonb_strip_nulls(to_jsonb(promo)),'coupon',jsonb_strip_nulls(to_jsonb(coupon)),'branch_id',inv.branch_id,'manual_discount',jsonb_build_object('scope','items','amount',p_manual_amount,'mode',manual_meta->>'discount_mode','value',manual_meta->'discount_value','kitchen_item_ids',to_jsonb(selected_ids))));
end $$;

revoke all on function public._fnb_allocate_invoice_discounts_20261020(uuid,uuid,text,numeric,numeric,uuid,numeric,uuid) from public,anon,authenticated;

do $patch$
declare d text; anchor text; replacement text;
begin
 d:=replace(pg_get_functiondef('public.request_manager_approval_00566(text,jsonb,text)'::regprocedure),E'\r\n',E'\n');
 anchor:='p_meta:=p_meta||jsonb_build_object(''canonical_items'',items);';
 if position('_validate_fnb_item_discount_20261020' in d)=0 then
   if length(d)-length(replace(d,anchor,''))<>length(anchor) then raise exception 'FNB_ITEM_DISCOUNT_REQUEST_SOURCE_CHANGED'; end if;
   execute replace(d,anchor,anchor||' if p_action=''fnb.discount_override'' then p_meta:=public._validate_fnb_item_discount_20261020(p_meta); end if;');
 end if;
 d:=replace(pg_get_functiondef('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure),E'\r\n',E'\n');
 anchor:='perform public._fnb_allocate_invoice_discounts_00457(v_invoice_id,p_promotion_id,v_coupon_code,v_promotion_discount,v_coupon_discount);';
 replacement:='perform public._fnb_allocate_invoice_discounts_20261020(v_invoice_id,p_promotion_id,v_coupon_code,v_promotion_discount,v_coupon_discount,p_manual_discount_otp_id,v_manual_discount,v_order.id);';
 if position('_fnb_allocate_invoice_discounts_20261020' in d)=0 then
   if length(d)-length(replace(d,anchor,''))<>length(anchor) then raise exception 'FNB_ITEM_DISCOUNT_PAYMENT_SOURCE_CHANGED'; end if;
   execute replace(d,anchor,replacement);
 end if;
end $patch$;
notify pgrst,'reload schema';
commit;
