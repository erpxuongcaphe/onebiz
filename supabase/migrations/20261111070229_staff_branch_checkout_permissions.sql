begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- Preserve existing caller-specific scope checks, including company-wide read
-- permissions. A local exception always uses the strict membership resolver.
create function public._staff_permission_at_scope(p_user uuid,p_code text,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.user_branch_permission_overrides o
   where o.user_id=p_user and o.branch_id=p_branch and o.permission_code=p_code)
  then public.user_has_permission_at_branch(p_user,p_code,p_branch)
  else public.user_has_permission(p_user,p_code) end
$$;
revoke all on function public._staff_permission_at_scope(uuid,text,uuid) from public,anon,authenticated;

do $migration$
declare item record; target oid; source text; patched text; branch_expression text; match_count integer;
begin
 for item in select * from (values
  ('_create_sales_return_auth_impl_00244','v_invoice.branch_id'),
  ('_fnb_print_access_v1','p_branch'),
  ('_fnb_resolve_order_recipe_defaults_20261021','order'),
  ('fnb_buyer_lookup_v1','p_branch_id'),
  ('fnb_complete_payment_atomic_v3','payment'),
  ('fnb_complete_payment_timed_v1','payload'),
  ('fnb_open_shift_atomic','p_branch_id'),
  ('fnb_print_enqueue_v1','p_branch'),
  ('fnb_save_order_note_v1','order'),
  ('fnb_select_order_customer_v1','order'),
  ('get_document_payment_history_scoped','v_branch'),
  ('get_fnb_delivery_price_policy','p_branch_id'),
  ('get_open_shift_status_scoped','p_branch_id'),
  ('get_pos_customer_contacts_scoped','p_branch_id'),
  ('get_pos_retail_customer_contacts_identity','p_branch_id'),
  ('get_shift_context_scoped','v_shift.branch_id'),
  ('get_shift_records_scoped','p_branch_id'),
  ('stamp_fnb_cash_actor_v1','new.branch_id'),
  ('stamp_linked_fnb_cash_actor_v1','new.branch_id')
 ) as entries(name,scope) loop
  select count(*),min(p.oid::bigint)::oid into match_count,target from pg_proc p
   where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if match_count<>1 then raise exception 'STAFF_CHECKOUT_CONSUMER_AMBIGUOUS: %',item.name; end if;
  source:=pg_get_functiondef(target);
  branch_expression:=case item.scope
   when 'order' then '(select staff_checkout_scope.branch_id from public.kitchen_orders staff_checkout_scope where staff_checkout_scope.id=p_order_id and staff_checkout_scope.tenant_id=public.get_user_tenant_id())'
   when 'payment' then '(select staff_checkout_scope.branch_id from public.kitchen_orders staff_checkout_scope where staff_checkout_scope.id=p_kitchen_order_id and staff_checkout_scope.tenant_id=public.get_user_tenant_id())'
   when 'payload' then '(select staff_checkout_scope.branch_id from public.kitchen_orders staff_checkout_scope where staff_checkout_scope.id=(p_payload->>''p_kitchen_order_id'')::uuid and staff_checkout_scope.tenant_id=public.get_user_tenant_id())'
   else item.scope end;
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.checkout''\)',
   '_staff_permission_at_scope(\1,''pos_fnb.checkout'','||branch_expression||')','g');
  if patched=source then raise exception 'STAFF_CHECKOUT_CONSUMER_CHANGED: %',item.name; end if;
  execute patched;
 end loop;

 source:=pg_get_functiondef('public.open_shift_operational(uuid,numeric,text)'::regprocedure);
 patched:=replace(source,
  'public.user_has_permission(v_actor,case p_channel when ''fnb'' then ''pos_fnb.checkout'' else ''pos_retail.checkout'' end)',
  '(case p_channel when ''fnb'' then public._staff_permission_at_scope(v_actor,''pos_fnb.checkout'',p_branch_id) else public.user_has_permission(v_actor,''pos_retail.checkout'') end)');
 if patched=source then raise exception 'STAFF_OPEN_SHIFT_CONSUMER_CHANGED'; end if;
 execute patched;

 -- Legacy public payment entry points must also respect checkout revocations.
 -- Their existing branch, actor-spoof, discount and replay guards remain intact.
 -- Before deployment, verify that no active account relies on view_orders alone
 -- to pay through these old endpoints (read-only audit on 11 Nov returned zero).
 for item in select * from (values
  ('public.fnb_complete_payment_atomic(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'),
  ('public.fnb_complete_payment_atomic_v2(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric,uuid,numeric,numeric,text,numeric)')
 ) as entries(signature) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_LEGACY_CHECKOUT_MISSING'; end if;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'(?i)\mbegin\M',E'begin\n if not public.user_has_permission_at_branch(auth.uid(),''pos_fnb.checkout'',(select staff_checkout_scope.branch_id from public.kitchen_orders staff_checkout_scope where staff_checkout_scope.id=p_kitchen_order_id and staff_checkout_scope.tenant_id=public.get_user_tenant_id())) then raise exception ''FNB_CHECKOUT_DENIED'' using errcode=''42501''; end if;','');
  if item.signature like 'public.fnb_complete_payment_atomic(%' then
   -- A branch-only checkout grant must not hit the obsolete view-only guard.
   patched:=replace(patched,'public.user_has_permission(v_actor, ''pos_fnb.view_orders'')',
    'public.user_has_permission_at_branch(v_actor,''pos_fnb.checkout'',(select staff_checkout_scope.branch_id from public.kitchen_orders staff_checkout_scope where staff_checkout_scope.id=p_kitchen_order_id and staff_checkout_scope.tenant_id=public.get_user_tenant_id()))');
  end if;
  if patched=source then raise exception 'STAFF_LEGACY_CHECKOUT_CHANGED'; end if;
  execute patched;
 end loop;
end $migration$;

-- Legacy direct-table grants must not bypass a newly configured local checkout
-- exception. Leave users without local checkout exceptions on existing policies.
-- Normal security-definer business RPCs retain their own operation permissions.
create function public._staff_checkout_write_allowed(p_tenant uuid,p_branch uuid,p_allow_retail boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if p_tenant is distinct from public.get_user_tenant_id() then return false; end if;
 if not exists(select 1 from public.user_branch_permission_overrides o where o.tenant_id=p_tenant
  and o.user_id=auth.uid() and o.permission_code='pos_fnb.checkout') then return true; end if;
 if p_allow_retail and public.user_has_permission(auth.uid(),'pos_retail.checkout') then
  return public.user_has_branch_access(auth.uid(),p_branch); end if;
 return public.user_has_permission_at_branch(auth.uid(),'pos_fnb.checkout',p_branch);
end $$;
create function public._staff_checkout_invoice_write_allowed(p_invoice uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare invoice_scope record;
begin
 select tenant_id,branch_id,source into invoice_scope from public.invoices where id=p_invoice;
 if not found or invoice_scope.tenant_id is distinct from public.get_user_tenant_id() then return false; end if;
 return invoice_scope.source is distinct from 'fnb'
  or public._staff_checkout_write_allowed(invoice_scope.tenant_id,invoice_scope.branch_id);
end $$;
revoke all on function public._staff_checkout_write_allowed(uuid,uuid,boolean) from public,anon;
revoke all on function public._staff_checkout_invoice_write_allowed(uuid) from public,anon;
grant execute on function public._staff_checkout_write_allowed(uuid,uuid,boolean) to authenticated;
grant execute on function public._staff_checkout_invoice_write_allowed(uuid) to authenticated;

do $policies$
declare item record; cmd text;
begin
 for item in select * from (values
  ('invoices','source is distinct from ''fnb'' or public._staff_checkout_write_allowed(tenant_id,branch_id)'),
  ('invoice_items','public._staff_checkout_invoice_write_allowed(invoice_id)'),
  ('cash_transactions','reference_type is distinct from ''invoice'' or public._staff_checkout_invoice_write_allowed(reference_id)'),
  ('shifts','public._staff_checkout_write_allowed(tenant_id,branch_id,true)')
 ) as entries(table_name,predicate) loop
  foreach cmd in array array['INSERT','UPDATE','DELETE'] loop
   execute format('create policy %I on public.%I as restrictive for %s to authenticated %s',
    'staff_checkout_'||lower(cmd),item.table_name,cmd,
    case cmd when 'INSERT' then 'with check ('||item.predicate||')'
     when 'UPDATE' then 'using ('||item.predicate||') with check ('||item.predicate||')'
     else 'using ('||item.predicate||')' end);
  end loop;
 end loop;
end $policies$;

-- Do not enable the catalog entry until the complete isolated checkout and
-- print authorization suite has passed; this migration is under development.
commit;
