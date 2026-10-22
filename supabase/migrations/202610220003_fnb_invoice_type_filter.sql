-- Read-only classification by the POS kitchen order, never by Retail shipments.
-- Keep the existing signature, authorization, date/status logic and Retail filters.
do $migration$
declare definition text; anchor text := $anchor$p_delivery IS NULL OR p_delivery = 'all'$anchor$;
begin
 select pg_get_functiondef('public.get_invoice_list_summary(uuid,timestamptz,timestamptz,text[],text,text,text)'::regprocedure) into definition;
 if position('FNB_INVOICE_TYPE_20261022' in definition)>0 then return; end if;
 if position(anchor in definition)=0
    or position('FNB_SALES_SUMMARY_PERMISSION_DENIED' in definition)=0
    or position('KPI_BRANCH_DENIED' in definition)=0 then
   raise exception 'FNB_INVOICE_TYPE_SUMMARY_PREFLIGHT_FAILED';
 end if;
 definition := replace(definition,anchor,anchor || $filter$
        -- FNB_INVOICE_TYPE_20261022: EXISTS avoids multiplying invoice totals.
        OR (p_delivery in ('fnb_dine_in','fnb_takeaway','fnb_delivery')
            AND i.source='fnb' AND EXISTS (
              SELECT 1 FROM public.kitchen_orders ko
              WHERE ko.invoice_id=i.id AND ko.tenant_id=i.tenant_id
                AND ko.branch_id=i.branch_id
                AND ko.order_type=substring(p_delivery from 5)))
$filter$);
 execute definition;
end $migration$;
notify pgrst, 'reload schema';
