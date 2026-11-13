-- The deployed stock card already masks costs, while older schema histories
-- may contain the original unmasked body. Preserve the deployed body; repair
-- only the recognized older body, and fail closed on any unknown variation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $migration$
declare source text; patched text; old_acl text; old_owner oid; old_config text[]; old_security boolean; old_volatility "char";
 declare_anchor constant text := 'v_total integer := 0;';
 permission_anchor constant text := 'perform public.assert_report_access(''inventory.view'', p_branch_id);';
 cost_anchor constant text := '      sm.unit_cost,';
 price_anchor constant text := '      sm.unit_price,';
begin
 select pg_get_functiondef(p.oid),p.proacl::text,p.proowner,p.proconfig,p.prosecdef,p.provolatile
  into source,old_acl,old_owner,old_config,old_security,old_volatility
  from pg_proc p where p.oid='public.get_stock_card_v2(uuid,uuid)'::regprocedure;
 if source is null or not old_security or old_volatility<>'s' or position(permission_anchor in source)=0 then
  raise exception 'STAFF_STOCK_CARD_CONTRACT_CHANGED';end if;
 if position('v_can_view_cost' in source)=0 then
  if (length(source)-length(replace(source,declare_anchor,'')))/length(declare_anchor)<>1
   or (length(source)-length(replace(source,cost_anchor,'')))/length(cost_anchor)<>1
   or (length(source)-length(replace(source,price_anchor,'')))/length(price_anchor)<>1 then
   raise exception 'STAFF_STOCK_CARD_LEGACY_CHANGED';end if;
  patched:=replace(source,declare_anchor,declare_anchor||E'\n  v_can_view_cost boolean;');
  patched:=replace(patched,permission_anchor,permission_anchor||E'\n  v_can_view_cost := public.user_has_permission(auth.uid(), ''products.view_cost'');');
  patched:=replace(patched,cost_anchor,'      case when v_can_view_cost then sm.unit_cost else null end as unit_cost,');
  patched:=replace(patched,price_anchor,'      case when v_can_view_cost then sm.unit_price else null end as unit_price,');
  execute patched;
  source:=pg_get_functiondef('public.get_stock_card_v2(uuid,uuid)'::regprocedure);
 end if;
 if position('public.user_has_permission(auth.uid(), ''products.view_cost'')' in source)=0
  or position('case when v_can_view_cost then sm.unit_cost else null end as unit_cost' in source)=0
  or position('case when v_can_view_cost then sm.unit_price else null end as unit_price' in source)=0 then
  raise exception 'STAFF_STOCK_CARD_COST_MASK_CHANGED';end if;
 if exists(select 1 from pg_proc p where p.oid='public.get_stock_card_v2(uuid,uuid)'::regprocedure
  and (p.proacl::text is distinct from old_acl or p.proowner<>old_owner or p.proconfig is distinct from old_config
   or p.prosecdef is distinct from old_security or p.provolatile is distinct from old_volatility)) then
  raise exception 'STAFF_STOCK_CARD_METADATA_CHANGED';end if;
end $migration$;
commit;
