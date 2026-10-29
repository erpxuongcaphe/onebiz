-- Split sold/returned SKU rows by variant as well as unit. Only report projection changes.
-- Patch the installed body so later permission and customer-identity upgrades are preserved.
begin;
do $migration$
declare
  v_definition text := replace(pg_get_functiondef('public.get_sku_financial_report(timestamptz,timestamptz,uuid,uuid)'::regprocedure), E'\r\n', E'\n');
begin
  if position('sku_report_variants_20261029' in v_definition)>0 then return; end if;
  if (length(v_definition)-length(replace(v_definition,$old$select ii.product_id, coalesce$old$,'')))/length($old$select ii.product_id, coalesce$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 1';
  end if;
  v_definition := replace(v_definition,$old$select ii.product_id, coalesce$old$,$new$select ii.product_id, ii.variant_id, coalesce$new$);
  if (length(v_definition)-length(replace(v_definition,$old$select ri.product_id, coalesce$old$,'')))/length($old$select ri.product_id, coalesce$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 2';
  end if;
  v_definition := replace(v_definition,$old$select ri.product_id, coalesce$old$,$new$select ri.product_id, original_line.variant_id, coalesce$new$);
  if (length(v_definition)-length(replace(v_definition,$old$left join lateral public.resolve_sales_return_source_line(ri.id) source on true$old$,'')))/length($old$left join lateral public.resolve_sales_return_source_line(ri.id) source on true$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 3';
  end if;
  v_definition := replace(v_definition,$old$left join lateral public.resolve_sales_return_source_line(ri.id) source on true$old$,$new$left join lateral public.resolve_sales_return_source_line(ri.id) source on true
      left join public.invoice_items original_line on original_line.id=source.invoice_item_id
        and original_line.invoice_id=i.id and original_line.product_id=ri.product_id$new$);
  if (length(v_definition)-length(replace(v_definition,$old$select product_id,unit,customer_id,invoice_id,sold_qty$old$,'')))/length($old$select product_id,unit,customer_id,invoice_id,sold_qty$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 4';
  end if;
  v_definition := replace(v_definition,$old$select product_id,unit,customer_id,invoice_id,sold_qty$old$,$new$select product_id,variant_id,unit,customer_id,invoice_id,sold_qty$new$);
  if (length(v_definition)-length(replace(v_definition,$old$select product_id,unit,customer_id,null::uuid$old$,'')))/length($old$select product_id,unit,customer_id,null::uuid$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 5';
  end if;
  v_definition := replace(v_definition,$old$select product_id,unit,customer_id,null::uuid$old$,$new$select product_id,variant_id,unit,customer_id,null::uuid$new$);
  if (length(v_definition)-length(replace(v_definition,$old$select a.product_id,p.code,p.name,coalesce(cat.name,'Chưa phân loại') category_name,a.unit,$old$,'')))/length($old$select a.product_id,p.code,p.name,coalesce(cat.name,'Chưa phân loại') category_name,a.unit,$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 6';
  end if;
  v_definition := replace(v_definition,$old$select a.product_id,p.code,p.name,coalesce(cat.name,'Chưa phân loại') category_name,a.unit,$old$,$new$select a.product_id,a.variant_id,
        case when a.variant_id is not null then coalesce(nullif(btrim(v.name),''),'Quy cách không còn trong danh mục') end variant_name,
        p.code,p.name || case when a.variant_id is null then '' else
          ' · ' || coalesce(nullif(btrim(v.name),''),'Quy cách không còn trong danh mục') end name,
        coalesce(cat.name,'Chưa phân loại') category_name,a.unit,$new$);
  if (length(v_definition)-length(replace(v_definition,$old$left join public.categories cat on cat.id=p.category_id and cat.tenant_id=v_tenant$old$,'')))/length($old$left join public.categories cat on cat.id=p.category_id and cat.tenant_id=v_tenant$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 7';
  end if;
  v_definition := replace(v_definition,$old$left join public.categories cat on cat.id=p.category_id and cat.tenant_id=v_tenant$old$,$new$left join public.categories cat on cat.id=p.category_id and cat.tenant_id=v_tenant
      left join public.product_variants v on v.id=a.variant_id and v.product_id=a.product_id and v.tenant_id=v_tenant$new$);
  if (length(v_definition)-length(replace(v_definition,$old$group by a.product_id,p.code,p.name,cat.name,a.unit$old$,'')))/length($old$group by a.product_id,p.code,p.name,cat.name,a.unit$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 8';
  end if;
  v_definition := replace(v_definition,$old$group by a.product_id,p.code,p.name,cat.name,a.unit$old$,$new$group by a.product_id,a.variant_id,v.name,p.code,p.name,cat.name,a.unit$new$);
  if (length(v_definition)-length(replace(v_definition,$old$order by g.code,g.unit$old$,'')))/length($old$order by g.code,g.unit$old$)<>1 then
    raise exception 'SKU report variant migration: unexpected anchor 9';
  end if;
  v_definition := replace(v_definition,$old$order by g.code,g.unit$old$,$new$order by g.code,g.variant_name,g.variant_id,g.unit$new$);
  v_definition := replace(v_definition,'with sales as (','with sales as ( -- sku_report_variants_20261029');
  execute v_definition;
end $migration$;
notify pgrst,'reload schema';
commit;
