-- Owner-confirmed wholesale-only identifiers: WS codes and FECA product names.
-- Keep Retail, existing documents and stock unchanged. Preserve live RPC bodies.
begin;
set local lock_timeout='2s';
do $patch$
declare definition text; anchor text;
begin
  select pg_get_functiondef('public.get_fnb_warehouse_order_context(uuid,text)'::regprocedure) into definition;
  if strpos(definition,'FNB_WHOLESALE_CATALOG_BOUNDARY')=0 then
    anchor := 'and public.catalog_search_rank(p.name,p.code,p.barcode,p_search) is not null';
    if strpos(definition,anchor)=0 then raise exception 'Unexpected warehouse catalogue definition; review before installing.'; end if;
    execute replace(definition,anchor,$replacement$and p.code not ilike 'WS%' and p.name not ilike 'WS%' and p.name not ilike 'FECA%' -- FNB_WHOLESALE_CATALOG_BOUNDARY
 and public.catalog_search_rank(p.name,p.code,p.barcode,p_search) is not null$replacement$);
  end if;
  select pg_get_functiondef('public.submit_fnb_warehouse_order(uuid,uuid,uuid,jsonb,text)'::regprocedure) into definition;
  if strpos(definition,'FNB_WHOLESALE_CATALOG_BOUNDARY')=0 then
    anchor := 'and coalesce(is_fnb_stock_item,false)=false for share;';
    if strpos(definition,anchor)=0 then raise exception 'Unexpected warehouse submit definition; review before installing.'; end if;
    execute replace(definition,anchor,$replacement$and coalesce(is_fnb_stock_item,false)=false
 and code not ilike 'WS%' and name not ilike 'WS%' and name not ilike 'FECA%' -- FNB_WHOLESALE_CATALOG_BOUNDARY
 for share;$replacement$);
  end if;
end;
$patch$;
commit;
