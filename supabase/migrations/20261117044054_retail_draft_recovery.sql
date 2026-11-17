begin;

-- The shared view authorizes every branch/source in the tenant. Drafts only
-- need the authorization and indexed lines of one Retail invoice.
create function public.read_retail_draft_lines(p_invoice_id uuid, p_branch_id uuid)
returns table(id uuid, product_id uuid, variant_id uuid, product_name text,
              unit text, quantity numeric, unit_price numeric, discount numeric,
              total numeric, note text, transaction_unit text,
              transaction_quantity numeric, transaction_unit_price numeric)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  tenant uuid := public.get_user_tenant_id();
  draft_source text;
begin
  select coalesce(i.source, 'pos') into draft_source
  from public.invoices i
  where i.id = p_invoice_id and i.branch_id = p_branch_id and i.tenant_id = tenant
    and i.deleted_at is null and i.status = 'draft'
    and coalesce(i.source, 'pos') in ('pos', 'internal');

  if actor is null or draft_source is null
    or not exists (select 1 from public.profiles p where p.id = actor
                   and p.tenant_id = tenant and coalesce(p.is_active, true))
    or not coalesce(public._can_read_branch_inventory_00476(actor, tenant, p_branch_id), false)
    or not (coalesce(public._staff_invoice_item_legacy_scope(), false)
            or coalesce(public._staff_invoice_item_read(tenant, p_branch_id, draft_source), false))
  then
    raise exception 'RETAIL_DRAFT_NOT_ACCESSIBLE' using errcode = '42501';
  end if;

  return query
    select l.id, l.product_id, l.variant_id, l.product_name::text, l.unit::text,
           l.quantity, l.unit_price, l.discount, l.total, l.note::text,
           l.transaction_unit::text, l.transaction_quantity, l.transaction_unit_price
    from public.invoice_items l
    where l.invoice_id = p_invoice_id;
end;
$$;

-- A successful create and its request ID commit together. Scope the key to
-- the actor and parent so retries never return another employee's draft.
create table private.retail_order_open_requests (
  tenant_id uuid not null,
  actor_id uuid not null,
  order_id uuid not null,
  request_id uuid not null,
  child_id uuid not null,
  primary key (tenant_id, actor_id, order_id, request_id)
);

alter table private.retail_order_open_requests enable row level security;
revoke all on private.retail_order_open_requests from public, anon, authenticated;

create function public.open_retail_order_draft(p_order_id uuid, p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  tenant uuid := public.get_user_tenant_id();
  parent record;
  draft record;
  saved_id uuid;
  result jsonb;
begin
  if actor is null or tenant is null or p_request_id is null then
    raise exception 'RETAIL_ORDER_NOT_ACCESSIBLE' using errcode = '42501';
  end if;

  select i.code, i.branch_id into parent
  from public.invoices i
  where i.id = p_order_id and i.tenant_id = tenant
    and i.source = 'order' and i.deleted_at is null and i.status <> 'cancelled';

  if not found or not exists (select 1 from public.profiles p where p.id = actor
                              and p.tenant_id = tenant and p.is_active)
    or not coalesce(public.user_has_branch_access(actor, parent.branch_id), false)
    or not (coalesce(public._staff_permission_at_scope(actor, 'pos_retail.checkout', parent.branch_id), false)
            or coalesce(public._staff_permission_at_scope(actor, 'orders.create', parent.branch_id), false))
    or (not coalesce(public._staff_order_owner_unrestricted(), false)
        and not coalesce(public._staff_order_target_visible(p_order_id), false))
  then
    raise exception 'RETAIL_ORDER_NOT_ACCESSIBLE' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(tenant::text || ':' || actor::text || ':' || p_order_id::text || ':' || p_request_id::text, 0)
  );

  select r.child_id into saved_id from private.retail_order_open_requests r
  where r.tenant_id = tenant and r.actor_id = actor
    and r.order_id = p_order_id and r.request_id = p_request_id;

  if found then
    select i.id, i.code, i.client_session_id, i.draft_revision into draft
    from public.invoices i where i.id = saved_id and i.tenant_id = tenant
      and i.branch_id = parent.branch_id and i.source_order_id = p_order_id
      and i.deleted_at is null and i.status = 'draft';
    if not found then
      raise exception 'RETAIL_ORDER_DRAFT_NO_LONGER_OPEN' using errcode = 'P0002';
    end if;
    return jsonb_build_object('child_id', draft.id, 'child_code', draft.code,
      'client_session_id', draft.client_session_id, 'draft_revision', draft.draft_revision,
      'item_count', (select count(*) from public.invoice_items l where l.invoice_id = draft.id),
      'source_order_id', p_order_id, 'source_order_code', parent.code);
  end if;

  result := public.create_child_sale_from_order(p_order_id);
  insert into private.retail_order_open_requests (tenant_id, actor_id, order_id, request_id, child_id)
  values (tenant, actor, p_order_id, p_request_id, (result ->> 'child_id')::uuid);
  return result;
end;
$$;

revoke all on function public.read_retail_draft_lines(uuid, uuid), public.open_retail_order_draft(uuid, uuid)
from public, anon;
grant execute on function public.read_retail_draft_lines(uuid, uuid), public.open_retail_order_draft(uuid, uuid)
to authenticated;

notify pgrst, 'reload schema';
commit;
