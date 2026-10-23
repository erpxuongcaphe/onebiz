-- Read-only item-level filters. No stock/payment/document writes.
begin;
set local lock_timeout='3s';
create or replace function public.fnb_choice_key_20261023(text) returns text
language sql immutable strict set search_path=public as $$select 'g_'||encode(convert_to($1,'UTF8'),'hex')$$;
revoke all on function public.fnb_choice_key_20261023(text) from public,anon;
grant execute on function public.fnb_choice_key_20261023(text) to authenticated;
create or replace function public.fnb_choice_values_20261023(jsonb) returns jsonb
language sql immutable set search_path=public as $$
 select coalesce(jsonb_object_agg(public.fnb_choice_key_20261023(g->>'groupName'),
  case when jsonb_array_length(g->'options')=0 then '["__empty__"]'::jsonb
  else coalesce((select jsonb_agg(o->>'label') from jsonb_array_elements(g->'options') o where jsonb_typeof(o->'label')='string'),'[]'::jsonb) end),'{}'::jsonb)
 from jsonb_array_elements(case when jsonb_typeof($1)='array' then $1 else '[]'::jsonb end) g
 where jsonb_typeof(g->'groupName')='string' and jsonb_typeof(g->'options')='array';
$$;
revoke all on function public.fnb_choice_values_20261023(jsonb) from public,anon;
grant execute on function public.fnb_choice_values_20261023(jsonb) to authenticated;
-- Private projection; access is only through scoped computed relationship/catalog.
create or replace view public.fnb_invoice_choice_rows_20261023 with(security_invoker=true) as
 select ii.id,ii.invoice_id,ii.product_id,
 coalesce(nullif(btrim(case when snap.invoice_item_id is not null then snap.variant_label else ki.variant_label end),''),
 substring(ii.product_name from '\((Size [^()]+|Nóng Nhỏ)\)$'),'__missing__') as size,
 public.fnb_choice_values_20261023(case when snap.invoice_item_id is not null then snap.modifier_selections else ki.modifier_selections end) as choices
 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id and i.source='fnb'
 left join public.fnb_invoice_item_options_20261023 snap on snap.invoice_item_id=ii.id and snap.tenant_id=i.tenant_id and snap.branch_id=i.branch_id
 left join public.fnb_invoice_kitchen_line_sources s on s.invoice_item_id=ii.id
 left join public.kitchen_order_items ki on ki.id=s.kitchen_order_item_id and ki.product_id=ii.product_id
  and exists(select 1 from public.kitchen_orders k where k.id=ki.kitchen_order_id and k.invoice_id=i.id and k.tenant_id=i.tenant_id and k.branch_id=i.branch_id);
revoke all on public.fnb_invoice_choice_rows_20261023 from public,anon,authenticated;
create or replace function public.fnb_invoice_option_items_20261023(public.invoices)
returns setof public.fnb_invoice_choice_rows_20261023 language plpgsql stable security definer
set search_path=public,pg_temp rows 1000 as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id();
begin
 if actor is null or tenant is null or ($1).tenant_id is distinct from tenant or ($1).source is distinct from 'fnb' or ($1).deleted_at is not null then return;end if;
 if not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=tenant and coalesce(p.is_active,true)) then return;end if;
 if not exists(select 1 from public.invoices i where i.id=($1).id and i.tenant_id=tenant and i.branch_id=($1).branch_id and i.source='fnb' and i.deleted_at is null) then return;end if;
 if not coalesce((public.user_has_permission(actor,'invoices.view') or public.user_has_permission(actor,'pos_fnb.view_orders') or public.user_has_permission(actor,'orders.view') or public.user_has_permission(actor,'inventory.view')),false) then return;end if;
 if not coalesce((public.user_has_permission(actor,'reports.view_all_branches') or public.user_has_branch_access(actor,($1).branch_id)),false) then return;end if;
 return query select r.* from public.fnb_invoice_choice_rows_20261023 r where r.invoice_id=($1).id;
end $$;
revoke all on function public.fnb_invoice_option_items_20261023(public.invoices) from public,anon;
grant execute on function public.fnb_invoice_option_items_20261023(public.invoices) to authenticated;
create or replace function public.fnb_item_matches_choices_20261023(p_size text,p_choices jsonb,p_filter jsonb)
returns boolean language sql immutable set search_path=public as $$
 select (not coalesce(p_filter?'size',false) or p_size=p_filter->>'size') and
 not exists(select 1 from jsonb_each_text(coalesce(p_filter->'groups','{}'::jsonb)) f where
 case when f.value='__missing__' then coalesce(p_choices,'{}'::jsonb)?f.key
 else not coalesce((p_choices->f.key) @> jsonb_build_array(f.value),false) end);
$$;
revoke all on function public.fnb_item_matches_choices_20261023(text,jsonb,jsonb) from public,anon;
grant execute on function public.fnb_item_matches_choices_20261023(text,jsonb,jsonb) to authenticated;
create or replace function public.get_fnb_invoice_choice_catalog_20261023(p_branch_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();tenant uuid:=public.get_user_tenant_id();all_branches boolean;
begin
 if actor is null or tenant is null or not exists(select 1 from public.profiles p where p.id=actor and p.tenant_id=tenant and coalesce(p.is_active,true)) then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if not coalesce((public.user_has_permission(actor,'invoices.view') or public.user_has_permission(actor,'pos_fnb.view_orders') or public.user_has_permission(actor,'orders.view') or public.user_has_permission(actor,'inventory.view')),false) then raise exception 'INVOICE_VIEW_REQUIRED' using errcode='42501';end if;
 all_branches:=public.user_has_permission(actor,'reports.view_all_branches');
 if p_branch_id is not null and (not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=tenant) or not(all_branches or public.user_has_branch_access(actor,p_branch_id))) then raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501';end if;
 return (with scoped as materialized(select r.* from public.fnb_invoice_choice_rows_20261023 r join public.invoices i on i.id=r.invoice_id
 where i.tenant_id=tenant and i.deleted_at is null and (p_branch_id is null or i.branch_id=p_branch_id) and (all_branches or public.user_has_branch_access(actor,i.branch_id))),
 grouped as(select c.key,jsonb_agg(distinct v.value order by v.value) as values from scoped r cross join lateral jsonb_each(r.choices) c cross join lateral jsonb_array_elements_text(c.value) v group by c.key)
 select jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('id',product_id,'name',name) order by name) from(select r.product_id,min(ii.product_name) as name from scoped r join invoice_items ii on ii.id=r.id group by r.product_id) p),'[]'::jsonb),'sizes',coalesce((select jsonb_agg(size order by size) from(select distinct size from scoped where size<>'__missing__') s),'[]'::jsonb),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('key',key,'name',convert_from(decode(substring(key from 3),'hex'),'UTF8'),'values',values) order by key) from grouped),'[]'::jsonb)));
end $$;
revoke all on function public.get_fnb_invoice_choice_catalog_20261023(uuid) from public,anon;
grant execute on function public.get_fnb_invoice_choice_catalog_20261023(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.get_invoice_list_summary_fnb_choices_20261023(p_branch_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to_exclusive timestamp with time zone DEFAULT NULL::timestamp with time zone, p_statuses text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_field text DEFAULT 'all'::text, p_delivery text DEFAULT 'all'::text, p_table text DEFAULT NULL::text, p_area text DEFAULT NULL::text, p_options jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(tat_ca_hoa_don bigint, hoan_thanh bigint, da_huy bigint, gia_tri_hoan_thanh numeric, giam_gia_ap_dung numeric, so_dong_theo_bo_loc bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  -- ISSUED_AT_00335
  -- CHUNG_TU_BAN_00342
  v_actor        uuid := auth.uid();
  v_tenant       uuid;
  v_xem_toan_bo  boolean;
  v_statuses     text[];
  v_search       text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_AUTH_REQUIRED';
  END IF;

  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_TENANT_UNKNOWN';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor
      AND p.tenant_id = v_tenant
      AND coalesce(p.is_active, true)
  ) THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'KPI_PROFILE_INACTIVE';
  END IF;

  v_xem_toan_bo :=
       public.user_has_permission(v_actor, 'reports.view_all_branches');

  IF p_branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = p_branch_id AND b.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'KPI_BRANCH_NOT_IN_TENANT';
    END IF;

    IF NOT v_xem_toan_bo
       AND NOT public.user_has_branch_access(v_actor, p_branch_id) THEN
      RAISE EXCEPTION USING errcode = '42501', message = 'KPI_BRANCH_DENIED';
    END IF;
  END IF;


  IF NOT public.user_has_permission(v_actor,'pos_fnb.view_sales_summary')
   AND EXISTS (SELECT 1 FROM public.branches b WHERE b.tenant_id=v_tenant AND b.branch_type='store'
    AND (p_branch_id IS NULL OR b.id=p_branch_id)
    AND (v_xem_toan_bo OR public.user_has_branch_access(v_actor,b.id))) THEN
   RAISE EXCEPTION USING errcode='42501', message='FNB_SALES_SUMMARY_PERMISSION_DENIED';
  END IF;
  v_statuses := CASE
    WHEN p_statuses IS NULL OR cardinality(p_statuses) = 0 THEN NULL
    ELSE (
      SELECT array_agg(DISTINCT x)
      FROM (
        SELECT unnest(
          CASE WHEN s = 'processing' THEN ARRAY['draft','confirmed'] ELSE ARRAY[s] END
        ) AS x
        FROM unnest(p_statuses) AS s
      ) t
    )
  END;

  v_search := CASE
    WHEN p_search IS NULL OR p_search = '' THEN NULL
    ELSE replace(replace(p_search, '%', '\%'), '_', '\_')
  END;

  RETURN QUERY
  WITH loc AS (
    SELECT
      i.status,
      i.total,
      coalesce(i.discount_amount, 0) + coalesce(i.promotion_discount, 0) AS giam
    FROM public.invoices i
    WHERE
      i.tenant_id = v_tenant
      AND i.deleted_at IS NULL
      AND (coalesce(p_options,'{}'::jsonb)='{}'::jsonb OR EXISTS(select 1 from public.fnb_invoice_option_items_20261023(i) r where (not p_options?'productId' or r.product_id::text=p_options->>'productId') and public.fnb_item_matches_choices_20261023(r.size,r.choices,p_options)))
      AND (p_table IS NULL OR public.fnb_table_label_20261023(i)=p_table)
      AND (p_area IS NULL OR public.fnb_area_label_20261023(i)=p_area)
      -- 00342: CHỈ CHỨNG TỪ BÁN. Đơn đặt hàng còn là đơn (source='order'
      -- và chưa chuyển mã) thuộc trang Đơn đặt hàng, không phải trang Hoá
      -- đơn. Đơn ĐÃ chuyển tại chỗ giữ source='order' nhưng có order_code
      -- → là hoá đơn bán thật, PHẢI đếm. IS DISTINCT FROM để an toàn NULL.
      AND (i.source IS DISTINCT FROM 'order' OR i.order_code IS NOT NULL)
      AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
      AND (
        v_xem_toan_bo
        OR p_branch_id IS NOT NULL
        OR i.branch_id IN (
             SELECT b.branch_id FROM public.get_user_accessible_branches(v_actor) b
           )
      )
      AND (p_date_from         IS NULL OR coalesce(i.issued_at, i.created_at) >= p_date_from)
      AND (p_date_to_exclusive IS NULL OR coalesce(i.issued_at, i.created_at) <  p_date_to_exclusive)
      AND (
        v_search IS NULL OR
        CASE p_search_field
          WHEN 'code'          THEN i.code          ILIKE '%' || v_search || '%'
          WHEN 'customer_name' THEN i.customer_name ILIKE '%' || v_search || '%'
          ELSE  i.code          ILIKE '%' || v_search || '%'
             OR i.customer_name ILIKE '%' || v_search || '%'
        END
      )
      AND (
        p_delivery IS NULL OR p_delivery = 'all'
        -- RETAIL_INVOICE_TYPE_20261022: non-overlapping groups; NULL source stays visible.
        OR (p_delivery='retail_internal' AND i.source='internal')
        OR (p_delivery in ('retail_delivery','retail_no_delivery')
            AND i.source IS DISTINCT FROM 'internal' AND i.source IS DISTINCT FROM 'fnb'
            AND (EXISTS (SELECT 1 FROM public.shipping_orders so
                 WHERE so.invoice_id=i.id AND so.tenant_id=i.tenant_id))
                = (p_delivery='retail_delivery'))

        -- FNB_INVOICE_TYPE_20261022: EXISTS avoids multiplying invoice totals.
        OR (p_delivery in ('fnb_dine_in','fnb_takeaway','fnb_delivery')
            AND i.source='fnb' AND EXISTS (
              SELECT 1 FROM public.kitchen_orders ko
              WHERE ko.invoice_id=i.id AND ko.tenant_id=i.tenant_id
                AND ko.branch_id=i.branch_id
                AND ko.order_type=substring(p_delivery from 5)))

        OR (p_delivery = 'delivery' AND EXISTS (
              SELECT 1 FROM public.shipping_orders so
              WHERE so.invoice_id = i.id AND so.tenant_id = v_tenant))
        OR (p_delivery = 'no_delivery' AND NOT EXISTS (
              SELECT 1 FROM public.shipping_orders so
              WHERE so.invoice_id = i.id AND so.tenant_id = v_tenant))
      )
  )
  SELECT
    count(*)                                                    AS tat_ca_hoa_don,
    count(*) FILTER (WHERE l.status = 'completed')               AS hoan_thanh,
    count(*) FILTER (WHERE l.status = 'cancelled')               AS da_huy,
    coalesce(sum(l.total) FILTER (WHERE l.status = 'completed'), 0)
                                                                 AS gia_tri_hoan_thanh,
    coalesce(sum(l.giam)  FILTER (WHERE l.status = 'completed'), 0)
                                                                 AS giam_gia_ap_dung,
    count(*) FILTER (
      WHERE v_statuses IS NULL OR l.status = ANY (v_statuses)
    )                                                            AS so_dong_theo_bo_loc
  FROM loc l;
END;
$function$;
revoke all on function public.get_invoice_list_summary_fnb_choices_20261023(uuid,timestamptz,timestamptz,text[],text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.get_invoice_list_summary_fnb_choices_20261023(uuid,timestamptz,timestamptz,text[],text,text,text,text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
