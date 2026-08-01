-- ============================================================
-- 00257: Separate receivable and payable aging reports
--
-- Read-only report functions. Applying this migration does not update,
-- insert or delete existing business rows.
-- ============================================================

begin;

create or replace function public.get_receivable_aging_report(
  p_branch_id uuid default null,
  p_as_of_date timestamptz default null,
  p_tenant_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_as_of timestamptz := coalesce(p_as_of_date, now());
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
    raise exception using errcode = '42501', message = 'REPORT_TENANT_SPOOF_BLOCKED';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'as_of_date', v_as_of,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      with debt_documents as (
        select
          i.id,
          i.customer_id,
          coalesce(nullif(trim(i.customer_name), ''), 'Khách lẻ') as customer_name,
          greatest(coalesce(i.debt, 0), 0) as outstanding,
          i.created_at,
          greatest(
            0,
            floor(extract(epoch from (v_as_of - i.created_at)) / 86400)::int
          ) as days_old
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and coalesce(i.debt, 0) > 0
          and i.created_at <= v_as_of
          and (p_branch_id is null or i.branch_id = p_branch_id)
      )
      select coalesce(
        jsonb_agg(to_jsonb(t) order by t.outstanding desc, t.customer_name),
        '[]'::jsonb
      )
      from (
        select
          coalesce(
            customer_id::text,
            'walk-in:' || md5(customer_name)
          ) as customer_id,
          customer_name,
          count(*)::int as invoice_count,
          sum(outstanding) as outstanding,
          sum(outstanding) filter (where days_old <= 30) as bucket_0_30,
          sum(outstanding) filter (where days_old between 31 and 60) as bucket_31_60,
          sum(outstanding) filter (where days_old between 61 and 90) as bucket_61_90,
          sum(outstanding) filter (where days_old > 90) as bucket_91_plus,
          max(days_old)::int as oldest_days,
          min(created_at) as oldest_invoice_date
        from debt_documents
        group by customer_id, customer_name
      ) t
    )
  );
end;
$$;

create or replace function public.get_payable_aging_report(
  p_branch_id uuid default null,
  p_as_of_date timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_as_of timestamptz := coalesce(p_as_of_date, now());
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id
    into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'as_of_date', v_as_of,
    'tenant_id', v_tenant_id,
    'branch_id', p_branch_id,
    'rows', (
      with first_receipt as (
        select
          sm.reference_id as purchase_order_id,
          min(sm.created_at) as first_received_at
        from public.stock_movements sm
        where sm.tenant_id = v_tenant_id
          and sm.reference_type = 'purchase_order'
          and sm.type = 'in'
          and sm.created_at <= v_as_of
          and (p_branch_id is null or sm.branch_id = p_branch_id)
        group by sm.reference_id
      ),
      debt_documents as (
        select
          po.id,
          po.supplier_id,
          coalesce(nullif(trim(po.supplier_name), ''), 'Nhà cung cấp') as supplier_name,
          greatest(coalesce(po.debt, 0), 0) as outstanding,
          coalesce(fr.first_received_at, po.created_at) as debt_date,
          greatest(
            0,
            floor(
              extract(
                epoch from (
                  v_as_of - coalesce(fr.first_received_at, po.created_at)
                )
              ) / 86400
            )::int
          ) as days_old
        from public.purchase_orders po
        left join first_receipt fr on fr.purchase_order_id = po.id
        where po.tenant_id = v_tenant_id
          and po.status in ('partial', 'completed')
          and coalesce(po.debt, 0) > 0
          and coalesce(fr.first_received_at, po.created_at) <= v_as_of
          and (p_branch_id is null or po.branch_id = p_branch_id)
      )
      select coalesce(
        jsonb_agg(to_jsonb(t) order by t.outstanding desc, t.supplier_name),
        '[]'::jsonb
      )
      from (
        select
          supplier_id::text as supplier_id,
          supplier_name,
          count(*)::int as document_count,
          sum(outstanding) as outstanding,
          sum(outstanding) filter (where days_old <= 30) as bucket_0_30,
          sum(outstanding) filter (where days_old between 31 and 60) as bucket_31_60,
          sum(outstanding) filter (where days_old between 61 and 90) as bucket_61_90,
          sum(outstanding) filter (where days_old > 90) as bucket_91_plus,
          max(days_old)::int as oldest_days,
          min(debt_date) as oldest_document_date
        from debt_documents
        group by supplier_id, supplier_name
      ) t
    )
  );
end;
$$;

revoke all on function public.get_receivable_aging_report(
  uuid, timestamptz, uuid
) from public, anon;
grant execute on function public.get_receivable_aging_report(
  uuid, timestamptz, uuid
) to authenticated;

revoke all on function public.get_payable_aging_report(
  uuid, timestamptz
) from public, anon;
grant execute on function public.get_payable_aging_report(
  uuid, timestamptz
) to authenticated;

commit;

-- Read-only verification. Both values must be true.
select
  to_regprocedure(
    'public.get_receivable_aging_report(uuid,timestamptz,uuid)'
  ) is not null as receivable_aging_ok,
  to_regprocedure(
    'public.get_payable_aging_report(uuid,timestamptz)'
  ) is not null as payable_aging_ok;
