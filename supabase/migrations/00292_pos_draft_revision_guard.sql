-- ============================================================
-- 00292: Guard retail POS drafts against stale-device overwrites
-- ============================================================
-- Safe metadata/functions only:
-- - Does not change invoice amounts, items, stock, debt, cash or status.
-- - Existing invoices receive draft_revision = 0.
-- - New RPCs coexist with the current RPCs for a staged rollout.

alter table public.invoices
  add column if not exists draft_revision bigint not null default 0;

comment on column public.invoices.draft_revision is
  'Monotonic revision used to reject stale POS draft saves from another browser or device.';

create or replace function public.save_pos_draft_atomic_v3(
  p_branch_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_order_discount numeric,
  p_shipping_fee numeric,
  p_order_vat_rate numeric,
  p_note text,
  p_client_session_id text,
  p_auto_saved boolean,
  p_invoice_id uuid default null,
  p_expected_revision bigint default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_session_id uuid;
  v_invoice record;
  v_has_invoice boolean := false;
  v_result jsonb;
  v_next_revision bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;
  if not exists (
    select 1 from public.branches b
     where b.id = p_branch_id
       and b.tenant_id = v_tenant_id
       and coalesce(b.is_active, true)
  ) or not public.user_has_branch_access(v_actor, p_branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;

  begin
    v_session_id := nullif(trim(coalesce(p_client_session_id, '')), '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end;
  if v_session_id is null then
    raise exception using errcode = '22023', message = 'POS_SESSION_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text || ':' || v_session_id::text, 292)
  );

  if p_invoice_id is not null then
    select i.id, i.code, i.status, i.branch_id, i.client_session_id,
           i.draft_revision
      into v_invoice
      from public.invoices i
     where i.id = p_invoice_id
       and i.tenant_id = v_tenant_id
       and i.deleted_at is null
     for update;
    v_has_invoice := found;
  elsif v_session_id is not null then
    select i.id, i.code, i.status, i.branch_id, i.client_session_id,
           i.draft_revision
      into v_invoice
      from public.invoices i
     where i.tenant_id = v_tenant_id
       and i.client_session_id = v_session_id
       and i.deleted_at is null
     order by i.created_at desc
     limit 1
     for update;
    v_has_invoice := found;
  end if;

  if v_has_invoice then
    if v_invoice.status <> 'draft' then
      return jsonb_build_object(
        'invoice_id', v_invoice.id,
        'invoice_code', v_invoice.code,
        'status', v_invoice.status,
        'revision', v_invoice.draft_revision,
        'idempotent', true
      );
    end if;
    if v_invoice.branch_id <> p_branch_id then
      raise exception using errcode = '42501', message = 'POS_DRAFT_BRANCH_MISMATCH';
    end if;
    if v_invoice.client_session_id is distinct from v_session_id then
      raise exception using
        errcode = '40001',
        message = 'POS_DRAFT_SESSION_CHANGED',
        detail = jsonb_build_object(
          'invoice_id', v_invoice.id,
          'current_revision', v_invoice.draft_revision
        )::text;
    end if;
    if p_expected_revision is null
       or v_invoice.draft_revision <> p_expected_revision then
      raise exception using
        errcode = '40001',
        message = 'POS_DRAFT_CONFLICT',
        detail = jsonb_build_object(
          'invoice_id', v_invoice.id,
          'expected_revision', p_expected_revision,
          'current_revision', v_invoice.draft_revision
        )::text;
    end if;
  else
    if p_invoice_id is not null or p_expected_revision is not null then
      raise exception using errcode = '40001', message = 'POS_DRAFT_NOT_FOUND';
    end if;
  end if;

  v_result := public.save_pos_draft_atomic_v2(
    p_branch_id,
    p_customer_id,
    p_items,
    p_payment_method,
    p_order_discount,
    p_shipping_fee,
    p_order_vat_rate,
    p_note,
    p_client_session_id,
    p_auto_saved
  );

  if coalesce(v_result->>'status', 'draft') <> 'draft' then
    return v_result;
  end if;

  update public.invoices i
     set draft_revision = i.draft_revision + 1
   where i.id = (v_result->>'invoice_id')::uuid
     and i.tenant_id = v_tenant_id
     and i.status = 'draft'
     and i.deleted_at is null
  returning i.draft_revision into v_next_revision;

  if v_next_revision is null then
    raise exception using errcode = '40001', message = 'POS_DRAFT_CHANGED_DURING_SAVE';
  end if;

  return v_result || jsonb_build_object('revision', v_next_revision);
end;
$$;

revoke all on function public.save_pos_draft_atomic_v3(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, text, text, boolean, uuid, bigint
) from public, anon;
grant execute on function public.save_pos_draft_atomic_v3(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, text, text, boolean, uuid, bigint
) to authenticated;

create or replace function public.adopt_pos_draft_session_atomic_v2(
  p_invoice_id uuid,
  p_client_session_id text,
  p_expected_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_session_id uuid;
  v_invoice record;
  v_next_revision bigint;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  begin
    v_session_id := nullif(trim(coalesce(p_client_session_id, '')), '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end;
  if v_session_id is null then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end if;

  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.save_draft') then
    raise exception using errcode = '42501', message = 'POS_SAVE_DRAFT_DENIED';
  end if;

  select i.id, i.code, i.branch_id, i.status, i.client_session_id,
         i.draft_revision
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;

  if not found or v_invoice.status <> 'draft' then
    raise exception using errcode = '40001', message = 'POS_DRAFT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if p_expected_revision is null
     or v_invoice.draft_revision <> p_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'POS_DRAFT_CONFLICT',
      detail = jsonb_build_object(
        'invoice_id', v_invoice.id,
        'expected_revision', p_expected_revision,
        'current_revision', v_invoice.draft_revision
      )::text;
  end if;

  if v_invoice.client_session_id = v_session_id then
    return jsonb_build_object(
      'invoice_id', v_invoice.id,
      'invoice_code', v_invoice.code,
      'revision', v_invoice.draft_revision,
      'idempotent', true
    );
  end if;
  if exists (
    select 1 from public.invoices other
     where other.tenant_id = v_tenant_id
       and other.client_session_id = v_session_id
       and other.id <> v_invoice.id
       and other.deleted_at is null
  ) then
    raise exception using errcode = '23505', message = 'POS_SESSION_ALREADY_USED';
  end if;

  update public.invoices
     set client_session_id = v_session_id,
         draft_revision = draft_revision + 1,
         updated_at = now()
   where id = v_invoice.id
     and tenant_id = v_tenant_id
  returning draft_revision into v_next_revision;

  return jsonb_build_object(
    'invoice_id', v_invoice.id,
    'invoice_code', v_invoice.code,
    'revision', v_next_revision,
    'idempotent', false
  );
end;
$$;

revoke all on function public.adopt_pos_draft_session_atomic_v2(uuid, text, bigint)
  from public, anon;
grant execute on function public.adopt_pos_draft_session_atomic_v2(uuid, text, bigint)
  to authenticated;

create or replace function public.complete_draft_atomic_v5(
  p_invoice_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_method text,
  p_paid numeric,
  p_payment_breakdown jsonb default null,
  p_shift_id uuid default null,
  p_promotion_id uuid default null,
  p_coupon_code text default null,
  p_loyalty_points integer default 0,
  p_discount_source text default null,
  p_order_discount numeric default 0,
  p_discount_otp_id uuid default null,
  p_discount_reason text default null,
  p_shipping_fee numeric default 0,
  p_order_vat_rate numeric default 0,
  p_allow_bom_shortage boolean default false,
  p_amount_tendered numeric default null,
  p_customer_credit numeric default 0,
  p_client_session_id text default null,
  p_expected_revision bigint default null,
  p_expected_total numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid := public.get_user_tenant_id();
  v_session_id uuid;
  v_invoice record;
  v_result jsonb;
  v_server_total numeric;
begin
  if v_actor is null or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'POS_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'pos_retail.checkout') then
    raise exception using errcode = '42501', message = 'POS_CHECKOUT_DENIED';
  end if;
  begin
    v_session_id := nullif(trim(coalesce(p_client_session_id, '')), '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'POS_SESSION_INVALID';
  end;

  select i.id, i.code, i.status, i.branch_id, i.client_session_id,
         i.draft_revision, i.total, i.paid, i.debt
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.tenant_id = v_tenant_id
     and i.deleted_at is null
   for update;

  if not found then
    raise exception using errcode = '40001', message = 'POS_DRAFT_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then
    raise exception using errcode = '42501', message = 'POS_BRANCH_DENIED';
  end if;
  if v_invoice.status = 'completed' then
    return public.complete_draft_atomic_v4(
      p_invoice_id, p_customer_id, p_items, p_method, p_paid,
      p_payment_breakdown, p_shift_id, p_promotion_id, p_coupon_code,
      p_loyalty_points, p_discount_source, p_order_discount,
      p_discount_otp_id, p_discount_reason, p_shipping_fee,
      p_order_vat_rate, p_allow_bom_shortage, p_amount_tendered,
      p_customer_credit
    );
  end if;
  if v_invoice.status <> 'draft' then
    raise exception using errcode = '40001', message = 'POS_DRAFT_ALREADY_PROCESSED';
  end if;
  if v_invoice.client_session_id is distinct from v_session_id then
    raise exception using errcode = '40001', message = 'POS_DRAFT_SESSION_CHANGED';
  end if;
  if p_expected_revision is null
     or v_invoice.draft_revision <> p_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'POS_DRAFT_CONFLICT',
      detail = jsonb_build_object(
        'invoice_id', v_invoice.id,
        'expected_revision', p_expected_revision,
        'current_revision', v_invoice.draft_revision
      )::text;
  end if;
  if p_expected_total is null or p_expected_total < 0 then
    raise exception using errcode = '22023', message = 'POS_EXPECTED_TOTAL_INVALID';
  end if;

  v_result := public.complete_draft_atomic_v4(
    p_invoice_id, p_customer_id, p_items, p_method, p_paid,
    p_payment_breakdown, p_shift_id, p_promotion_id, p_coupon_code,
    p_loyalty_points, p_discount_source, p_order_discount,
    p_discount_otp_id, p_discount_reason, p_shipping_fee,
    p_order_vat_rate, p_allow_bom_shortage, p_amount_tendered,
    p_customer_credit
  );
  v_server_total := (v_result->>'total')::numeric;

  if abs(v_server_total - p_expected_total) > 0.01 then
    raise exception using
      errcode = '40001',
      message = 'POS_CART_TOTAL_CHANGED',
      detail = jsonb_build_object(
        'expected_total', p_expected_total,
        'server_total', v_server_total
      )::text;
  end if;

  return v_result || jsonb_build_object('revision', v_invoice.draft_revision);
end;
$$;

revoke all on function public.complete_draft_atomic_v5(
  uuid, uuid, jsonb, text, numeric, jsonb, uuid, uuid, text, integer, text,
  numeric, uuid, text, numeric, numeric, boolean, numeric, numeric, text,
  bigint, numeric
) from public, anon;
grant execute on function public.complete_draft_atomic_v5(
  uuid, uuid, jsonb, text, numeric, jsonb, uuid, uuid, text, integer, text,
  numeric, uuid, text, numeric, numeric, boolean, numeric, numeric, text,
  bigint, numeric
) to authenticated;

create or replace function public.get_pos_invoice_integrity_report(
  p_from timestamptz default (now() - interval '7 days'),
  p_to timestamptz default now(),
  p_branch_id uuid default null,
  p_limit integer default 200
) returns table (
  invoice_id uuid,
  invoice_code text,
  branch_id uuid,
  status text,
  created_at timestamptz,
  invoice_subtotal numeric,
  detail_subtotal numeric,
  invoice_discount numeric,
  detail_discount numeric,
  invoice_total numeric,
  formula_total numeric,
  largest_difference numeric,
  issue_codes text[]
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception using errcode = '22023', message = 'REPORT_DATE_RANGE_INVALID';
  end if;
  perform public.assert_report_access('system.view_audit', p_branch_id);

  return query
  with detail as (
    select
      ii.invoice_id,
      coalesce(sum(ii.quantity * ii.unit_price), 0)::numeric as subtotal,
      coalesce(sum(ii.discount), 0)::numeric as discount,
      coalesce(sum(ii.total), 0)::numeric as line_total
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
    where i.tenant_id = public.get_user_tenant_id()
      and i.created_at >= p_from
      and i.created_at < p_to
      and (p_branch_id is null or i.branch_id = p_branch_id)
      and i.deleted_at is null
    group by ii.invoice_id
  ), checked as (
    select
      i.id,
      i.code,
      i.branch_id,
      i.status,
      i.created_at,
      coalesce(i.subtotal, 0)::numeric as invoice_subtotal,
      coalesce(d.subtotal, 0)::numeric as detail_subtotal,
      coalesce(i.discount_amount, 0)::numeric as invoice_discount,
      coalesce(d.discount, 0)::numeric as detail_discount,
      coalesce(i.total, 0)::numeric as invoice_total,
      greatest(
        0,
        coalesce(i.subtotal, 0)
        - coalesce(i.discount_amount, 0)
        + coalesce(i.tax_amount, 0)
        + coalesce(i.delivery_fee, 0)
      )::numeric as formula_total,
      coalesce(d.line_total, 0)::numeric as detail_line_total
    from public.invoices i
    left join detail d on d.invoice_id = i.id
    where i.tenant_id = public.get_user_tenant_id()
      and i.created_at >= p_from
      and i.created_at < p_to
      and (p_branch_id is null or i.branch_id = p_branch_id)
      and i.deleted_at is null
      and coalesce(i.source, 'pos') = 'pos'
      and i.status in ('draft', 'completed', 'cancelled')
  )
  select
    c.id,
    c.code,
    c.branch_id,
    c.status,
    c.created_at,
    c.invoice_subtotal,
    c.detail_subtotal,
    c.invoice_discount,
    c.detail_discount,
    c.invoice_total,
    c.formula_total,
    greatest(
      abs(c.invoice_subtotal - c.detail_subtotal),
      abs(c.invoice_total - c.formula_total),
      abs(c.detail_line_total - (c.detail_subtotal - c.detail_discount))
    )::numeric as largest_difference,
    array_remove(array[
      case when abs(c.invoice_subtotal - c.detail_subtotal) > 0.01
        then 'SUBTOTAL_VS_ITEMS' end,
      case when abs(c.invoice_total - c.formula_total) > 0.01
        then 'TOTAL_VS_FORMULA' end,
      case when abs(c.detail_line_total - (c.detail_subtotal - c.detail_discount)) > 0.01
        then 'LINE_TOTAL_VS_ITEMS' end
    ], null)::text[] as issue_codes
  from checked c
  where abs(c.invoice_subtotal - c.detail_subtotal) > 0.01
     or abs(c.invoice_total - c.formula_total) > 0.01
     or abs(c.detail_line_total - (c.detail_subtotal - c.detail_discount)) > 0.01
  order by c.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

revoke all on function public.get_pos_invoice_integrity_report(
  timestamptz, timestamptz, uuid, integer
) from public, anon;
grant execute on function public.get_pos_invoice_integrity_report(
  timestamptz, timestamptz, uuid, integer
) to authenticated;

notify pgrst, 'reload schema';

select
  to_regprocedure('public.save_pos_draft_atomic_v3(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,boolean,uuid,bigint)') is not null as draft_v3_ok,
  to_regprocedure('public.adopt_pos_draft_session_atomic_v2(uuid,text,bigint)') is not null as adopt_v2_ok,
  to_regprocedure('public.complete_draft_atomic_v5(uuid,uuid,jsonb,text,numeric,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric,text,bigint,numeric)') is not null as checkout_v5_ok,
  to_regprocedure('public.get_pos_invoice_integrity_report(timestamptz,timestamptz,uuid,integer)') is not null as integrity_report_ok;

