-- New checkout only: immutable line money for accurate partial refunds.
begin;
set local lock_timeout='3s';
alter table public.invoice_items add column if not exists fnb_gross_amount numeric;
create table if not exists public.fnb_invoice_discount_snapshots (
 invoice_id uuid primary key references public.invoices(id), tenant_id uuid not null,
 customer_id uuid, promotion_id uuid, coupon_code text, lines jsonb not null, policy_snapshot jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.fnb_invoice_discount_snapshots enable row level security;
revoke all on public.fnb_invoice_discount_snapshots from public,anon,authenticated;
create or replace function public._fnb_allocate_invoice_discounts_00457(p_invoice uuid,p_promotion uuid,p_coupon text,p_promo_amount numeric,p_coupon_amount numeric) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare inv record; line record; promo public.promotions%rowtype; coupon public.coupons%rowtype; rows jsonb:='[]'; row jsonb;
 n integer; j integer; pass integer; weight numeric; amount numeric; assigned numeric; remainder integer;
 gross numeric; cut numeric; remaining numeric; total_gross numeric:=0; total_cut numeric:=0; eligible boolean;
begin
 select * into inv from invoices where id=p_invoice for update;
 if not found or inv.source<>'fnb' then raise exception 'FNB_ALLOCATION_INVOICE_REQUIRED'; end if;
 if exists(select 1 from fnb_invoice_discount_snapshots where invoice_id=p_invoice) then return; end if;
 if p_promotion is not null then select * into promo from promotions where id=p_promotion and tenant_id=inv.tenant_id; end if;
 if p_coupon is not null then select * into coupon from coupons where upper(code)=upper(p_coupon) and tenant_id=inv.tenant_id; end if;
 for line in select ii.*,pr.category_id,ki.toppings from invoice_items ii
 left join fnb_invoice_kitchen_line_sources s on s.invoice_item_id=ii.id
 left join kitchen_order_items ki on ki.id=s.kitchen_order_item_id
 join products pr on pr.id=ii.product_id and pr.tenant_id=inv.tenant_id
 where ii.invoice_id=inv.id order by ii.id for update of ii loop
   gross:=round(line.quantity*(line.unit_price+coalesce((select sum(coalesce((t->>'price')::numeric,0)*coalesce((t->>'quantity')::numeric,0)) from jsonb_array_elements(coalesce(line.toppings,'[]')) t),0)));
   if gross<0 then raise exception 'FNB_ALLOCATION_INVALID_PRICE'; end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('id',line.id,'gross',gross,'discount',0,'vat',line.vat_amount,
     'promotion_eligible',case when p_promotion is null then false else promo.applies_to='all' or (promo.applies_to='product' and line.product_id=any(promo.applies_to_ids)) or (promo.applies_to='category' and line.category_id=any(promo.applies_to_ids)) end,
     'coupon_eligible',case when p_coupon is null then false else coupon.applies_to='all' or (coupon.applies_to='product' and line.product_id=any(coupon.applies_to_ids)) or (coupon.applies_to='category' and line.category_id=any(coupon.applies_to_ids)) end));
   total_gross:=total_gross+gross;
 end loop;
 if total_gross<>round(inv.subtotal) or coalesce(inv.discount_amount,0)<0 or inv.discount_amount>total_gross then raise exception 'FNB_ALLOCATION_TOTAL_MISMATCH'; end if;
 n:=jsonb_array_length(rows);
 -- Scoped promotion, then scoped coupon, then remaining bill discount.
 for pass in 1..3 loop
   amount:=case pass when 1 then coalesce(p_promo_amount,0) when 2 then coalesce(p_coupon_amount,0) else inv.discount_amount-total_cut end;
   if amount<=0 then continue; end if;
   weight:=0;
   for j in 0..n-1 loop
     row:=rows->j; eligible:=case pass when 1 then coalesce((row->>'promotion_eligible')::boolean,false) when 2 then coalesce((row->>'coupon_eligible')::boolean,false) else true end;
     if eligible then weight:=weight+(row->>'gross')::numeric-(row->>'discount')::numeric; end if;
   end loop;
   if pass<3 and round(amount)>weight then raise exception 'FNB_DISCOUNT_SCOPES_OVERLAP'; end if;
   amount:=least(round(amount),weight,inv.discount_amount-total_cut);
   if amount<=0 then continue; end if;
   assigned:=0;
   for j in 0..n-1 loop
     row:=rows->j; eligible:=case pass when 1 then coalesce((row->>'promotion_eligible')::boolean,false) when 2 then coalesce((row->>'coupon_eligible')::boolean,false) else true end;
     if eligible then
       remaining:=(row->>'gross')::numeric-(row->>'discount')::numeric;
       cut:=floor(amount*remaining/weight); assigned:=assigned+cut;
       rows:=jsonb_set(rows,array[j::text,'discount'],to_jsonb((row->>'discount')::numeric+cut));
     end if;
   end loop;
   remainder:=(amount-assigned)::integer;
   for j in 0..n-1 loop
     exit when remainder=0;
     row:=rows->j; eligible:=case pass when 1 then coalesce((row->>'promotion_eligible')::boolean,false) when 2 then coalesce((row->>'coupon_eligible')::boolean,false) else true end;
     if eligible and (row->>'gross')::numeric>(row->>'discount')::numeric then
       rows:=jsonb_set(rows,array[j::text,'discount'],to_jsonb((row->>'discount')::numeric+1)); remainder:=remainder-1;
     end if;
   end loop;
   if remainder<>0 then raise exception 'FNB_ALLOCATION_ROUNDING_MISMATCH'; end if;
   total_cut:=total_cut+amount;
 end loop;
 if total_cut<>inv.discount_amount then raise exception 'FNB_ALLOCATION_DISCOUNT_MISMATCH'; end if;
 for row in select value from jsonb_array_elements(rows) loop
   gross:=(row->>'gross')::numeric; cut:=(row->>'discount')::numeric;
   update invoice_items set fnb_gross_amount=gross,discount=cut,total=gross-cut,
     vat_amount=case when gross>0 then round(coalesce((row->>'vat')::numeric,0)*(gross-cut)/gross,2) else 0 end
   where id=(row->>'id')::uuid and invoice_id=inv.id;
 end loop;
 update invoices set tax_amount=(select coalesce(sum(vat_amount),0) from invoice_items where invoice_id=inv.id) where id=inv.id;
 insert into fnb_invoice_discount_snapshots(invoice_id,tenant_id,customer_id,promotion_id,coupon_code,lines,policy_snapshot) values(inv.id,inv.tenant_id,inv.customer_id,p_promotion,p_coupon,rows,jsonb_build_object('promotion',jsonb_strip_nulls(to_jsonb(promo)),'coupon',jsonb_strip_nulls(to_jsonb(coupon)),'branch_id',inv.branch_id));
end $$;
revoke all on function public._fnb_allocate_invoice_discounts_00457(uuid,uuid,text,numeric,numeric) from public,anon,authenticated;
do $patch$
declare target regprocedure:=to_regprocedure('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'); definition text;
anchor text:='  -- The receipt must use the persisted result, not a browser preview that may';
begin
 if target is null then raise exception 'FNB_ALLOCATION_PAYMENT_PREREQUISITE'; end if;
 definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
 if position('_fnb_allocate_invoice_discounts_00457' in definition)>0 then return; end if;
 if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'FNB_ALLOCATION_PAYMENT_SOURCE_CHANGED'; end if;
 execute replace(definition,anchor,'  perform public._fnb_allocate_invoice_discounts_00457(v_invoice_id,p_promotion_id,v_coupon_code,v_promotion_discount,v_coupon_discount);'||E'\n\n'||anchor);
end $patch$;
notify pgrst,'reload schema';
commit;
