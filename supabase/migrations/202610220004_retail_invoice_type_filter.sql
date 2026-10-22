-- Read-only Retail classification. Internal sales take priority over shipments.
-- Preserve the existing RPC signature and all F&B/branch/tenant guards.
do $migration$
declare definition text; anchor text := $anchor$p_delivery IS NULL OR p_delivery = 'all'$anchor$;
begin
 select pg_get_functiondef('public.get_invoice_list_summary(uuid,timestamptz,timestamptz,text[],text,text,text)'::regprocedure) into definition;
 if position('RETAIL_INVOICE_TYPE_20261022' in definition)>0 then return; end if;
 if position(anchor in definition)=0
    or position('FNB_INVOICE_TYPE_20261022' in definition)=0
    or position('FNB_SALES_SUMMARY_PERMISSION_DENIED' in definition)=0
    or position('KPI_BRANCH_DENIED' in definition)=0 then
   raise exception 'RETAIL_INVOICE_TYPE_SUMMARY_PREFLIGHT_FAILED';
 end if;
 definition := replace(definition,anchor,anchor || $filter$
        -- RETAIL_INVOICE_TYPE_20261022: non-overlapping groups; NULL source stays visible.
        OR (p_delivery='retail_internal' AND i.source='internal')
        OR (p_delivery in ('retail_delivery','retail_no_delivery')
            AND i.source IS DISTINCT FROM 'internal' AND i.source IS DISTINCT FROM 'fnb'
            AND (EXISTS (SELECT 1 FROM public.shipping_orders so
                 WHERE so.invoice_id=i.id AND so.tenant_id=i.tenant_id))
                = (p_delivery='retail_delivery'))
$filter$);
 execute definition;
end $migration$;
notify pgrst, 'reload schema';
