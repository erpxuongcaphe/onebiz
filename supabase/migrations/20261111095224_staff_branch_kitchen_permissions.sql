begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
-- Only for tenant-level menu revision metadata and preliminary approval checks.
-- Business operations must still resolve and check their actual document branch.
create function public._staff_permission_any_branch(p_user uuid,p_code text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.user_has_permission(p_user,p_code) or exists(
  select 1 from public.user_branch_permission_overrides o join public.profiles p on p.id=o.user_id and p.tenant_id=o.tenant_id
  where o.user_id=p_user and o.permission_code=p_code and o.override_type='grant'
   and public.user_has_permission_at_branch(p_user,p_code,o.branch_id))
$$;
revoke all on function public._staff_permission_any_branch(uuid,text) from public,anon,authenticated;
do $patch$
declare item record; target oid; n integer; source text; patched text; scope text; anchor text;
begin
 for item in select * from (values
  ('_fnb_print_access_v1','p_branch'),
  ('_fnb_send_to_kitchen_before_branch_price_20261028','send'),
  ('_fnb_send_to_kitchen_impl_00303','send'),
  ('_fnb_send_to_kitchen_impl_before_00377','send'),
  ('_fnb_send_to_kitchen_impl_before_00449','send'),
  ('assign_delivery_staff_to_order','kitchen_order'),
  ('complete_delivery_for_order','kitchen_order'),
  ('fnb_delivery_destination_20261020','order'),
  ('fnb_delivery_dispatch_20261020','p_branch_id'),
  ('fnb_print_enqueue_v1','p_branch'),
  ('fnb_save_order_note_v1','order'),
  ('fnb_select_order_customer_v1','order'),
  ('fnb_set_delivery_pricing_v2','kitchen_order'),
  ('get_fnb_delivery_price_policy','p_branch_id'),
  ('get_fnb_pos_menu_layout','p_branch_id'),
  ('list_fnb_delivery_staff_20261027','p_branch_id'),
  ('list_pos_pin_users','p_branch_id'),
  ('verify_pos_pin','p_branch_id')
 ) as entries(name,branch_expression) loop
  select count(*),min(p.oid::bigint)::oid into n,target from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=item.name;
  if n<>1 then raise exception 'STAFF_KITCHEN_CONSUMER_AMBIGUOUS: %',item.name;end if;
  scope:=case item.branch_expression
   when 'send' then '(case when p_existing_order_id is null then p_branch_id else (select staff_kitchen_scope.branch_id from public.kitchen_orders staff_kitchen_scope where staff_kitchen_scope.id=p_existing_order_id and staff_kitchen_scope.tenant_id=public.get_user_tenant_id()) end)'
   when 'order' then '(select staff_kitchen_scope.branch_id from public.kitchen_orders staff_kitchen_scope where staff_kitchen_scope.id=p_order_id and staff_kitchen_scope.tenant_id=public.get_user_tenant_id())'
   when 'kitchen_order' then '(select staff_kitchen_scope.branch_id from public.kitchen_orders staff_kitchen_scope where staff_kitchen_scope.id=p_kitchen_order_id and staff_kitchen_scope.tenant_id=public.get_user_tenant_id())'
   else item.branch_expression end;
  source:=pg_get_functiondef(target);
  patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''(pos_fnb\.(send_kitchen|edit_price))''\)',
   '_staff_permission_at_scope(\1,''\2'','||scope||')','g');
  if patched=source then raise exception 'STAFF_KITCHEN_CONSUMER_CHANGED: %',item.name;end if;
  execute patched;
 end loop;
 source:=pg_get_functiondef('public.get_fnb_menu_order_revision()'::regprocedure);
 patched:=regexp_replace(source,'user_has_permission\(([^,]+),\s*''pos_fnb\.send_kitchen''\)',
  '_staff_permission_any_branch(\1,''pos_fnb.send_kitchen'')','g');
 if patched=source then raise exception 'STAFF_MENU_REVISION_CONSUMER_CHANGED';end if;execute patched;

 -- Resolve the persisted approval branch before the final check. A branch-only
 -- grant may pass the preliminary check but never authorizes a different branch.
 source:=pg_get_functiondef('public.request_manager_approval_00566(text,jsonb,text)'::regprocedure);
 patched:=replace(replace(source,'user_has_permission(a,view_perm)','public._staff_permission_any_branch(a,view_perm)'),
  'user_has_permission(a,required)','public._staff_permission_any_branch(a,required)');
 anchor:='perform pg_advisory_xact_lock(hashtextextended(a::text||p_action,565));';
 if patched=source or position(anchor in source)=0 then raise exception 'STAFF_APPROVAL_CONSUMER_CHANGED';end if;
 patched:=replace(patched,anchor,
  'if not coalesce(public._staff_permission_at_scope(a,view_perm,b),false) and not coalesce(public._staff_permission_at_scope(a,required,b),false) then raise exception ''APPROVAL_PERMISSION_DENIED'' using errcode=''42501'';end if; '||anchor);
 execute patched;
end $patch$;
insert into public.staff_branch_permission_catalog values('pos_fnb.send_kitchen',1),('pos_fnb.edit_price',1);
commit;
