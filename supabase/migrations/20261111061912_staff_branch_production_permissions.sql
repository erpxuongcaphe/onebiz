begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- All lifecycle entry points AND their retained implementation guards must
-- agree, otherwise a branch-only grant would fail inside a wrapper.
do $migration$
declare item record; target regprocedure; source text; patched text; expression text;
begin
 for item in select * from (values
  ('public._create_production_order_auth_impl_00390(jsonb)','production.create_order','input'),
  ('public._complete_production_auth_impl_00283(uuid,numeric,text,date,date)','production.complete_order','document'),
  ('public._revert_production_auth_impl_00283(uuid,text)','production.cancel_order','document'),
  ('public.change_production_status_atomic(uuid,text)','production.complete_order','document'),
  ('public.complete_production_atomic(uuid,numeric,text,date,date)','production.complete_order','document'),
  ('public.complete_production_with_uom(uuid,numeric,text,numeric,text,date,date,jsonb)','production.complete_order','document'),
  ('public.complete_production_with_expiry_time(uuid,numeric,text,text,date,numeric,text,numeric,jsonb)','production.complete_order','document'),
  ('public.complete_production_with_date_times(uuid,numeric,text,text,text,numeric,text,numeric,jsonb)','production.complete_order','document'),
  ('public._production_used_adjustment(uuid,timestamp with time zone,numeric,jsonb,text,boolean,uuid,text)','production.correct_order','loaded'),
  ('public.get_fnb_production_stock_health_00476(uuid,uuid[])','production.create_order','reader'),
  ('public.get_fnb_production_stock_health_00476(uuid,uuid[])','production.complete_order','reader')
 ) as entries(signature,code,scope) loop
  target:=to_regprocedure(item.signature);
  if target is null then raise exception 'STAFF_PRODUCTION_CONSUMER_MISSING: %',item.signature; end if;
  source:=pg_get_functiondef(target);
  expression:=case item.scope
   when 'input' then '(nullif(p_input->>''branch_id'','''')::uuid)'
   when 'loaded' then 'po.branch_id'
   when 'reader' then 'p_branch_id'
   else '(select staff_production_scope.branch_id from public.production_orders staff_production_scope where staff_production_scope.id=p_production_order_id and staff_production_scope.tenant_id=public.get_user_tenant_id())' end;
  patched:=regexp_replace(source,
   'user_has_permission\(([^,]+),\s*'''||replace(item.code,'.','\.')||'''\)',
   'user_has_permission_at_branch(\1,'''||item.code||''','||expression||')','g');
  if item.scope='reader' then
   -- This quantity-only reader historically permits reports.view_all_branches.
   -- Preserve that explicit company-wide read when there is no local exception;
   -- a local grant still requires selected branch membership through the resolver.
   patched:=regexp_replace(source,
    '(public\.)?user_has_permission\(([^,]+),\s*'''||replace(item.code,'.','\.')||'''\)',
    '(case when exists(select 1 from public.user_branch_permission_overrides staff_reader_override where staff_reader_override.user_id=\2 and staff_reader_override.branch_id=p_branch_id and staff_reader_override.permission_code='''||item.code||''') then public.user_has_permission_at_branch(\2,'''||item.code||''',p_branch_id) else public.user_has_permission(\2,'''||item.code||''') end)','g');
  end if;
  if patched=source then raise exception 'STAFF_PRODUCTION_CONSUMER_CHANGED: %',item.signature; end if;
  execute patched;
 end loop;

 target:='public.correct_production_order_quantities(uuid,timestamp with time zone,uuid,numeric,jsonb,text,boolean)'::regprocedure;
 source:=pg_get_functiondef(target);
 patched:=replace(source,
  'user_has_permission(actor,case when p_cancel then ''production.cancel_order'' when po.status=''completed'' then ''production.correct_order'' else ''production.create_order'' end)',
  'public.user_has_permission_at_branch(actor,case when p_cancel then ''production.cancel_order'' when po.status=''completed'' then ''production.correct_order'' else ''production.create_order'' end,po.branch_id)');
 if patched=source then raise exception 'STAFF_PRODUCTION_CORRECTION_CONSUMER_CHANGED'; end if;
 execute patched;
end $migration$;

insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values
 ('production.create_order',1),('production.complete_order',1),
 ('production.cancel_order',1),('production.correct_order',1);
commit;
