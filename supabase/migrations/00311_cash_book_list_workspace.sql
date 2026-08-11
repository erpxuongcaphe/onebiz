-- 00311: Read-only workspace for the cash-book list.
-- This migration creates one STABLE function. It does not update business data.

create or replace function public.get_cash_book_list_workspace(
  p_page                     integer default 0,
  p_page_size                integer default 15,
  p_search                   text default null,
  p_search_field             text default 'all',
  p_types                    text[] default null,
  p_payment_methods          text[] default null,
  p_categories               text[] default null,
  p_statuses                 text[] default null,
  p_date_from                date default null,
  p_date_to_exclusive        date default null,
  p_amount_min               numeric default null,
  p_amount_max               numeric default null,
  p_branch_id                uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor       uuid := auth.uid();
  v_tenant      uuid;
  v_search      text := nullif(trim(coalesce(p_search, '')), '');
  v_page        integer := greatest(coalesce(p_page, 0), 0);
  v_page_size   integer := least(greatest(coalesce(p_page_size, 15), 1), 200);
  v_can_all     boolean;
  v_result      jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'CASH_BOOK_AUTH_REQUIRED';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'CASH_BOOK_TENANT_UNKNOWN';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_actor
      and p.tenant_id = v_tenant
      and coalesce(p.is_active, true)
  ) then
    raise exception using errcode = '42501', message = 'CASH_BOOK_PROFILE_INACTIVE';
  end if;

  if not public.user_has_permission(v_actor, 'finance.view_cash_book') then
    raise exception using errcode = '42501', message = 'CASH_BOOK_PERMISSION_DENIED';
  end if;

  v_can_all :=
       public.user_has_permission(v_actor, 'reports.view_all_branches')
    or public.user_has_permission(v_actor, 'system.manage_branches');

  if p_branch_id is not null then
    if not exists (
      select 1 from public.branches b
      where b.id = p_branch_id and b.tenant_id = v_tenant
    ) then
      raise exception using errcode = '42501', message = 'CASH_BOOK_BRANCH_NOT_IN_TENANT';
    end if;
    if not v_can_all and not public.user_has_branch_access(v_actor, p_branch_id) then
      raise exception using errcode = '42501', message = 'CASH_BOOK_BRANCH_DENIED';
    end if;
  end if;

  if p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max then
    raise exception using errcode = '22023', message = 'CASH_BOOK_AMOUNT_RANGE_INVALID';
  end if;

  with scoped as (
    select
      ct.*,
      p.full_name as created_by_name,
      b.name as branch_name,
      coalesce(i.code, po.code) as reference_code
    from public.cash_transactions ct
    left join public.profiles p
      on p.id = ct.created_by and p.tenant_id = v_tenant
    left join public.branches b
      on b.id = ct.branch_id and b.tenant_id = v_tenant
    left join public.invoices i
      on ct.reference_type = 'invoice'
     and i.id = ct.reference_id
     and i.tenant_id = v_tenant
    left join public.purchase_orders po
      on ct.reference_type = 'purchase_order'
     and po.id = ct.reference_id
     and po.tenant_id = v_tenant
    where ct.tenant_id = v_tenant
      and (
        (p_branch_id is not null and ct.branch_id = p_branch_id)
        or (p_branch_id is null and v_can_all)
        or (
          p_branch_id is null and not v_can_all
          and ct.branch_id in (
            select ab.branch_id
            from public.get_user_accessible_branches(v_actor) ab
          )
        )
      )
  ), filtered as (
    select s.*
    from scoped s
    where (
      v_search is null
      or case coalesce(p_search_field, 'all')
        when 'code' then position(lower(v_search) in lower(coalesce(s.code, ''))) > 0
        when 'counterparty' then position(lower(v_search) in lower(coalesce(s.counterparty, ''))) > 0
        when 'note' then position(lower(v_search) in lower(coalesce(s.note, ''))) > 0
        when 'reference' then
             position(lower(v_search) in lower(coalesce(s.reference_code, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.reference_type, ''))) > 0
        else
             position(lower(v_search) in lower(coalesce(s.code, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.counterparty, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.note, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.reference_code, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.reference_type, ''))) > 0
        end
    )
      and (p_types is null or cardinality(p_types) = 0 or s.type = any(p_types))
      and (p_payment_methods is null or cardinality(p_payment_methods) = 0 or s.payment_method = any(p_payment_methods))
      and (p_categories is null or cardinality(p_categories) = 0 or s.category = any(p_categories))
      and (p_statuses is null or cardinality(p_statuses) = 0 or s.status = any(p_statuses))
      and (p_date_from is null or s.transaction_date >= p_date_from)
      and (p_date_to_exclusive is null or s.transaction_date < p_date_to_exclusive)
      and (p_amount_min is null or s.amount >= p_amount_min)
      and (p_amount_max is null or s.amount <= p_amount_max)
  ), ranked as (
    select f.*, row_number() over (
      order by f.transaction_date desc, f.created_at desc, f.id
    ) as row_order
    from filtered f
  ), page_rows as (
    select * from ranked
    where row_order > v_page * v_page_size
      and row_order <= (v_page + 1) * v_page_size
    order by row_order
  ), filtered_summary as (
    select
      count(*)::bigint as row_count,
      count(*) filter (where status = 'completed' and type = 'receipt')::bigint as receipt_count,
      count(*) filter (where status = 'completed' and type = 'payment')::bigint as payment_count,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'receipt'), 0)::numeric as total_receipt,
      coalesce(sum(amount) filter (where status = 'completed' and type = 'payment'), 0)::numeric as total_payment
    from filtered
  ), ledger_scope as (
    select s.* from scoped s
    where s.status = 'completed'
      and (p_payment_methods is null or cardinality(p_payment_methods) = 0 or s.payment_method = any(p_payment_methods))
  ), ledger_summary as (
    select
      coalesce(sum(case when type = 'receipt' then amount else -amount end)
        filter (where p_date_from is not null and transaction_date < p_date_from), 0)::numeric as opening_balance,
      coalesce(sum(case when type = 'receipt' then amount else -amount end)
        filter (where p_date_to_exclusive is null or transaction_date < p_date_to_exclusive), 0)::numeric as closing_balance
    from ledger_scope
  ), category_options as (
    select coalesce(jsonb_agg(jsonb_build_object('value', category, 'count', category_count) order by category), '[]'::jsonb) as items
    from (
      select category, count(*)::bigint as category_count
      from scoped
      group by category
    ) c
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        (to_jsonb(pr) - 'row_order' - 'created_by_name' - 'branch_name')
        || jsonb_build_object(
          'profiles', case when pr.created_by_name is null then null else jsonb_build_object('full_name', pr.created_by_name) end,
          'branches', case when pr.branch_name is null then null else jsonb_build_object('name', pr.branch_name) end
        ) order by pr.row_order
      ) from page_rows pr
    ), '[]'::jsonb),
    'total', (select row_count from filtered_summary),
    'summary', jsonb_build_object(
      'totalReceipt', (select total_receipt from filtered_summary),
      'totalPayment', (select total_payment from filtered_summary),
      'receiptCount', (select receipt_count from filtered_summary),
      'paymentCount', (select payment_count from filtered_summary),
      'openingBalance', (select opening_balance from ledger_summary),
      'closingBalance', (select closing_balance from ledger_summary)
    ),
    'categoryOptions', (select items from category_options)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.get_cash_book_list_workspace(
  integer, integer, text, text, text[], text[], text[], text[], date, date, numeric, numeric, uuid
) is 'Read-only cash-book list, metrics, branch scope and category options.';

revoke all on function public.get_cash_book_list_workspace(
  integer, integer, text, text, text[], text[], text[], text[], date, date, numeric, numeric, uuid
) from public, anon;

grant execute on function public.get_cash_book_list_workspace(
  integer, integer, text, text, text[], text[], text[], text[], date, date, numeric, numeric, uuid
) to authenticated;

notify pgrst, 'reload schema';

select to_regprocedure(
  'public.get_cash_book_list_workspace(integer,integer,text,text,text[],text[],text[],text[],date,date,numeric,numeric,uuid)'
) is not null as cash_book_workspace_rpc_ok;
