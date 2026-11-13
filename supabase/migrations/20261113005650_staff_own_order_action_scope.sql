-- Order-only mutations must not expose/process another person's hidden order.
-- Other independently granted access (for example retail checkout) remains.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public._staff_order_target_visible(p_id uuid)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare row_data record;tenant uuid:=public.get_user_tenant_id();
begin
 if public._staff_order_owner_unrestricted() or p_id is null then return true; end if;
 -- The common existing full-access roles keep the original lock order. A
 -- scoped exception must instead be resolved against the persisted branch.
 if (public.user_has_permission(auth.uid(),'invoices.view') and not exists(
   select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant and o.user_id=auth.uid() and o.permission_code='invoices.view'))
  or (public.user_has_permission(auth.uid(),'pos_retail.checkout') and not exists(
   select 1 from public.user_branch_permission_overrides o where o.tenant_id=tenant and o.user_id=auth.uid() and o.permission_code='pos_retail.checkout')) then return true;end if;
 -- Lock before evaluating ownership so a concurrent change cannot invalidate
 -- the decision before the original function performs its own mutation.
 select i.source,i.branch_id,i.created_by into row_data from public.invoices i
  where i.id=p_id and i.tenant_id=tenant for update;
 if not found or row_data.source is distinct from 'order' then return true; end if;
 return coalesce(row_data.created_by=auth.uid(),false)
  or coalesce(row_data.branch_id=any(public._staff_order_independent_branches()),false);
end $$;
revoke all on function public._staff_order_target_visible(uuid) from public,anon,authenticated;
do $patch$
declare item record;source text;patched text;n integer;guard text;permission_check text;
begin
 for item in select * from (values
  ('close_sales_order_processing','p_order_id','orders.create',false),
  ('reopen_sales_order_processing','p_order_id','orders.create',false),
  ('create_child_sale_from_order','p_order_id','orders.create',true),
  ('mark_order_processed','p_order_id','orders.create',false),
  ('save_sales_order_atomic','p_order_id','orders.create',false),
  ('close_sales_orders_processing',null,'orders.create',false),
  ('attach_invoice_shipment_atomic','p_invoice_id','orders.create',true),
  ('update_draft_invoice_atomic','p_invoice_id','orders.create',false),
  ('cancel_draft_invoice_atomic','p_invoice_id','orders.cancel',false),
  ('duplicate_invoice_to_order_atomic','p_source_invoice_id','orders.create',false)
 ) as entries(name,target,permission_code,retail_alternative) loop
  select count(*),min(pg_get_functiondef(p.oid)) into n,source from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=item.name and p.prokind='f' and p.prosecdef;
  if n<>1 then raise exception 'STAFF_OWN_ORDER_ACTION_AMBIGUOUS: %',item.name;end if;
  permission_check:=format('public._staff_permission_any_branch(auth.uid(),%L)',item.permission_code);
  if item.retail_alternative then
   permission_check:='('||permission_check||' or public._staff_permission_any_branch(auth.uid(),''pos_retail.checkout''))';end if;
  if item.name='close_sales_orders_processing' then
   guard:='if not public._staff_order_owner_unrestricted() then if '||permission_check||' and coalesce(cardinality(p_order_ids),0) between 1 and 100 and array_position(p_order_ids,null) is null and p_apply is not null and (not p_apply or length(btrim(coalesce(p_reason,''''))) between 3 and 500) then declare _staff_id uuid; begin for _staff_id in select distinct x from unnest(p_order_ids) x order by x loop if not public._staff_order_target_visible(_staff_id) then raise exception ''STAFF_OWN_ORDER_ACTION_DENIED'' using errcode=''42501''; end if; end loop; end; end if; end if;';
  else
   guard:='if not public._staff_order_owner_unrestricted() then if '||permission_check||' and not public._staff_order_target_visible('||item.target||') then raise exception ''STAFF_OWN_ORDER_ACTION_DENIED'' using errcode=''42501''; end if; end if;';
  end if;
  patched:=regexp_replace(source,E'\\n[[:blank:]]*begin[[:blank:]]*\\r?\\n',E'\nbegin\n '||guard||E'\n','i');
  if patched=source or position('STAFF_OWN_ORDER_ACTION_DENIED' in patched)=0 then
   raise exception 'STAFF_OWN_ORDER_ACTION_CHANGED: %',item.name;end if;
  execute patched;
 end loop;
end $patch$;
commit;
