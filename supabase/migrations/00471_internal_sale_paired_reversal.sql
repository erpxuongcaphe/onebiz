-- Completed internal sales must be reversed as a pair, using actual movements.
begin;
alter function public.cancel_internal_sale_atomic(uuid,text) rename to _cancel_internal_sale_draft_00471;
revoke all on function public._cancel_internal_sale_draft_00471(uuid,text) from public,anon,authenticated;
create function public.cancel_internal_sale_atomic(p_internal_sale_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_actor uuid:=auth.uid(); v_tenant uuid; v_sale record; v_move record; v_cash record;
 v_cost record; v_balance record; v_restore_cost numeric; v_new_move uuid; v_source_paid numeric; v_dest_paid numeric; v_count integer:=0;
begin
 select tenant_id into v_tenant from profiles where id=v_actor and is_active;
 if v_tenant is null or not user_has_permission(v_actor,'inventory.internal_export') then raise exception 'INTERNAL_SALE_CANCEL_DENIED' using errcode='42501'; end if;
 select * into v_sale from internal_sales where id=p_internal_sale_id and tenant_id=v_tenant for update;
 if not found then raise exception 'INTERNAL_SALE_NOT_FOUND'; end if;
 if not user_has_branch_access(v_actor,v_sale.from_branch_id) or not user_has_branch_access(v_actor,v_sale.to_branch_id) then raise exception 'INTERNAL_SALE_BRANCH_DENIED'; end if;
 if v_sale.status<>'completed' then return _cancel_internal_sale_draft_00471(p_internal_sale_id,p_reason); end if;
 if not user_has_permission(v_actor,'pos_retail.void') then raise exception 'INTERNAL_SALE_COMPLETED_CANCEL_DENIED' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'INTERNAL_SALE_CANCEL_REASON_REQUIRED'; end if;
 perform 1 from invoices where id=v_sale.invoice_id and tenant_id=v_tenant and status='completed' for update;
 if not found then raise exception 'INTERNAL_SALE_DOCUMENT_STATE_CHANGED'; end if;
 perform 1 from input_invoices where id=v_sale.input_invoice_id and tenant_id=v_tenant and status='recorded' for update;
 if not found then raise exception 'INTERNAL_SALE_DOCUMENT_STATE_CHANGED'; end if;
 if exists(select 1 from sales_returns where invoice_id=v_sale.invoice_id and status<>'cancelled') then raise exception 'INTERNAL_SALE_ALREADY_RETURNED'; end if;
 if not exists(select 1 from stock_movements where tenant_id=v_tenant and branch_id=v_sale.from_branch_id and reference_id=v_sale.invoice_id and type='out')
  or not exists(select 1 from stock_movements where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and reference_id=v_sale.input_invoice_id and type='in') then
  raise exception 'INTERNAL_SALE_STOCK_PAIR_REVIEW_REQUIRED'; end if;
 perform 1 from products where id in(select product_id from stock_movements where tenant_id=v_tenant and reference_id in(v_sale.invoice_id,v_sale.input_invoice_id)) order by id for update;
 -- The destination must still physically hold every quantity being returned.
 for v_move in select product_id,sum(quantity) quantity from stock_movements
  where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and reference_id=v_sale.input_invoice_id and type='in' group by product_id loop
  perform 1 from branch_stock where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and product_id=v_move.product_id and variant_id is null and quantity>=v_move.quantity for update;
  if not found then raise exception 'INTERNAL_SALE_RETURN_STOCK_INSUFFICIENT'; end if;
 end loop;
 select coalesce(sum(amount),0) into v_source_paid from cash_transactions where tenant_id=v_tenant and branch_id=v_sale.from_branch_id and reference_type='invoice' and reference_id=v_sale.invoice_id and type='receipt';
 select coalesce(sum(amount),0) into v_dest_paid from cash_transactions where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and reference_type='input_invoice' and reference_id=v_sale.input_invoice_id and type='payment';
 if v_source_paid<>v_dest_paid or v_source_paid<>(select paid from invoices where id=v_sale.invoice_id) then raise exception 'INTERNAL_SALE_PAYMENT_PAIR_REVIEW_REQUIRED'; end if;
 for v_move in select * from stock_movements where tenant_id=v_tenant and
  ((branch_id=v_sale.from_branch_id and reference_id=v_sale.invoice_id and type='out') or
   (branch_id=v_sale.to_branch_id and reference_id=v_sale.input_invoice_id and type='in')) order by branch_id,product_id,id loop
  insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
   values(v_tenant,v_move.branch_id,v_move.product_id,case when v_move.type='out' then 'in' else 'out' end,
    v_move.quantity,'internal_sale_cancel',v_sale.id,p_reason,v_actor) returning id into v_new_move;
  if v_move.type='out' then
   select sum(total_cost)/nullif(sum(quantity),0) unit_cost into v_cost from fnb_branch_product_cost_events
    where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id and direction='out'
      and (source_stock_movement_id=v_move.id or source_reference_id=v_sale.invoice_id);
   if v_cost.unit_cost is not null then perform _post_fnb_branch_cost_in_00390(v_tenant,v_move.branch_id,v_move.product_id,v_move.quantity,v_cost.unit_cost,
    'invoice_void_restore','internal_sale_cancel',v_sale.id,v_new_move,p_reason,v_actor); end if;
  elsif exists(select 1 from fnb_branch_product_cost_events where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id and source_type='internal_sale_receipt' and source_reference_id=v_sale.id) then
   -- Undo the receipt's original cost, not today's weighted average.
   select sum(total_cost)/nullif(sum(quantity),0) unit_cost into v_cost from fnb_branch_product_cost_events
    where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id and direction='in'
     and source_type='internal_sale_receipt' and source_reference_id=v_sale.id;
   v_restore_cost:=round(v_move.quantity*v_cost.unit_cost,4);
   select * into v_balance from fnb_branch_product_cost_balances where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id for update;
   if not found or v_balance.costed_quantity<v_move.quantity or v_balance.total_cost<v_restore_cost then raise exception 'INTERNAL_SALE_RETURN_COST_REVIEW_REQUIRED'; end if;
   update fnb_branch_product_cost_balances set costed_quantity=costed_quantity-v_move.quantity,total_cost=round(total_cost-v_restore_cost,4),
    unit_cost=case when costed_quantity-v_move.quantity<=0.0001 then 0 else round((total_cost-v_restore_cost)/(costed_quantity-v_move.quantity),6) end,
    updated_at=now(),updated_by=v_actor where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id;
   insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
    values(v_tenant,v_move.branch_id,v_move.product_id,'out','invoice_void_restore','internal_sale_cancel',v_sale.id,v_new_move,v_move.quantity,v_cost.unit_cost,v_restore_cost,p_reason,v_actor);
  end if;
  perform increment_product_stock(v_move.product_id,case when v_move.type='out' then v_move.quantity else -v_move.quantity end);
  perform upsert_branch_stock(v_tenant,v_move.branch_id,v_move.product_id,case when v_move.type='out' then v_move.quantity else -v_move.quantity end);
  perform _reconcile_product_lots_to_branch_00284(v_tenant,v_move.branch_id,v_move.product_id,'internal_sale_cancel',v_sale.id,v_actor,p_reason);
  v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'INTERNAL_SALE_STOCK_PAIR_REVIEW_REQUIRED'; end if;
 for v_cash in select branch_id,payment_method,type,sum(amount) amount from cash_transactions where tenant_id=v_tenant and
  ((branch_id=v_sale.from_branch_id and reference_type='invoice' and reference_id=v_sale.invoice_id and type='receipt') or
   (branch_id=v_sale.to_branch_id and reference_type='input_invoice' and reference_id=v_sale.input_invoice_id and type='payment')) group by branch_id,payment_method,type loop
  insert into cash_transactions(tenant_id,branch_id,code,type,category,amount,payment_method,reference_type,reference_id,note,created_by)
   values(v_tenant,v_cash.branch_id,next_cash_code(v_tenant,case when v_cash.type='receipt' then 'payment' else 'receipt' end),
    case when v_cash.type='receipt' then 'payment' else 'receipt' end,'Hoan giao dich noi bo',v_cash.amount,v_cash.payment_method,'internal_sale_cancel',v_sale.id,p_reason,v_actor);
 end loop;
 update internal_sales set status='cancelled',note=concat_ws(E'\n',note,'[ĐÃ HỦY] '||trim(p_reason)),updated_at=now() where id=v_sale.id;
 update input_invoices set status='cancelled' where id=v_sale.input_invoice_id;
 update invoices set status='cancelled',paid=0,debt=0 where id=v_sale.invoice_id;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data) values(v_tenant,v_actor,'internal_sale_cancelled','internal_sale',v_sale.id,
  jsonb_build_object('status','completed'),jsonb_build_object('status','cancelled','reason',p_reason,'paired',true,'stock_movements',v_count,'refunded',v_source_paid));
 return jsonb_build_object('id',v_sale.id,'status','cancelled','stock_changed',true,'reversed_stock_movements',v_count,'reversed_cash',v_source_paid);
end; $$;
revoke all on function public.cancel_internal_sale_atomic(uuid,text) from public,anon;
grant execute on function public.cancel_internal_sale_atomic(uuid,text) to authenticated;

create function public.guard_internal_document_reversal_00471() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='sales_returns' then
  if exists(select 1 from invoices where id=new.invoice_id and source='internal') then raise exception 'INTERNAL_SALE_USE_PAIRED_REVERSAL'; end if;
 elsif tg_table_name='input_invoices' then
  if new.status='cancelled' and old.status<>'cancelled' and exists(select 1 from internal_sales where input_invoice_id=new.id and status<>'cancelled') then
   raise exception 'INTERNAL_SALE_USE_PAIRED_REVERSAL'; end if;
 elsif old.source='internal' and new.status='cancelled' and old.status<>'cancelled' then
  if not exists(select 1 from internal_sales s join input_invoices ii on ii.id=s.input_invoice_id
   where s.invoice_id=new.id and s.status='cancelled' and ii.status='cancelled') then raise exception 'INTERNAL_SALE_USE_PAIRED_REVERSAL'; end if;
 end if;
 return new;
end; $$;
create trigger guard_internal_invoice_reversal before update of status on invoices for each row execute function guard_internal_document_reversal_00471();
create trigger guard_internal_sales_return before insert or update of invoice_id,status on sales_returns for each row execute function guard_internal_document_reversal_00471();
create trigger guard_internal_input_reversal before update of status on input_invoices for each row execute function guard_internal_document_reversal_00471();
commit;
notify pgrst,'reload schema';
