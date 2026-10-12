-- Preserve the former integer capacity when adding 12 per-unit decimal places.
-- Repeat the scope/ACL/trigger-preserving alteration; no business row changes.
begin;
set local lock_timeout='5s';
do $precision$ declare v record;a record;begin
 create temporary table _gram_views_00518 on commit drop as
 select c.oid,c.relname,pg_get_viewdef(c.oid,true) definition,c.reloptions,c.relacl,c.relowner
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v' and c.relname in
 ('products_scoped','production_orders_scoped','production_order_materials_scoped','stock_movements_scoped');
 create temporary table _gram_triggers_00518 on commit drop as
 select c.relname table_name,t.tgname,pg_get_triggerdef(t.oid) definition,t.tgenabled
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal and c.relname in
 ('products','stock_movements','production_orders','fnb_branch_product_cost_balances','fnb_branch_product_cost_events','fnb_sale_cost_shortfalls_00473');
 for v in select * from _gram_views_00518 loop execute format('drop view public.%I',v.relname);end loop;
 for v in select * from _gram_triggers_00518 loop execute format('drop trigger %I on public.%I',v.tgname,v.table_name);end loop;
 alter table public.products alter column cost_price type numeric(30,12),alter column sell_price type numeric(30,12);
 alter table public.stock_movements alter column unit_cost type numeric(30,12),alter column unit_price type numeric(30,12);
 alter table public.fnb_branch_product_cost_balances alter column unit_cost type numeric(30,12);
 alter table public.fnb_branch_product_cost_events alter column unit_cost type numeric(30,12);
 alter table public.fnb_sale_cost_shortfalls_00473 alter column estimated_unit_cost type numeric(30,12);
 alter table public.production_orders alter column planned_qty type numeric(20,4),alter column completed_qty type numeric(20,4);
 for v in select * from _gram_triggers_00518 loop
  execute v.definition;
  if v.tgenabled<>'O' then execute format('alter table public.%I %s trigger %I',v.table_name,
   case v.tgenabled when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' end,v.tgname);end if;
 end loop;
 for v in select * from _gram_views_00518 loop
  execute format('create view public.%I %s as %s',v.relname,
   case when v.reloptions is null then '' else 'with ('||array_to_string(v.reloptions,',')||')' end,v.definition);
  execute format('alter view public.%I owner to %I',v.relname,pg_get_userbyid(v.relowner));
  for a in select * from aclexplode(coalesce(v.relacl,acldefault('r',v.relowner))) loop
   execute format('grant %s on public.%I to %s %s',a.privilege_type,v.relname,
    case when a.grantee=0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
    case when a.is_grantable then 'with grant option' else '' end);
  end loop;
 end loop;
end;$precision$;
commit;
notify pgrst,'reload schema';
