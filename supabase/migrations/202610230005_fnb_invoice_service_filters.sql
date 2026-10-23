-- Read-only service filters: identical predicates for lists, KPI and exports.
begin;
create or replace function public.fnb_table_label_20261023(public.invoices)
returns text language sql stable set search_path=public as $$
 select case when ($1).source is distinct from 'fnb' then null
 when ($1).fnb_context->>'version'='1' then coalesce(nullif(($1).fnb_context->>'table_name',''),'Bàn '||nullif(($1).fnb_context->>'table_number',''))
 else (select coalesce(nullif(t.name,''),'Bàn '||t.table_number::text)
  from kitchen_orders k join restaurant_tables t on t.id=k.table_id and t.tenant_id=k.tenant_id and t.branch_id=k.branch_id
  where k.invoice_id=($1).id and k.tenant_id=($1).tenant_id and k.branch_id=($1).branch_id
  order by k.created_at,k.id limit 1) end;
$$;
create or replace function public.fnb_area_label_20261023(public.invoices)
returns text language sql stable set search_path=public as $$
 select case when ($1).source is distinct from 'fnb' then null
 when ($1).fnb_context->>'version'='1' then nullif(($1).fnb_context->>'area_name','')
 else (select coalesce(nullif(z.name,''),nullif(t.zone,''))
  from kitchen_orders k join restaurant_tables t on t.id=k.table_id and t.tenant_id=k.tenant_id and t.branch_id=k.branch_id
  left join floor_plan_zones z on z.id=t.zone_id and z.tenant_id=k.tenant_id and z.branch_id=k.branch_id
  where k.invoice_id=($1).id and k.tenant_id=($1).tenant_id and k.branch_id=($1).branch_id
  order by k.created_at,k.id limit 1) end;
$$;
revoke all on function public.fnb_table_label_20261023(public.invoices),public.fnb_area_label_20261023(public.invoices) from public,anon;
grant execute on function public.fnb_table_label_20261023(public.invoices),public.fnb_area_label_20261023(public.invoices) to authenticated;
-- Unnamed composite parameters keep the computed fields off the /rpc surface.
create or replace function public.get_fnb_invoice_filter_options_20261023(p_branch_id uuid default null)
returns jsonb language plpgsql stable set search_path=public as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); all_branches boolean;
begin
 if actor is null or tenant is null or not exists(select 1 from profiles p where p.id=actor and p.tenant_id=tenant and coalesce(p.is_active,true)) then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if not (public.user_has_permission(actor,'invoices.view') or public.user_has_permission(actor,'pos_fnb.view_orders')) then raise exception 'INVOICE_VIEW_REQUIRED' using errcode='42501';end if;
 all_branches:=public.user_has_permission(actor,'reports.view_all_branches');
 if p_branch_id is not null and (not exists(select 1 from branches b where b.id=p_branch_id and b.tenant_id=tenant) or not(all_branches or public.user_has_branch_access(actor,p_branch_id))) then raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501';end if;
 return (with scoped as (
  select public.fnb_table_label_20261023(i) as table_label,public.fnb_area_label_20261023(i) as area_label
  from invoices i where i.tenant_id=tenant and i.source='fnb' and i.deleted_at is null
   and (p_branch_id is null or i.branch_id=p_branch_id)
   and (all_branches or public.user_has_branch_access(actor,i.branch_id))
 ), unique_rows as (select distinct table_label,area_label from scoped)
 select jsonb_build_object('tables',coalesce((select jsonb_agg(jsonb_build_object('label',table_label,'area',area_label) order by table_label,area_label) from unique_rows where table_label is not null),'[]'::jsonb),
 'areas',coalesce((select jsonb_agg(area_label order by area_label) from (select distinct area_label from scoped where area_label is not null) a),'[]'::jsonb)));
end $$;
revoke all on function public.get_fnb_invoice_filter_options_20261023(uuid) from public,anon;
grant execute on function public.get_fnb_invoice_filter_options_20261023(uuid) to authenticated;
CREATE OR REPLACE FUNCTION public.get_invoice_list_summary_fnb_context_20261023(p_branch_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to_exclusive timestamp with time zone DEFAULT NULL::timestamp with time zone, p_statuses text[] DEFAULT NULL::text[], p_search text DEFAULT NULL::text, p_search_field text DEFAULT 'all'::text, p_delivery text DEFAULT 'all'::text, p_table text DEFAULT NULL::text, p_area text DEFAULT NULL::text)
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

revoke all on function public.get_invoice_list_summary_fnb_context_20261023(uuid,timestamptz,timestamptz,text[],text,text,text,text,text) from public,anon;
grant execute on function public.get_invoice_list_summary_fnb_context_20261023(uuid,timestamptz,timestamptz,text[],text,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;


