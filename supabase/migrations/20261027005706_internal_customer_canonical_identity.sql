-- Canonical internal customer display without rewriting historical customer IDs.
-- No customer mapping, document repair, permission grant to a business role, or stock/cash DML.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin if md5(pg_get_functiondef('public.get_pos_customer_contacts_scoped(uuid,text,uuid,boolean,integer)'::regprocedure)) is distinct from '4e80d351e569105137a3e16a8c450e3e' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_pos_customer_contacts_scoped'; end if;
if md5(pg_get_functiondef('public.get_pos_customer_balance_scoped(uuid,uuid)'::regprocedure)) is distinct from '7dc049b29a5aa6577fc34ec521b7fd0a' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_pos_customer_balance_scoped'; end if;
if md5(pg_get_functiondef('public.get_customer_list_workspace(integer,integer,text,text,uuid[],text,text,text,text,text,text,integer,text[],timestamptz,timestamptz,text,uuid)'::regprocedure)) is distinct from '4a445c01b0ed8b34f58a704ecab9046b' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_customer_list_workspace'; end if;
if md5(pg_get_functiondef('public.get_customer_financial_report(timestamptz,timestamptz,uuid)'::regprocedure)) is distinct from 'a44bbefea3f6f746a878910fa6b369dd' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_customer_financial_report'; end if;
if md5(pg_get_functiondef('public.get_sku_financial_report(timestamptz,timestamptz,uuid,uuid)'::regprocedure)) is distinct from '3b7959ca26b6d78538d061f9c11a4867' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_sku_financial_report'; end if;
if md5(pg_get_functiondef('public.get_counterparty_balance_summary(uuid)'::regprocedure)) is distinct from '7091ed54fc7c2bcdbc8c2eccbf9d1c08' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_counterparty_balance_summary'; end if;
if md5(pg_get_functiondef('public.get_counterparty_open_debt_aging(uuid)'::regprocedure)) is distinct from '41012c1b9e6280aa94554d5cf24fc0ce' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_counterparty_open_debt_aging'; end if;
if md5(pg_get_functiondef('public.get_receivable_aging_report(uuid,timestamptz,uuid)'::regprocedure)) is distinct from '1b1d16afe5dbcb0cef951de6e00ecec0' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_receivable_aging_report'; end if;
if md5(pg_get_functiondef('public.get_party_debt_movements(text,uuid,uuid,date,date,integer,integer)'::regprocedure)) is distinct from '2c868e9aa1650e0a10c20a3bae3b92af' then raise exception 'REVIEWED_FUNCTION_CHANGED: get_party_debt_movements'; end if;
if md5(pg_get_functiondef('public.settle_party_documents_atomic(uuid,jsonb)'::regprocedure)) is distinct from '61fd729ed40b51ff5a0c588b4a759539' then raise exception 'REVIEWED_FUNCTION_CHANGED: settle_party_documents_atomic'; end if;
if md5(pg_get_functiondef('public.apply_customer_advance_to_invoice(uuid,numeric,text)'::regprocedure)) is distinct from '6ea0cf891fd10900e7254c3b71c6bda6' then raise exception 'REVIEWED_FUNCTION_CHANGED: apply_customer_advance_to_invoice'; end if; end; $$;
do $$ begin
  if md5(pg_get_functiondef('public.checkout_internal_pos_v2(jsonb)'::regprocedure))
    is distinct from 'd4fa0f4247b7e4bcdf0c05343321395b' then
    raise exception 'REVIEWED_INTERNAL_CHECKOUT_WRAPPER_CHANGED';
  end if;
  if md5(pg_get_functiondef('public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb)'::regprocedure))
    is distinct from 'd1706e52b78a3f5f753951631d061da1' then
    raise exception 'REVIEWED_INTERNAL_CHECKOUT_CORE_CHANGED';
  end if;
  if md5(pg_get_functiondef('public.checkout_internal_pos_atomic(uuid,uuid,jsonb,text,numeric,uuid,uuid,integer,uuid,text)'::regprocedure))
    is distinct from '9bb7ec795366b6530943bdf1dd4fb45b' then
    raise exception 'REVIEWED_INTERNAL_CHECKOUT_ATOMIC_CHANGED';
  end if;
end; $$;

alter table public.customers add column canonical_customer_id uuid
  references public.customers(id) on delete restrict;
alter table public.customers add constraint customers_canonical_not_self
  check(canonical_customer_id is null or canonical_customer_id<>id);
create unique index customers_one_internal_alias_per_canonical
  on public.customers(tenant_id,canonical_customer_id) where canonical_customer_id is not null;

create schema if not exists onebiz_identity;
revoke all on schema onebiz_identity from public,anon,authenticated;

-- Keep the target and alias in the same tenant, prevent alias chains/cycles,
-- and serialize identity edits without touching balances or historical IDs.
create function onebiz_identity.guard_customer_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare target public.customers%rowtype; changed boolean;
begin
  changed:=tg_op='INSERT';
  if tg_op='UPDATE' then
    changed:=new.canonical_customer_id is distinct from old.canonical_customer_id;
    if new.tenant_id is distinct from old.tenant_id and (old.canonical_customer_id is not null
      or new.canonical_customer_id is not null or exists(select 1 from public.customers c where c.canonical_customer_id=old.id)) then
      raise exception 'CUSTOMER_IDENTITY_TENANT_IMMUTABLE' using errcode='23514';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||new.tenant_id::text,0));
  if changed and new.canonical_customer_id is not null and (auth.uid() is not null or current_user not in ('postgres','supabase_admin')) then
    raise exception 'CUSTOMER_IDENTITY_MAPPING_MANAGED' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.canonical_customer_id is not null
    and (new.canonical_customer_id is distinct from old.canonical_customer_id or new.branch_id is distinct from old.branch_id)
    and (auth.uid() is not null or current_user not in ('postgres','supabase_admin')) then
    raise exception 'CUSTOMER_IDENTITY_MAPPING_MANAGED' using errcode='42501';
  end if;
  if new.canonical_customer_id is not null then
    select * into target from public.customers where id=new.canonical_customer_id for share;
    if not found or target.tenant_id is distinct from new.tenant_id
      or target.canonical_customer_id is not null or coalesce(target.is_internal,false)
      or coalesce(target.is_walk_in,false) or coalesce(target.code,'') !~ '^KHA-NBO-[0-9]+$'
      or not coalesce(new.is_internal,false) or new.branch_id is null or coalesce(new.is_walk_in,false) then
      raise exception 'CUSTOMER_IDENTITY_TARGET_INVALID' using errcode='23514';
    end if;
  end if;
  if exists(select 1 from public.customers c where c.canonical_customer_id=new.id
    and (c.tenant_id is distinct from new.tenant_id or new.canonical_customer_id is not null
      or coalesce(new.is_internal,false) or coalesce(new.is_walk_in,false) or coalesce(new.code,'') !~ '^KHA-NBO-[0-9]+$')) then
    raise exception 'CUSTOMER_IDENTITY_TARGET_IN_USE' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger customers_guard_canonical_identity before insert or update of canonical_customer_id,tenant_id,code,is_internal,is_walk_in,branch_id on public.customers
for each row execute function onebiz_identity.guard_customer_identity();
revoke all on function onebiz_identity.guard_customer_identity() from public,anon,authenticated;

create function onebiz_identity.logical_customer(p_tenant uuid,p_id uuid)
returns uuid language sql stable security invoker set search_path=pg_catalog,public as $$
  select coalesce(c.canonical_customer_id,c.id) from public.customers c
  where c.tenant_id=p_tenant and c.id=p_id
$$;
revoke all on function onebiz_identity.logical_customer(uuid,uuid) from public,anon,authenticated;

-- The technical receiver remains the stock/cost/paired-document identity.
-- Accept canonical NBO IDs at the boundary, never infer identity from a name.
create function onebiz_identity.internal_receiver(p_tenant uuid,p_id uuid,p_require_active boolean)
returns uuid language sql stable security invoker set search_path=pg_catalog,public as $$
  select c.id from public.customers c
  join public.branches b on b.id=c.branch_id and b.tenant_id=c.tenant_id
  where c.tenant_id=p_tenant and c.is_internal and c.branch_id is not null
    and (c.id=p_id or c.canonical_customer_id=p_id)
    and (not p_require_active or (c.is_active and b.is_active and not exists(
      select 1 from public.customers canonical where canonical.id=c.canonical_customer_id and not canonical.is_active)))
$$;
revoke all on function onebiz_identity.internal_receiver(uuid,uuid,boolean) from public,anon,authenticated;

-- Read-only identity directory. No debt, sales totals, role changes or fuzzy mapping.
create function public.get_customer_identity_directory()
returns table(alias_id uuid,canonical_id uuid,canonical_code text,canonical_name text,receiver_branch_id uuid)
language sql stable security invoker set search_path=pg_catalog,public as $$
  select a.id,c.id,c.code,c.name,a.branch_id from public.customers a
  join public.customers c on c.id=a.canonical_customer_id and c.tenant_id=a.tenant_id
  where a.tenant_id=public.get_user_tenant_id() and auth.uid() is not null
$$;
revoke all on function public.get_customer_identity_directory() from public,anon;
grant execute on function public.get_customer_identity_directory() to authenticated;

-- Replace only the thin wrapper, keeping all existing checkout authorization,
-- price, stock, lots, shift, payment, note and immutable snapshot logic delegated.
-- Deployment must first compare the current wrapper hash against its reviewed backup.
create or replace function public.checkout_internal_pos_v2(p_checkout jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare tenant uuid:=public.get_user_tenant_id(); actor uuid:=auth.uid();
  customer uuid:=nullif(p_checkout->>'customerId','')::uuid;
  branch uuid:=nullif(p_checkout->>'branchId','')::uuid;
  session_id uuid:=nullif(p_checkout->>'sessionId','')::uuid;
  receiver uuid; parent uuid; source_row record; prior record; result jsonb; payload jsonb:=p_checkout;
begin
  if actor is null or tenant is null or not public.user_has_permission(actor,'inventory.internal_export')
    or not public.user_has_branch_access(actor,branch) then
    raise exception 'INTERNAL_POS_PERMISSION_DENIED' using errcode='42501';
  end if;
  if session_id is null then raise exception 'INTERNAL_POS_SESSION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(tenant::text||session_id::text,0));
  select s.pos_checkout_fingerprint into prior from public.internal_sales s
    join public.invoices i on i.id=s.invoice_id and i.tenant_id=s.tenant_id
    where s.tenant_id=tenant and i.client_session_id=session_id;
  if found then
    -- Old sessions must still use the exact old payload. New canonical retries
    -- normalize to the same technical ID, including after a receiver deactivation.
    if prior.pos_checkout_fingerprint is distinct from md5(p_checkout::text) then
      receiver:=onebiz_identity.internal_receiver(tenant,customer,false);
      if receiver is not null then payload:=jsonb_set(p_checkout,'{customerId}',to_jsonb(receiver::text)); end if;
    end if;
    return public._checkout_internal_pos_before_fnb_bridge_20261023(payload);
  end if;
  receiver:=onebiz_identity.internal_receiver(tenant,customer,true);
  if receiver is null then raise exception 'INTERNAL_POS_CUSTOMER_INVALID'; end if;
  payload:=jsonb_set(p_checkout,'{customerId}',to_jsonb(receiver::text));
  select i.source_order_id into parent from public.invoices i
    where i.id=nullif(p_checkout->>'draftId','')::uuid and i.tenant_id=tenant for update;
  if parent is not null then
    select i.customer_id,i.branch_id into source_row from public.invoices i
      where i.id=parent and i.tenant_id=tenant and i.source='order' and i.status<>'cancelled' and i.deleted_at is null for update;
    if not found or source_row.branch_id is distinct from branch
      or onebiz_identity.logical_customer(tenant,source_row.customer_id)
        is distinct from onebiz_identity.logical_customer(tenant,receiver) then
      raise exception 'INTERNAL_POS_SOURCE_ORDER_MISMATCH';
    end if;
  end if;
  result:=public._checkout_internal_pos_before_fnb_bridge_20261023(payload);
  if parent is not null then
    update public.invoices set source_order_id=parent
      where id=(result->>'invoice_id')::uuid and tenant_id=tenant and source='internal' and status='completed';
    if not found then raise exception 'INTERNAL_POS_SOURCE_ORDER_LINK_FAILED'; end if;
  end if;
  return result;
end; $$;
-- CREATE OR REPLACE preserves the existing wrapper's owner and EXECUTE ACL.



create function onebiz_identity.family_ids(p_tenant uuid,p_id uuid) returns uuid[]
language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) from public.customers c
 where c.tenant_id=p_tenant and coalesce(c.canonical_customer_id,c.id)=onebiz_identity.logical_customer(p_tenant,p_id)
$$;
create function onebiz_identity.customer_label(p_tenant uuid,p_id uuid,p_fallback text) returns text
language sql stable security invoker set search_path=pg_catalog,public as $$
 select coalesce((select c.name from public.customers c where c.tenant_id=p_tenant
   and c.id=onebiz_identity.logical_customer(p_tenant,p_id) and exists(select 1 from public.customers a
    where a.tenant_id=p_tenant and a.canonical_customer_id=c.id)),p_fallback)
$$;
revoke all on function onebiz_identity.family_ids(uuid,uuid),onebiz_identity.customer_label(uuid,uuid,text) from public,anon,authenticated;
create function onebiz_identity.guard_customer_identity_delete() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
 if old.canonical_customer_id is not null or exists(select 1 from public.customers c where c.canonical_customer_id=old.id) then
  raise exception 'CUSTOMER_IDENTITY_IN_USE' using errcode='23503';
 end if; return old;end;$$;
revoke all on function onebiz_identity.guard_customer_identity_delete() from public,anon,authenticated;
create trigger customers_guard_identity_delete before delete on public.customers
for each row execute function onebiz_identity.guard_customer_identity_delete();
CREATE OR REPLACE FUNCTION public.get_pos_retail_customer_contacts_identity(p_branch_id uuid, p_search text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid, p_internal boolean DEFAULT false, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); tenant uuid; retail boolean; fnb boolean; search text:=nullif(trim(p_search),'');
begin
 select tenant_id into tenant from public.profiles where id=actor and coalesce(is_active,true);
 if tenant is null then raise exception 'POS_CONTACT_PROFILE_REQUIRED' using errcode='42501'; end if;
 retail:=public.user_has_permission(actor,'pos_retail.checkout');
 fnb:=public.user_has_permission(actor,'pos_fnb.checkout');
 if not (retail or fnb) or (coalesce(p_internal,false) and not retail) then
  raise exception 'POS_CONTACT_PERMISSION_DENIED' using errcode='42501'; end if;
 if p_branch_id is null or not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=tenant)
  or not (public.user_has_permission(actor,'reports.view_all_branches') or public.user_has_branch_access(actor,p_branch_id)) then
  raise exception 'POS_CONTACT_BRANCH_DENIED' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 50 or length(search)>128 then
  raise exception 'POS_CONTACT_FILTER_INVALID' using errcode='22023'; end if;

 if not retail then raise exception 'POS_CONTACT_PERMISSION_DENIED' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(x.payload order by x.rank,x.name,x.id),'[]'::jsonb) from (
  select c.id,coalesce(canonical.name,c.name) name,
   case when search is null then 0 else public.catalog_search_rank(coalesce(canonical.name,c.name),coalesce(canonical.code,c.code),coalesce(canonical.phone,c.phone),search) end rank,
   jsonb_build_object(
    'id',c.id,'code',coalesce(canonical.code,c.code),'name',coalesce(canonical.name,c.name),
    'phone',coalesce(canonical.phone,c.phone),'email',coalesce(canonical.email,c.email),'address',coalesce(canonical.address,c.address),
    'house_number',c.house_number,'street',c.street,'quarter',c.quarter,'ward',c.ward,
    'province',c.province,'country',c.country,'tax_code',c.tax_code,'customer_type',c.customer_type,
    'is_internal',coalesce(p_internal,false),'is_walk_in',c.is_walk_in,
    'branch_id',case when p_internal then coalesce(receiver.branch_id,c.branch_id) else c.branch_id end,
    'group_id',pricing.group_id,'price_tier_id',pricing.price_tier_id,'loyalty_points',pricing.loyalty_points,'loyalty_tier_id',pricing.loyalty_tier_id,
    'customer_groups',case when g.id is null then null else jsonb_build_object('name',g.name,'discount_percent',g.discount_percent) end,
    'loyalty_tiers',case when l.id is null then null else jsonb_build_object('name',l.name,'discount_percent',l.discount_percent) end
   ) payload
  from public.customers c
  left join public.customers canonical on canonical.id=c.canonical_customer_id and canonical.tenant_id=tenant
  left join public.customers receiver on receiver.canonical_customer_id=c.id and receiver.tenant_id=tenant
  left join public.customers pricing on pricing.id=(case when p_internal and receiver.id is not null then receiver.id else c.id end) and pricing.tenant_id=tenant
  left join public.customer_groups g on g.id=pricing.group_id and g.tenant_id=tenant
  left join public.loyalty_tiers l on l.id=pricing.loyalty_tier_id and l.tenant_id=tenant
  where c.tenant_id=tenant and (p_customer_id is null or c.id=p_customer_id)
   and (p_customer_id is not null or (coalesce(c.is_active,true) and (receiver.id is null or receiver.is_active)))
   and (case when coalesce(p_internal,false) then
      (c.is_internal and (c.canonical_customer_id is null or c.id=p_customer_id)) or receiver.id is not null
    else not coalesce(c.is_internal,false) end)
   and (not coalesce(p_internal,false) or coalesce(receiver.branch_id,c.branch_id) is distinct from p_branch_id)
   and (search is null or public.catalog_search_rank(coalesce(canonical.name,c.name),coalesce(canonical.code,c.code),coalesce(canonical.phone,c.phone),search) is not null)
  order by rank,name,c.id limit p_limit
 ) x);
end $function$
;
revoke all on function public.get_pos_retail_customer_contacts_identity(uuid,text,uuid,boolean,integer) from public,anon;
grant execute on function public.get_pos_retail_customer_contacts_identity(uuid,text,uuid,boolean,integer) to authenticated;
CREATE OR REPLACE FUNCTION public._pos_balance_before_identity_20261027(p_customer_id uuid, p_branch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();tenant uuid;allowed boolean;debt numeric;advance numeric;
begin
 select tenant_id into tenant from public.profiles where id=actor and coalesce(is_active,true);
 if tenant is null or not public.user_has_permission(actor,'pos_retail.checkout') then
  raise exception 'POS_BALANCE_DENIED' using errcode='42501';end if;
 if p_customer_id is null or p_branch_id is null then raise exception 'POS_BALANCE_INPUT_INVALID' using errcode='22023';end if;
 if not exists(select 1 from public.branches where id=p_branch_id and tenant_id=tenant)
  or not (public.user_has_permission(actor,'reports.view_all_branches') or public.user_has_branch_access(actor,p_branch_id))
  or not exists(select 1 from public.customers where id=p_customer_id and tenant_id=tenant) then
  raise exception 'POS_BALANCE_DENIED' using errcode='42501';end if;
 allowed:=public.user_has_permission(actor,'customers.view_debt');
 if allowed then
  with invoice_debt as (
   select coalesce(sum(greatest(coalesce(i.debt,0),0)),0) amount from public.invoices i
   where i.tenant_id=tenant and i.branch_id=p_branch_id and i.customer_id=p_customer_id and i.status='completed' and i.deleted_at is null
  ), adjustments as (
   select coalesce(sum(greatest(a.amount,0)),0) debit,coalesce(sum(greatest(-a.amount,0)),0) credit
   from public.customer_debt_adjustments a left join public.cash_transactions c on c.id=a.cash_transaction_id
   where a.tenant_id=tenant and a.branch_id=p_branch_id and a.customer_id=p_customer_id
    and coalesce(c.category,'') not in ('customer_advance','customer_advance_refund')
    and a.idempotency_key not like 'customer-advance-allocation:%'
    and a.idempotency_key not like 'cancel-customer-advance-refund:%'
  ), advances as (
   select coalesce(sum(remaining_amount),0) amount from public.customer_advances
   where tenant_id=tenant and branch_id=p_branch_id and customer_id=p_customer_id and status='active' and remaining_amount>0
  ), opening as (
   select coalesce(sum(greatest(amount,0)),0) debit,coalesce(sum(greatest(-amount,0)),0) credit
   from public.debt_opening_balances where tenant_id=tenant and branch_id=p_branch_id and customer_id=p_customer_id and party_type='customer'
  ) select round(i.amount+a.debit+o.debit,2),round(x.amount+a.credit+o.credit,2) into debt,advance
    from invoice_debt i cross join adjustments a cross join advances x cross join opening o;
 end if;
 return jsonb_build_object('customerId',p_customer_id,'branchId',p_branch_id,'canViewDebt',allowed,
  'debt',debt,'advance',advance,'netBalance',debt-advance);
end $function$
;
revoke all on function public._pos_balance_before_identity_20261027(uuid,uuid) from public,anon,authenticated;
create or replace function public.get_pos_customer_balance_scoped(p_customer_id uuid,p_branch_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb;part jsonb;family uuid[];account uuid;debt numeric;advance numeric;
begin
 r:=public._pos_balance_before_identity_20261027(p_customer_id,p_branch_id);
 if not coalesce((r->>'canViewDebt')::boolean,false) then return r;end if;
 debt:=(r->>'debt')::numeric;advance:=(r->>'advance')::numeric;
 family:=onebiz_identity.family_ids(public.get_user_tenant_id(),p_customer_id);
 foreach account in array family loop if account<>p_customer_id then
  part:=public._pos_balance_before_identity_20261027(account,p_branch_id);
  if not coalesce((part->>'canViewDebt')::boolean,false) then raise exception 'POS_BALANCE_DENIED';end if;
  debt:=debt+(part->>'debt')::numeric;advance:=advance+(part->>'advance')::numeric;
 end if;end loop;
 return r||jsonb_build_object('debt',debt,'advance',advance,'netBalance',debt-advance);
end;$$;
CREATE OR REPLACE FUNCTION public.get_customer_list_workspace(p_page integer DEFAULT 0, p_page_size integer DEFAULT 15, p_search text DEFAULT NULL::text, p_search_field text DEFAULT 'all'::text, p_group_ids uuid[] DEFAULT NULL::uuid[], p_customer_type text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_debt_filter text DEFAULT NULL::text, p_sales_range text DEFAULT NULL::text, p_orders_range text DEFAULT NULL::text, p_last_purchase text DEFAULT NULL::text, p_birthday_month integer DEFAULT NULL::integer, p_tags text[] DEFAULT NULL::text[], p_created_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_to_exclusive timestamp with time zone DEFAULT NULL::timestamp with time zone, p_province text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor         uuid := auth.uid();
  v_tenant        uuid;
  v_search        text := nullif(trim(coalesce(p_search, '')), '');
  v_page          integer := greatest(coalesce(p_page, 0), 0);
  v_page_size     integer := least(greatest(coalesce(p_page_size, 15), 1), 200);
  v_can_view_debt boolean;
  v_view_all      boolean;
  v_result        jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_AUTH_REQUIRED';
  end if;

  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_TENANT_UNKNOWN';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.tenant_id = v_tenant
      and coalesce(p.is_active, true)
  ) then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_PROFILE_INACTIVE';
  end if;

  if not public.user_has_permission(v_actor, 'customers.view') then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_PERMISSION_DENIED';
  end if;

  v_view_all :=
       public.user_has_permission(v_actor, 'reports.view_all_branches')
    or public.user_has_permission(v_actor, 'system.manage_branches');

  if p_branch_id is not null then
    if not exists (
      select 1
      from public.branches b
      where b.id = p_branch_id
        and b.tenant_id = v_tenant
    ) then
      raise exception using errcode = '42501', message = 'CUSTOMER_LIST_BRANCH_NOT_IN_TENANT';
    end if;

    if not v_view_all
       and not public.user_has_branch_access(v_actor, p_branch_id) then
      raise exception using errcode = '42501', message = 'CUSTOMER_LIST_BRANCH_DENIED';
    end if;
  end if;

  v_can_view_debt := public.user_has_permission(v_actor, 'customers.view_debt');
  if not v_can_view_debt and nullif(trim(coalesce(p_debt_filter, '')), '') is not null then
    raise exception using errcode = '42501', message = 'CUSTOMER_LIST_DEBT_PERMISSION_DENIED';
  end if;

  if p_birthday_month is not null and (p_birthday_month < 1 or p_birthday_month > 12) then
    raise exception using errcode = '22023', message = 'CUSTOMER_LIST_BIRTHDAY_MONTH_INVALID';
  end if;

  with invoice_totals as (
    select
      coalesce(ic.canonical_customer_id,ic.id) as customer_id,
      coalesce(sum(i.total), 0)::numeric as actual_total_spent,
      count(*)::bigint as actual_total_orders,
      max(i.created_at) as actual_last_purchase_at
    from public.invoices i join public.customers ic on ic.id=i.customer_id and ic.tenant_id=i.tenant_id
    where i.tenant_id = v_tenant
      and i.status = 'completed'
      and i.deleted_at is null
      and i.customer_id is not null
      and (p_branch_id is null or i.branch_id = p_branch_id)
      and (
        v_view_all
        or p_branch_id is not null
        or i.branch_id in (
          select ab.branch_id
          from public.get_user_accessible_branches(v_actor) ab
        )
      )
    group by coalesce(ic.canonical_customer_id,ic.id)
  ), return_totals as (
    select
      coalesce(rc.canonical_customer_id,rc.id) as customer_id,
      coalesce(sum(sr.total), 0)::numeric as returned_total
    from public.sales_returns sr join public.customers rc on rc.id=sr.customer_id and rc.tenant_id=sr.tenant_id
    where sr.tenant_id = v_tenant
      and sr.status = 'completed'
      and sr.customer_id is not null
      and (p_branch_id is null or sr.branch_id = p_branch_id)
      and (
        v_view_all
        or p_branch_id is not null
        or sr.branch_id in (
          select ab.branch_id
          from public.get_user_accessible_branches(v_actor) ab
        )
      )
    group by coalesce(rc.canonical_customer_id,rc.id)
  ), source_rows as (
    select
      c.*,
      cg.name as group_name,
      cg.discount_percent as group_discount_percent,
      lt.name as loyalty_tier_name,
      lt.discount_percent as loyalty_tier_discount,
      coalesce(it.actual_total_spent, 0)::numeric as actual_total_spent,
      coalesce(it.actual_total_orders, 0)::bigint as actual_total_orders,
      it.actual_last_purchase_at,
      coalesce(rt.returned_total, 0)::numeric as returned_total,
      greatest(
        coalesce(it.actual_total_spent, 0) - coalesce(rt.returned_total, 0),
        0
      )::numeric as net_sales
    from public.customers original
    cross join lateral jsonb_populate_record(null::public.customers,to_jsonb(original)||jsonb_build_object('debt',(
     select coalesce(sum(member.debt),0) from public.customers member where member.tenant_id=original.tenant_id
      and coalesce(member.canonical_customer_id,member.id)=original.id))) c
    left join public.customer_groups cg
      on cg.id = c.group_id
     and cg.tenant_id = v_tenant
    left join public.loyalty_tiers lt
      on lt.id = c.loyalty_tier_id
     and lt.tenant_id = v_tenant
    left join invoice_totals it on it.customer_id = c.id
    left join return_totals rt on rt.customer_id = c.id
    where c.tenant_id = v_tenant
      and not coalesce(c.is_internal, false)
  ), filtered as (
    select s.*
    from source_rows s
    where (
      v_search is null
      or case coalesce(p_search_field, 'all')
        when 'code' then position(lower(v_search) in lower(coalesce(s.code, ''))) > 0
        when 'name' then position(lower(v_search) in lower(coalesce(s.name, ''))) > 0
        when 'phone' then position(lower(v_search) in lower(coalesce(s.phone, ''))) > 0
        else
             position(lower(v_search) in lower(coalesce(s.code, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.name, ''))) > 0
          or position(lower(v_search) in lower(coalesce(s.phone, ''))) > 0
        end
    )
      and (p_group_ids is null or cardinality(p_group_ids) = 0 or s.group_id = any(p_group_ids))
      and (nullif(p_customer_type, '') is null or s.customer_type::text = p_customer_type)
      and (nullif(p_gender, '') is null or s.gender::text = p_gender)
      and (
        nullif(p_debt_filter, '') is null
        or (p_debt_filter = 'has_debt' and s.debt > 0)
        or (p_debt_filter = 'no_debt' and s.debt = 0)
      )
      and (
        nullif(p_sales_range, '') is null
        or (p_sales_range = 'tier_new' and s.actual_total_spent < 1000000)
        or (p_sales_range = 'tier_regular' and s.actual_total_spent >= 1000000 and s.actual_total_spent < 10000000)
        or (p_sales_range = 'tier_loyal' and s.actual_total_spent >= 10000000 and s.actual_total_spent < 50000000)
        or (p_sales_range = 'tier_vip' and s.actual_total_spent >= 50000000)
      )
      and (
        nullif(p_orders_range, '') is null
        or (p_orders_range = 'no_purchase' and s.actual_total_orders = 0)
        or (p_orders_range = 'first_time' and s.actual_total_orders = 1)
        or (p_orders_range = 'occasional' and s.actual_total_orders between 2 and 5)
        or (p_orders_range = 'frequent' and s.actual_total_orders >= 6)
      )
      and (
        nullif(p_last_purchase, '') is null
        or (p_last_purchase = 'never' and s.actual_last_purchase_at is null)
        or (p_last_purchase = 'today' and s.actual_last_purchase_at >= date_trunc('day', current_timestamp))
        or (p_last_purchase = 'week' and s.actual_last_purchase_at >= current_timestamp - interval '7 days')
        or (p_last_purchase = 'month' and s.actual_last_purchase_at >= current_timestamp - interval '30 days')
        or (p_last_purchase = '3months' and s.actual_last_purchase_at >= current_timestamp - interval '90 days')
        or (p_last_purchase = 'churned' and s.actual_last_purchase_at < current_timestamp - interval '90 days')
      )
      and (p_birthday_month is null or extract(month from s.birthday)::integer = p_birthday_month)
      and (p_tags is null or cardinality(p_tags) = 0 or s.tags @> p_tags)
      and (p_created_from is null or s.created_at >= p_created_from)
      and (p_created_to_exclusive is null or s.created_at < p_created_to_exclusive)
      and (nullif(trim(coalesce(p_province, '')), '') is null or s.province = p_province)
  ), ranked as (
    select f.*, row_number() over (order by f.created_at desc, f.id) as row_order
    from filtered f
  ), page_rows as (
    select *
    from ranked
    where row_order > v_page * v_page_size
      and row_order <= (v_page + 1) * v_page_size
    order by row_order
  ), summary as (
    select
      count(*)::bigint as customer_count,
      coalesce(sum(actual_total_spent), 0)::numeric as total_sales,
      coalesce(sum(returned_total), 0)::numeric as total_returns,
      coalesce(sum(net_sales), 0)::numeric as net_sales,
      case when v_can_view_debt then coalesce(sum(debt), 0)::numeric else 0::numeric end as total_debt,
      case when v_can_view_debt then count(*) filter (where debt > 0)::bigint else 0::bigint end as customers_with_debt
    from filtered
  )
  select jsonb_build_object(
    'items', coalesce(
      (
        select jsonb_agg(
          (
            to_jsonb(pr)
            - 'row_order' - 'returned_total' - 'net_sales'
            - 'actual_total_spent' - 'actual_total_orders'
            - 'actual_last_purchase_at'
            - 'group_name' - 'group_discount_percent'
            - 'loyalty_tier_name' - 'loyalty_tier_discount' - 'debt'
          ) || jsonb_build_object(
            'debt', case when v_can_view_debt then pr.debt else 0 end,
            'total_spent', pr.actual_total_spent,
            'total_orders', pr.actual_total_orders,
            'last_purchase_at', pr.actual_last_purchase_at,
            'returned_total', pr.returned_total,
            'customer_groups', case when pr.group_id is null then null else jsonb_build_object(
              'name', pr.group_name,
              'discount_percent', pr.group_discount_percent
            ) end,
            'loyalty_tiers', case when pr.loyalty_tier_id is null then null else jsonb_build_object(
              'name', pr.loyalty_tier_name,
              'discount_percent', pr.loyalty_tier_discount
            ) end
          )
          order by pr.row_order
        )
        from page_rows pr
      ),
      '[]'::jsonb
    ),
    'total', (select customer_count from summary),
    'summary', jsonb_build_object(
      'totalSales', (select total_sales from summary),
      'totalReturns', (select total_returns from summary),
      'netSales', (select net_sales from summary),
      'totalDebt', (select total_debt from summary),
      'customersWithDebt', (select customers_with_debt from summary),
      'canViewDebt', v_can_view_debt
    )
  ) into v_result;

  return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_customer_financial_report(p_from timestamp with time zone, p_to timestamp with time zone, p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid;
begin
 if p_from is null or p_to is null or p_from >= p_to then
  raise exception using errcode='22007', message='REPORT_DATE_RANGE_INVALID';
 end if;
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 select tenant_id into v_tenant from public.profiles
 where id=auth.uid() and coalesce(is_active,true);
 if v_tenant is null then
  raise exception using errcode='42501', message='ACTIVE_PROFILE_REQUIRED';
 end if;
 return (
  with sales as (
   select onebiz_identity.logical_customer(v_tenant,i.customer_id) customer_id, i.id invoice_id, ii.product_id,
    case when invoice_lines.amount > 0
     and i.subtotal-coalesce(i.discount_amount,0) between 0 and invoice_lines.amount
    then ii.total*(i.subtotal-coalesce(i.discount_amount,0))/invoice_lines.amount
    else ii.total end sales_amount,
    ii.quantity*ii.unit_cost sales_cost,
    case when ii.unit_cost is null and ii.quantity<>0 then 1 else 0 end missing,
    coalesce(i.issued_at,i.created_at) document_at
   from public.invoices i
   join public.invoice_items ii on ii.invoice_id=i.id
   join public.products p on p.id=ii.product_id and p.tenant_id=v_tenant
   cross join lateral (select sum(line.total) amount from public.invoice_items line where line.invoice_id=i.id) invoice_lines
   where i.tenant_id=v_tenant and i.status='completed'
    and coalesce(i.issued_at,i.created_at)>=p_from and coalesce(i.issued_at,i.created_at)<p_to
    and (p_branch_id is null or i.branch_id=p_branch_id)
  ), refunds as (
   select onebiz_identity.logical_customer(v_tenant,i.customer_id) customer_id, sr.id return_id, ri.product_id, ri.total return_amount,
    ri.quantity*source.unit_cost return_cost,
    case when source.unit_cost is null and ri.quantity<>0 then 1 else 0 end missing,
    sr.created_at document_at
   from public.sales_returns sr
   join public.return_items ri on ri.return_id=sr.id
   join public.invoices i on i.id=sr.invoice_id and i.tenant_id=v_tenant
   join public.products p on p.id=ri.product_id and p.tenant_id=v_tenant
   left join lateral public.resolve_sales_return_source_line(ri.id) source on true
   where sr.tenant_id=v_tenant and sr.status in ('confirmed','completed')
    and sr.created_at>=p_from and sr.created_at<p_to
    and (p_branch_id is null or sr.branch_id=p_branch_id)
  ), activity as (
   select customer_id,invoice_id,null::uuid return_id,product_id,sales_amount,
    0::numeric return_amount,sales_cost,0::numeric return_cost,missing,document_at from sales
   union all
   select customer_id,null::uuid,return_id,product_id,0,return_amount,0,return_cost,missing,document_at from refunds
  ), grouped as (
   select a.customer_id,coalesce(c.code,'') code,
    coalesce(c.name,case when a.customer_id is null then 'Chưa gắn khách hàng' else 'Khách hàng không còn trong danh mục' end) name,
    count(distinct a.invoice_id) order_count,count(distinct a.return_id) return_count,
    count(distinct a.product_id) product_count,
    sum(a.sales_amount) sales_amount,sum(a.return_amount) return_amount,
    sum(a.sales_amount-a.return_amount) net_revenue,
    case when sum(a.missing)>0 then null::numeric
     else sum(coalesce(a.sales_cost,0)-coalesce(a.return_cost,0)) end cogs,
    sum(a.missing) missing_cost_lines,max(a.document_at) last_activity_at
   from activity a
   left join public.customers c on c.id=a.customer_id and c.tenant_id=v_tenant
   group by a.customer_id,c.code,c.name
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object(
   'gross_profit',g.net_revenue-g.cogs,
   'margin_percent',case when g.net_revenue>0 then (g.net_revenue-g.cogs)*100/g.net_revenue else null end,
   'average_order_value',case when g.order_count>0 then g.sales_amount/g.order_count else null end
  ) order by g.code,g.customer_id nulls last) from grouped g),'[]'::jsonb))
 );
end $function$
;
CREATE OR REPLACE FUNCTION public.get_sku_financial_report(p_from timestamp with time zone, p_to timestamp with time zone, p_branch_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid;
begin
  if p_from is null or p_to is null or p_from>=p_to then
    raise exception using errcode='22007',message='REPORT_DATE_RANGE_INVALID';
  end if;
  perform public.assert_report_access('reports.analytics',p_branch_id);
  perform public.assert_report_access('reports.view_detail',p_branch_id);
  select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
  if v_tenant is null then raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED'; end if;
  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and tenant_id=v_tenant) then
    raise exception using errcode='42501',message='REPORT_CUSTOMER_DENIED';
  end if;
  return (
    with sales as (
      select ii.product_id, coalesce(nullif(ii.unit,''),p.unit,'') as unit, onebiz_identity.logical_customer(v_tenant,i.customer_id) customer_id,
        i.id as invoice_id, ii.quantity as sold_qty,
        case when invoice_lines.amount>0 and i.subtotal-coalesce(i.discount_amount,0) between 0 and invoice_lines.amount
          then ii.total*(i.subtotal-coalesce(i.discount_amount,0))/invoice_lines.amount
          else ii.total end as sales_amount,
        ii.quantity*ii.unit_cost as sales_cost,
        case when ii.unit_cost is null and ii.quantity<>0 then 1 else 0 end as missing,
        coalesce(i.issued_at,i.created_at) as document_at
      from public.invoices i join public.invoice_items ii on ii.invoice_id=i.id
      cross join lateral (select sum(line.total) amount from public.invoice_items line where line.invoice_id=i.id) invoice_lines
      join public.products p on p.id=ii.product_id and p.tenant_id=v_tenant
      where i.tenant_id=v_tenant and i.status='completed'
        and coalesce(i.issued_at,i.created_at)>=p_from and coalesce(i.issued_at,i.created_at)<p_to
        and (p_branch_id is null or i.branch_id=p_branch_id)
    ), refunds as (
      select ri.product_id, coalesce(nullif(ri.unit,''),p.unit,'') as unit, onebiz_identity.logical_customer(v_tenant,i.customer_id) customer_id,
        ri.quantity as returned_qty, ri.total as return_amount,
        ri.quantity*source.unit_cost as return_cost,
        case when source.unit_cost is null and ri.quantity<>0 then 1 else 0 end as missing,
        sr.created_at as document_at
      from public.sales_returns sr join public.return_items ri on ri.return_id=sr.id
      join public.invoices i on i.id=sr.invoice_id and i.tenant_id=v_tenant
      join public.products p on p.id=ri.product_id and p.tenant_id=v_tenant
      left join lateral public.resolve_sales_return_source_line(ri.id) source on true
      where sr.tenant_id=v_tenant and sr.status in ('confirmed','completed')
        and sr.created_at>=p_from and sr.created_at<p_to
        and (p_branch_id is null or sr.branch_id=p_branch_id)
    ), activity as (
      select product_id,unit,customer_id,invoice_id,sold_qty,0::numeric returned_qty,
        sales_amount,0::numeric return_amount,sales_cost,0::numeric return_cost,missing,document_at from sales
      union all
      select product_id,unit,customer_id,null::uuid,0,returned_qty,0,return_amount,0,return_cost,missing,document_at from refunds
    ), grouped as (
      select a.product_id,p.code,p.name,coalesce(cat.name,'Chưa phân loại') category_name,a.unit,
        count(distinct a.invoice_id) order_count, count(distinct a.customer_id) customer_count,
        sum(a.sold_qty) sold_qty,sum(a.returned_qty) returned_qty,
        sum(a.sold_qty-a.returned_qty) net_qty,
        sum(a.sales_amount) sales_amount,sum(a.return_amount) return_amount,
        sum(a.sales_amount-a.return_amount) net_revenue,
        case when sum(a.missing)>0 then null::numeric else sum(coalesce(a.sales_cost,0)-coalesce(a.return_cost,0)) end cogs,
        sum(a.missing) missing_cost_lines,max(a.document_at) last_activity_at
      from activity a join public.products p on p.id=a.product_id and p.tenant_id=v_tenant
      left join public.categories cat on cat.id=p.category_id and cat.tenant_id=v_tenant
      where p_customer_id is null or a.customer_id=onebiz_identity.logical_customer(v_tenant,p_customer_id)
      group by a.product_id,p.code,p.name,cat.name,a.unit
    )
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object(
      'gross_profit',g.net_revenue-g.cogs,
      'margin_percent',case when g.net_revenue>0 then (g.net_revenue-g.cogs)*100/g.net_revenue else null end,
      'average_sale_price',case when g.sold_qty<>0 then g.sales_amount/g.sold_qty else null end
    ) order by g.code,g.unit) from grouped g),'[]'::jsonb),
    'customers',coalesce((select jsonb_agg(to_jsonb(c) order by c.name,c.id) from (
      select distinct cu.id,cu.code,cu.name from activity a
      join public.customers cu on cu.id=a.customer_id and cu.tenant_id=v_tenant
    ) c),'[]'::jsonb))
  );
end $function$
;
CREATE OR REPLACE FUNCTION public._counterparty_balance_before_identity_20261027(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := auth.uid(); v_tenant_id uuid;
begin
  perform public.assert_report_access('reports.analytics', p_branch_id); perform public.assert_report_access('reports.view_detail', p_branch_id);
  select tenant_id into v_tenant_id from public.profiles where id = v_actor and coalesce(is_active, true);
  if v_tenant_id is null then raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE'; end if;
  return jsonb_build_object(
    'customers', (with invoice_debt as (select customer_id, sum(greatest(coalesce(debt,0),0)) amount from public.invoices where tenant_id=v_tenant_id and status='completed' and deleted_at is null and customer_id is not null and (p_branch_id is null or branch_id=p_branch_id) group by customer_id), adjustments as (select a.customer_id, sum(greatest(a.amount,0)) debit, sum(greatest(-a.amount,0)) credit from public.customer_debt_adjustments a left join public.cash_transactions ct on ct.id=a.cash_transaction_id where a.tenant_id=v_tenant_id and (p_branch_id is null or a.branch_id=p_branch_id) and coalesce(ct.category,'') not in ('customer_advance','customer_advance_refund') and a.idempotency_key not like 'customer-advance-allocation:%' and a.idempotency_key not like 'cancel-customer-advance-refund:%' group by a.customer_id), advances as (select customer_id,sum(remaining_amount) amount from public.customer_advances where tenant_id=v_tenant_id and status='active' and remaining_amount>0 and (p_branch_id is null or branch_id=p_branch_id) group by customer_id), opening as (select customer_id,sum(greatest(amount,0)) debit,sum(greatest(-amount,0)) credit from public.debt_opening_balances where tenant_id=v_tenant_id and party_type='customer' and (p_branch_id is null or branch_id=p_branch_id) group by customer_id) select coalesce(jsonb_agg(jsonb_build_object('party_id',c.id,'debt',round(coalesce(i.amount,0)+coalesce(a.debit,0)+coalesce(o.debit,0),2),'advance',round(coalesce(x.amount,0)+coalesce(a.credit,0)+coalesce(o.credit,0),2)) order by c.name),'[]'::jsonb) from public.customers c left join invoice_debt i on i.customer_id=c.id left join adjustments a on a.customer_id=c.id left join advances x on x.customer_id=c.id left join opening o on o.customer_id=c.id where c.tenant_id=v_tenant_id and (coalesce(i.amount,0)+coalesce(a.debit,0)+coalesce(o.debit,0)+coalesce(x.amount,0)+coalesce(a.credit,0)+coalesce(o.credit,0))>0.01),
    'suppliers', (with purchase_debt as (select supplier_id,sum(greatest(coalesce(debt,0),0)) amount from public.purchase_orders where tenant_id=v_tenant_id and status in ('completed','partial') and supplier_id is not null and (p_branch_id is null or branch_id=p_branch_id) group by supplier_id), advances as (select supplier_id,sum(remaining_amount) amount from public.supplier_advances where tenant_id=v_tenant_id and status='active' and remaining_amount>0 and (p_branch_id is null or branch_id=p_branch_id) group by supplier_id), opening as (select supplier_id,sum(greatest(amount,0)) debit,sum(greatest(-amount,0)) credit from public.debt_opening_balances where tenant_id=v_tenant_id and party_type='supplier' and (p_branch_id is null or branch_id=p_branch_id) group by supplier_id) select coalesce(jsonb_agg(jsonb_build_object('party_id',s.id,'debt',round(coalesce(p.amount,0)+coalesce(o.debit,0),2),'advance',round(coalesce(a.amount,0)+coalesce(o.credit,0),2)) order by s.name),'[]'::jsonb) from public.suppliers s left join purchase_debt p on p.supplier_id=s.id left join advances a on a.supplier_id=s.id left join opening o on o.supplier_id=s.id where s.tenant_id=v_tenant_id and (coalesce(p.amount,0)+coalesce(o.debit,0)+coalesce(a.amount,0)+coalesce(o.credit,0))>0.01)
  );
end; $function$
;
revoke all on function public._counterparty_balance_before_identity_20261027(uuid) from public,anon,authenticated;
create or replace function public.get_counterparty_balance_summary(p_branch_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;tenant uuid; customers jsonb;
begin
 r:=public._counterparty_balance_before_identity_20261027(p_branch_id);tenant:=public.get_user_tenant_id();
 select coalesce(jsonb_agg(jsonb_build_object('party_id',g.party_id,'debt',g.debt,'advance',g.advance) order by g.party_id),'[]'::jsonb) into customers
 from(select coalesce(c.canonical_customer_id::text,c.id::text,e->>'party_id') party_id,sum((e->>'debt')::numeric) debt,sum((e->>'advance')::numeric) advance
  from jsonb_array_elements(r->'customers') e left join public.customers c on c.id::text=e->>'party_id' and c.tenant_id=tenant group by 1) g;
 return jsonb_set(r,'{customers}',customers);
end;$$;
CREATE OR REPLACE FUNCTION public.get_counterparty_open_debt_aging(p_branch_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant_id uuid; v_result jsonb;
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);
  select tenant_id into v_tenant_id from public.profiles
  where id = auth.uid() and coalesce(is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE';
  end if;

  with first_receipt as (
    select reference_id, min(created_at) received_at
    from public.stock_movements
    where tenant_id = v_tenant_id and reference_type = 'purchase_order' and type = 'in'
      and (p_branch_id is null or branch_id = p_branch_id)
    group by reference_id
  ), documents as (
    select 'customer'::text party_type, onebiz_identity.logical_customer(v_tenant_id,i.customer_id) party_id,
      onebiz_identity.customer_label(v_tenant_id,i.customer_id,coalesce(nullif(trim(i.customer_name), ''), 'Khách lẻ')) party_name,
      i.debt amount, coalesce(i.ngay_chung_tu, i.created_at) debt_date
    from public.invoices i
    where i.tenant_id = v_tenant_id and i.status = 'completed'
      and i.deleted_at is null and i.debt > 0
      and (p_branch_id is null or i.branch_id = p_branch_id)
    union all
    select 'supplier', p.supplier_id, s.name, p.debt, coalesce(r.received_at, p.created_at)
    from public.purchase_orders p
    join public.suppliers s on s.id = p.supplier_id and s.tenant_id = p.tenant_id
    left join first_receipt r on r.reference_id = p.id
    where p.tenant_id = v_tenant_id and p.status in ('completed', 'partial') and p.debt > 0
      and (p_branch_id is null or p.branch_id = p_branch_id)
    union all
    select o.party_type, case when o.party_type='customer' then onebiz_identity.logical_customer(v_tenant_id,o.customer_id) else o.supplier_id end,
      case when o.party_type='customer' then onebiz_identity.customer_label(v_tenant_id,o.customer_id,c.name) else s.name end, o.amount,
      o.opening_date::timestamp at time zone 'Asia/Ho_Chi_Minh'
    from public.debt_opening_balances o
    left join public.customers c on c.id = o.customer_id and c.tenant_id = o.tenant_id
    left join public.suppliers s on s.id = o.supplier_id and s.tenant_id = o.tenant_id
    where o.tenant_id = v_tenant_id and o.amount > 0
      and (p_branch_id is null or o.branch_id = p_branch_id)
    union all
    select 'customer', onebiz_identity.logical_customer(v_tenant_id,a.customer_id), onebiz_identity.customer_label(v_tenant_id,a.customer_id,c.name), a.amount, a.created_at
    from public.customer_debt_adjustments a
    join public.customers c on c.id = a.customer_id and c.tenant_id = a.tenant_id
    left join public.cash_transactions ct on ct.id = a.cash_transaction_id and ct.tenant_id = a.tenant_id
    where a.tenant_id = v_tenant_id and a.amount > 0
      and coalesce(ct.category, '') not in ('customer_advance','customer_advance_refund')
      and a.idempotency_key not like 'customer-advance-allocation:%'
      and (p_branch_id is null or a.branch_id = p_branch_id)
  ), aged as (
    select *, greatest(0, (now() at time zone 'Asia/Ho_Chi_Minh')::date
      - (debt_date at time zone 'Asia/Ho_Chi_Minh')::date) days_old
    from documents
  ), grouped as (
    select party_type,
      coalesce(party_id::text, 'walk-in:' || party_name) party_id,
      max(party_name) party_name, count(*)::int document_count,
      sum(amount) outstanding, max(days_old) oldest_days, min(debt_date) oldest_date,
      coalesce(sum(amount) filter (where days_old <= 30), 0) bucket_0_30,
      coalesce(sum(amount) filter (where days_old between 31 and 60), 0) bucket_31_60,
      coalesce(sum(amount) filter (where days_old between 61 and 90), 0) bucket_61_90,
      coalesce(sum(amount) filter (where days_old > 90), 0) bucket_91_plus
    from aged group by party_type, coalesce(party_id::text, 'walk-in:' || party_name)
  )
  select jsonb_build_object('generated_at', now(),
    'customers', coalesce(jsonb_agg(to_jsonb(g) order by outstanding desc, party_id)
      filter (where party_type = 'customer'), '[]'::jsonb),
    'suppliers', coalesce(jsonb_agg(to_jsonb(g) order by outstanding desc, party_id)
      filter (where party_type = 'supplier'), '[]'::jsonb)) into v_result
  from grouped g;
  return v_result;
end; $function$
;
CREATE OR REPLACE FUNCTION public.get_receivable_aging_report(p_branch_id uuid DEFAULT NULL::uuid, p_as_of_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_as_of timestamptz := coalesce(p_as_of_date, now());
begin
  perform public.assert_report_access('reports.analytics', p_branch_id);
  perform public.assert_report_access('reports.view_detail', p_branch_id);

  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.id = v_actor and coalesce(p.is_active, true);
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
          onebiz_identity.logical_customer(v_tenant_id,i.customer_id) as customer_id,
          onebiz_identity.customer_label(v_tenant_id,i.customer_id,coalesce(nullif(trim(i.customer_name), ''), 'Khách lẻ')) as customer_name,
          greatest(coalesce(i.debt, 0), 0) as outstanding,
          i.created_at as debt_date
        from public.invoices i
        where i.tenant_id = v_tenant_id
          and i.status = 'completed'
          and i.deleted_at is null
          and coalesce(i.debt, 0) > 0
          and i.created_at <= v_as_of
          and (p_branch_id is null or i.branch_id = p_branch_id)

        union all

        select
          onebiz_identity.logical_customer(v_tenant_id,o.customer_id) as customer_id,
          onebiz_identity.customer_label(v_tenant_id,o.customer_id,c.name),
          o.amount,
          (o.opening_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
        from public.debt_opening_balances o
        join public.customers c on c.id = o.customer_id
        where o.tenant_id = v_tenant_id
          and o.party_type = 'customer'
          and o.amount <> 0
          and o.opening_date <= v_as_of::date
          and (
            (p_branch_id is null)
            or o.branch_id = p_branch_id
          )

        union all

        select
          onebiz_identity.logical_customer(v_tenant_id,a.customer_id) as customer_id,
          onebiz_identity.customer_label(v_tenant_id,a.customer_id,c.name),
          a.amount,
          a.created_at
        from public.customer_debt_adjustments a
        join public.customers c on c.id = a.customer_id
        left join public.invoices ai on ai.id = a.invoice_id
        where a.tenant_id = v_tenant_id
          and a.amount <> 0
          and a.created_at <= v_as_of
          and (
            p_branch_id is null
            or ai.branch_id = p_branch_id
          )
      ),
      aged as (
        select
          d.*,
          greatest(
            0, floor(extract(epoch from (v_as_of - d.debt_date)) / 86400)::int
          ) as days_old
        from debt_documents d
      )
      select coalesce(
        jsonb_agg(to_jsonb(t) order by t.outstanding desc, t.customer_name),
        '[]'::jsonb
      )
      from (
        select
          coalesce(customer_id::text, 'walk-in:' || md5(customer_name)) as customer_id,
          customer_name,
          count(*) filter (where outstanding <> 0)::int as invoice_count,
          sum(outstanding) as outstanding,
          sum(outstanding) filter (where days_old <= 30) as bucket_0_30,
          sum(outstanding) filter (where days_old between 31 and 60) as bucket_31_60,
          sum(outstanding) filter (where days_old between 61 and 90) as bucket_61_90,
          sum(outstanding) filter (where days_old > 90) as bucket_91_plus,
          max(days_old)::int as oldest_days,
          min(debt_date) as oldest_invoice_date
        from aged
        group by customer_id, customer_name
        having sum(outstanding) > 0.01
      ) t
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_party_debt_movements(p_mode text, p_party_id uuid, p_branch_id uuid, p_from date, p_to date, p_page integer DEFAULT 0, p_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid; v_balance jsonb; v_current numeric; v_result jsonb;
begin
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if v_tenant is null or p_branch_id is null or not public.user_has_branch_access(auth.uid(),p_branch_id)
  or not public.user_has_permission(auth.uid(),'finance.view_cash_book')
  or not public.user_has_permission(auth.uid(),case p_mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end) then
  raise exception 'DEBT_MOVEMENT_DENIED' using errcode='42501'; end if;
 if p_mode is null or p_mode not in ('customer','supplier') or p_party_id is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to
  or p_page is null or p_page<0 or p_size is null or p_size not between 1 and 200 then raise exception 'DEBT_MOVEMENT_FILTER_INVALID' using errcode='22023'; end if;
 if not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant)
  or (p_mode='customer' and not exists(select 1 from public.customers where id=p_party_id and tenant_id=v_tenant))
  or (p_mode='supplier' and not exists(select 1 from public.suppliers where id=p_party_id and tenant_id=v_tenant)) then raise exception 'DEBT_PARTY_DENIED' using errcode='42501'; end if;
 v_balance:=public.get_counterparty_balance_summary(p_branch_id);
 select coalesce((entry->>'debt')::numeric,0)-coalesce((entry->>'advance')::numeric,0) into v_current
 from jsonb_array_elements(v_balance->(case p_mode when 'customer' then 'customers' else 'suppliers' end)) entry where entry->>'party_id'=(case p_mode when 'customer' then onebiz_identity.logical_customer(v_tenant,p_party_id) else p_party_id end)::text;
 v_current:=coalesce(v_current,0);
 with source as (
  select 'invoice:'||i.id as key,i.id,'invoice'::text as kind,i.code,
   (coalesce(i.issued_at,i.created_at) at time zone 'Asia/Ho_Chi_Minh')::date as date,i.created_at,i.status,
   i.total as amount,case when i.status='completed' and i.deleted_at is null then i.total else 0 end as delta,coalesce(i.note,'') as note,false as unmapped
  from public.invoices i where p_mode='customer' and i.tenant_id=v_tenant and i.branch_id=p_branch_id and i.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
  union all
  select 'purchase_order:'||po.id,po.id,'purchase_order',po.code,(po.created_at at time zone 'Asia/Ho_Chi_Minh')::date,po.created_at,po.status,
   po.total,case when po.status in ('completed','partial') then po.total else 0 end,coalesce(po.note,''),po.status='partial'
  from public.purchase_orders po where p_mode='supplier' and po.tenant_id=v_tenant and po.branch_id=p_branch_id and po.supplier_id=p_party_id
  union all
  select 'sales_return:'||r.id,r.id,'sales_return',r.code,(r.created_at at time zone 'Asia/Ho_Chi_Minh')::date,r.created_at,r.status,r.total,
   case when r.status in ('confirmed','completed') then -r.total else 0 end,coalesce(r.note,''),false
  from public.sales_returns r where p_mode='customer' and r.tenant_id=v_tenant and r.branch_id=p_branch_id and r.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
  union all
  select 'supplier_return:'||r.id,r.id,'supplier_return',r.code,(r.created_at at time zone 'Asia/Ho_Chi_Minh')::date,r.created_at,r.status,r.total,
   case when r.status='completed' then -r.total else 0 end,coalesce(r.note,''),false
  from public.supplier_returns r where p_mode='supplier' and r.tenant_id=v_tenant and r.branch_id=p_branch_id and r.supplier_id=p_party_id
  union all
  select 'opening:'||o.id,o.id,'opening','Đầu kỳ',(o.opening_date),o.created_at,'completed',abs(o.amount),o.amount,coalesce(o.note,''),false
  from public.debt_opening_balances o where o.tenant_id=v_tenant and o.branch_id=p_branch_id and o.party_type=p_mode
   and (case p_mode when 'customer' then onebiz_identity.logical_customer(v_tenant,o.customer_id) else o.supplier_id end)=(case p_mode when 'customer' then onebiz_identity.logical_customer(v_tenant,p_party_id) else p_party_id end)
  union all
  select 'adjustment:'||a.id,a.id,'adjustment','Điều chỉnh',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',abs(a.amount),a.amount,a.reason,false
  from public.customer_debt_adjustments a where p_mode='customer' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and a.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
   and a.cash_transaction_id is null and coalesce(a.idempotency_key,'') not like 'sales-return-credit:%'
   and coalesce(a.idempotency_key,'') not like 'customer-advance-%' and coalesce(a.idempotency_key,'') not like 'cancel-customer-advance:%' and coalesce(a.idempotency_key,'') not like 'cancel-customer-advance-refund:%'
  union all
  select 'cash:'||c.id,c.id,'cash',c.code,c.transaction_date,c.created_at,coalesce(c.status,'completed'),c.amount,
   case when coalesce(c.status,'completed')='completed' and (c.reference_type in ('invoice','invoice_void','sales_return','return','purchase_order','supplier_return') or c.category in ('customer_advance','supplier_advance','customer_advance_refund','supplier_advance_refund'))
    then c.amount*(case when (p_mode='customer' and c.type='receipt') or (p_mode='supplier' and c.type='payment') then -1 else 1 end) else 0 end,
   coalesce(c.note,''),coalesce(c.status,'completed')='completed' and not (coalesce(c.reference_type,'') in ('invoice','invoice_void','sales_return','return','purchase_order','supplier_return') or c.category in ('customer_advance','supplier_advance','customer_advance_refund','supplier_advance_refund'))
  from public.cash_transactions c where c.tenant_id=v_tenant and c.branch_id=p_branch_id and (
   (p_mode='customer' and (c.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id)) or exists(select 1 from public.invoices i where i.id=c.reference_id and c.reference_type in ('invoice','invoice_void') and i.tenant_id=v_tenant and i.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id)))
    or exists(select 1 from public.sales_returns r where r.id=c.reference_id and c.reference_type in ('sales_return','return') and r.tenant_id=v_tenant and r.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id)))))
   or (p_mode='supplier' and (c.supplier_id=p_party_id or exists(select 1 from public.purchase_orders po where po.id=c.reference_id and c.reference_type='purchase_order' and po.tenant_id=v_tenant and po.supplier_id=p_party_id)
    or exists(select 1 from public.supplier_returns r where r.id=c.reference_id and c.reference_type='supplier_return' and r.tenant_id=v_tenant and r.supplier_id=p_party_id))))
  union all
  select 'allocation:'||a.id,a.id,'allocation','Cấn ứng trước',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',a.amount,0,a.note,false
  from public.customer_advance_allocations a join public.invoices i on i.id=a.invoice_id and i.tenant_id=a.tenant_id
  where p_mode='customer' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and i.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
  union all
  select 'allocation:'||a.id,a.id,'allocation','Cấn ứng trước',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',a.amount,0,a.note,false
  from public.supplier_advance_allocations a join public.purchase_orders po on po.id=a.purchase_order_id and po.tenant_id=a.tenant_id
  where p_mode='supplier' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and po.supplier_id=p_party_id
 ), running as (
  select source.*,sum(delta) over(order by date,created_at,key rows unbounded preceding) as balance from source
 ), filtered as(select * from running where date between p_from and p_to)
 select jsonb_build_object('basis','current_effective_documents','current_net',v_current,
  'difference',v_current-coalesce((select sum(delta) from source),0),
  'unmapped',(select count(*) from source where unmapped),
  'opening',coalesce((select sum(delta) from source where date<p_from),0),
  'increase',coalesce((select sum(greatest(delta,0)) from filtered),0),
  'decrease',coalesce((select sum(greatest(-delta,0)) from filtered),0),
  'closing',coalesce((select sum(delta) from source where date<=p_to),0),
  'total',(select count(*) from filtered),
  'items',coalesce((select jsonb_agg(to_jsonb(r) order by date,created_at,key) from (select * from filtered order by date,created_at,key offset p_page::bigint*p_size limit p_size) r),'[]'::jsonb)) into v_result;
 return v_result;
end; $function$
;
CREATE OR REPLACE FUNCTION public.settle_party_documents_atomic(p_request_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t uuid; b uuid; party uuid; mode text; source text; prior public.party_settlement_requests%rowtype;
 line jsonb; d record; amount numeric; operation text; result jsonb; results jsonb:='[]'; v_document_id uuid; v_code text; v_note text;
begin
 select tenant_id into t from public.profiles where id=auth.uid() and coalesce(is_active,true);
 mode:=p_payload->>'mode';source:=p_payload->>'source';b:=(p_payload->>'branchId')::uuid;party:=(p_payload->>'partyId')::uuid;
 if t is null or not coalesce(public.user_has_permission(auth.uid(),'finance.create_transaction'),false)
  or not coalesce(public.user_has_permission(auth.uid(),case when mode='customer' then 'customers.view_debt' else 'suppliers.view_debt' end),false)
  or not exists(select 1 from public.branches where id=b and tenant_id=t)
  or not coalesce(public.user_has_branch_access(auth.uid(),b),false) then raise exception 'PARTY_SETTLEMENT_DENIED' using errcode='42501'; end if;
 if p_request_id is null or mode is null or mode not in ('customer','supplier') or source is null or source not in ('cash','advance')
  or jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 500
  or length(btrim(coalesce(p_payload->>'note','')))<3 then raise exception 'PARTY_SETTLEMENT_INPUT_INVALID' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||p_request_id::text,554));
 select * into prior from public.party_settlement_requests where tenant_id=t and request_id=p_request_id;
 if found then
  if prior.payload is distinct from p_payload or prior.created_by<>auth.uid() then raise exception 'PARTY_SETTLEMENT_REQUEST_REUSED' using errcode='PT409'; end if;
  return prior.result||jsonb_build_object('idempotent',true);
 end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_payload->'lines') x)<>jsonb_array_length(p_payload->'lines') then raise exception 'PARTY_SETTLEMENT_DUPLICATE_DOCUMENT' using errcode='22023'; end if;
 -- Lock documents in stable UUID order, independent of presentation/FIFO order.
 for line in select x from jsonb_array_elements(p_payload->'lines') x order by x->>'id' loop
  v_document_id:=(line->>'id')::uuid;amount:=(line->>'amount')::numeric;
  if amount is null or amount::text in ('NaN','Infinity','-Infinity') or amount<=0 or amount>9999999999999.99 or amount<>round(amount,2) then raise exception 'PARTY_SETTLEMENT_AMOUNT_INVALID' using errcode='22023'; end if;
  if mode='supplier' then
   select po.id,po.code,po.debt into d from public.purchase_orders po where po.id=v_document_id and po.tenant_id=t and po.branch_id=b and po.supplier_id=party and po.status in ('partial','completed') for update;
  else
   select i.id,i.code,i.debt into d from public.invoices i where i.id=v_document_id and i.tenant_id=t and i.branch_id=b and i.customer_id=any(onebiz_identity.family_ids(t,party)) and i.status='completed' for update;
  end if;
  if not found or coalesce(d.debt,0)<=0 then raise exception 'PARTY_SETTLEMENT_DOCUMENT_CHANGED_RELOAD' using errcode='PT409'; end if;
 end loop;
 for line in select x from jsonb_array_elements(p_payload->'lines') x loop
  v_document_id:=(line->>'id')::uuid;amount:=(line->>'amount')::numeric;
  if mode='supplier' then select po.code into v_code from public.purchase_orders po where po.id=v_document_id and po.tenant_id=t;
  else select i.code into v_code from public.invoices i where i.id=v_document_id and i.tenant_id=t; end if;
  v_note:=btrim(p_payload->>'note')||' · '||v_code;
  if source='advance' then
   if mode='supplier' then result:=public.apply_supplier_advance_to_purchase_order(v_document_id,amount,v_note);
   else result:=public.apply_customer_advance_to_invoice(v_document_id,amount,v_note); end if;
  else
   operation:=case when mode='supplier' then 'purchase_order' else 'invoice' end;
   if nullif(p_payload->>'moneyAccountId','') is not null then
    result:=public.record_cash_with_account(operation,jsonb_build_object('referenceId',v_document_id,'amount',amount,'paymentMethod',p_payload->>'paymentMethod','note',v_note),
     (p_payload->>'moneyAccountId')::uuid,null,nullif(p_payload->>'occurredAt','')::timestamptz,(p_payload->>'transactionDate')::date,p_payload->>'timeReason');
   else result:=public.record_cash_transaction_timed(operation,jsonb_build_object('referenceId',v_document_id,'amount',amount,'paymentMethod',p_payload->>'paymentMethod','note',v_note),
    nullif(p_payload->>'occurredAt','')::timestamptz,(p_payload->>'transactionDate')::date,p_payload->>'timeReason'); end if;
  end if;
  results:=results||jsonb_build_array(result||jsonb_build_object('document_id',v_document_id));
 end loop;
 result:=jsonb_build_object('documents',results,'source',source,'idempotent',false);
 insert into public.party_settlement_requests(tenant_id,request_id,branch_id,payload,result,created_by) values(t,p_request_id,b,p_payload,result,auth.uid());
 return result;
end; $function$
;
CREATE OR REPLACE FUNCTION public.apply_customer_advance_to_invoice(p_invoice_id uuid, p_amount numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid(); v_tenant_id uuid; v_invoice record; v_requested numeric(15,2); v_available numeric(15,2); v_remaining numeric(15,2); v_take numeric(15,2); v_applied numeric(15,2) := 0;
  v_advance record; v_adjustment_id uuid; v_allocation_id uuid; v_note text := nullif(trim(coalesce(p_note, '')), ''); v_items jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'UNAUTHENTICATED'; end if;
  select tenant_id into v_tenant_id from public.profiles where id = v_actor and coalesce(is_active, true);
  if v_tenant_id is null then raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED'; end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION'; end if;
  select i.id, i.tenant_id, i.branch_id, i.code, i.customer_id, i.debt, i.paid, i.total, i.status into v_invoice from public.invoices i where i.id = p_invoice_id and i.tenant_id = v_tenant_id for update;
  if not found then raise exception using errcode = '22023', message = 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.customer_id is null or v_invoice.status <> 'completed' or coalesce(v_invoice.debt, 0) <= 0 then raise exception using errcode = '22023', message = 'INVOICE_NOT_APPLICABLE'; end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED'; end if;
  if v_note is null or length(v_note) < 3 then raise exception using errcode = '22023', message = 'ADVANCE_ALLOCATION_NOTE_REQUIRED'; end if;
  select coalesce(sum(remaining_amount), 0) into v_available from public.customer_advances where tenant_id = v_tenant_id and branch_id = v_invoice.branch_id and customer_id = any(onebiz_identity.family_ids(v_tenant_id,v_invoice.customer_id)) and status = 'active' and remaining_amount > 0;
  v_requested := round(coalesce(p_amount, least(v_invoice.debt, v_available)), 2);
  if v_requested <= 0 or v_requested > v_invoice.debt or v_requested > v_available then raise exception using errcode = '22023', message = 'CUSTOMER_ADVANCE_ALLOCATION_AMOUNT_INVALID'; end if;
  v_remaining := v_requested;
  for v_advance in select * from public.customer_advances where tenant_id = v_tenant_id and branch_id = v_invoice.branch_id and customer_id = any(onebiz_identity.family_ids(v_tenant_id,v_invoice.customer_id)) and status = 'active' and remaining_amount > 0 order by created_at, id for update loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_advance.remaining_amount);
    insert into public.customer_debt_adjustments (tenant_id, branch_id, customer_id, invoice_id, amount, reason, idempotency_key, created_by) values (v_tenant_id, v_invoice.branch_id, v_invoice.customer_id, v_invoice.id, v_take, 'Cấn tiền khách trả trước: ' || v_note, 'customer-advance-allocation:' || v_advance.id::text || ':' || v_invoice.id::text || ':' || v_take::text || ':' || gen_random_uuid()::text, v_actor) returning id into v_adjustment_id;
    insert into public.customer_advance_allocations (tenant_id, branch_id, customer_advance_id, invoice_id, adjustment_id, amount, note, created_by) values (v_tenant_id, v_invoice.branch_id, v_advance.id, v_invoice.id, v_adjustment_id, v_take, v_note, v_actor) returning id into v_allocation_id;
    update public.customer_advances set remaining_amount = remaining_amount - v_take, status = case when remaining_amount - v_take <= 0 then 'exhausted' else 'active' end, updated_at = now() where id = v_advance.id;
    v_items := v_items || jsonb_build_array(jsonb_build_object('advance_id', v_advance.id, 'allocation_id', v_allocation_id, 'amount', v_take));
    v_remaining := v_remaining - v_take; v_applied := v_applied + v_take;
  end loop;
  if v_remaining <> 0 then raise exception using errcode = 'P0001', message = 'CUSTOMER_ADVANCE_ALLOCATION_INCOMPLETE'; end if;
  update public.invoices set paid = round(coalesce(paid, 0) + v_applied, 2), debt = greatest(0, round(coalesce(debt, 0) - v_applied, 2)), updated_at = now() where id = v_invoice.id and tenant_id = v_tenant_id;
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data) values (v_tenant_id, v_actor, 'customer_advance_applied', 'invoice', v_invoice.id, jsonb_build_object('amount', v_applied, 'note', v_note, 'allocations', v_items));
  return jsonb_build_object('invoice_id', v_invoice.id, 'invoice_code', v_invoice.code, 'applied_amount', v_applied, 'remaining_debt', greatest(0, round(v_invoice.debt - v_applied, 2)), 'allocations', v_items);
end; $function$
;
commit;
