-- 00387: Opt-in catalog enforcement for F&B supply branches.
--
-- Default is deliberately OFF. This migration does not write products, BOMs,
-- prices, stock, inventory movements, invoices, input invoices or cash data.
-- A branch must be a store, have at least one catalog item, and be explicitly
-- enabled by an administrator before internal sales to that branch are checked.

begin;

create table public.fnb_supply_branch_scopes (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  enforcement_enabled boolean not null default false,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  note text,
  primary key (tenant_id, branch_id)
);

create table public.fnb_supply_branch_scope_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  enforcement_enabled boolean not null,
  note text,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index fnb_supply_branch_scope_audit_branch_created_idx
  on public.fnb_supply_branch_scope_audit(tenant_id, branch_id, created_at desc);

alter table public.fnb_supply_branch_scopes enable row level security;
alter table public.fnb_supply_branch_scope_audit enable row level security;

create policy fnb_supply_branch_scopes_read on public.fnb_supply_branch_scopes
  for select to authenticated
  using (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'products.view')
    and public.user_has_branch_access(auth.uid(), branch_id)
  );

create policy fnb_supply_branch_scope_audit_read on public.fnb_supply_branch_scope_audit
  for select to authenticated
  using (
    tenant_id = public.get_user_tenant_id()
    and public.user_has_permission(auth.uid(), 'products.edit')
    and public.user_has_permission(auth.uid(), 'system.manage_branches')
    and public.user_has_branch_access(auth.uid(), branch_id)
  );

revoke all on public.fnb_supply_branch_scopes, public.fnb_supply_branch_scope_audit
  from public, anon, authenticated;
grant select on public.fnb_supply_branch_scopes, public.fnb_supply_branch_scope_audit
  to authenticated;

create function public.set_fnb_supply_branch_enforcement(
  p_branch_id uuid,
  p_enabled boolean,
  p_note text default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_branch_type text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select tenant_id into v_tenant
    from public.profiles
   where id = v_actor and is_active;

  if v_tenant is null
    or not public.user_has_permission(v_actor, 'products.edit')
    or not public.user_has_permission(v_actor, 'system.manage_branches') then
    raise exception using errcode = '42501', message = 'FNB_SUPPLY_PERMISSION_DENIED';
  end if;

  if p_branch_id is null or p_enabled is null then
    raise exception 'FNB_SUPPLY_SCOPE_INPUT_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fnb-supply:' || v_tenant::text, 0));

  select branch_type into v_branch_type
    from public.branches
   where id = p_branch_id
     and tenant_id = v_tenant
     and is_active
     and public.user_has_branch_access(v_actor, id)
   for update;

  if not found then
    raise exception using errcode = '42501', message = 'FNB_SUPPLY_BRANCH_DENIED';
  end if;
  if v_branch_type is distinct from 'store' then
    raise exception 'FNB_SUPPLY_STORE_REQUIRED';
  end if;
  if p_enabled and not exists (
    select 1
      from public.fnb_supply_catalog c
     where c.tenant_id = v_tenant and c.branch_id = p_branch_id
  ) then
    raise exception 'FNB_SUPPLY_CATALOG_EMPTY';
  end if;

  insert into public.fnb_supply_branch_scopes(
    tenant_id, branch_id, enforcement_enabled, updated_by, updated_at, note
  ) values (
    v_tenant, p_branch_id, p_enabled, v_actor, now(), v_note
  ) on conflict (tenant_id, branch_id) do update set
    enforcement_enabled = excluded.enforcement_enabled,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at,
    note = excluded.note;

  insert into public.fnb_supply_branch_scope_audit(
    tenant_id, branch_id, enforcement_enabled, note, actor_id
  ) values (v_tenant, p_branch_id, p_enabled, v_note, v_actor);

  return p_enabled;
end;
$function$;

alter function public.set_fnb_supply_branch_enforcement(uuid, boolean, text)
  owner to postgres;
revoke all on function public.set_fnb_supply_branch_enforcement(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.set_fnb_supply_branch_enforcement(uuid, boolean, text)
  to authenticated;

-- Preserve the current atomic workflow: validate the opt-in catalog first,
-- then call the existing private implementation and reconcile both branches.
create or replace function public.create_internal_sale_atomic(
  p_tenant_id uuid,
  p_from_branch_id uuid,
  p_to_branch_id uuid,
  p_created_by uuid,
  p_int_customer_id uuid,
  p_int_customer_name text,
  p_int_supplier_id uuid,
  p_int_supplier_name text,
  p_items jsonb,
  p_payment_method text default 'transfer',
  p_paid_full boolean default true,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_service_role boolean :=
    coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
  v_actor uuid := case when v_is_service_role then p_created_by else auth.uid() end;
  v_tenant_id uuid;
  v_invoice_id uuid;
  v_input_invoice_id uuid;
  v_pair record;
  v_result jsonb;
begin
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);

  if v_tenant_id is not null
    and jsonb_typeof(p_items) = 'array'
    and exists (
      select 1 from public.fnb_supply_branch_scopes s
       where s.tenant_id = v_tenant_id
         and s.branch_id = p_to_branch_id
         and s.enforcement_enabled
    ) then
    perform pg_advisory_xact_lock(hashtextextended('fnb-supply:' || v_tenant_id::text, 0));

    if exists (
      select 1
        from jsonb_array_elements(p_items) i
       where nullif(i->>'productId', '') is null
          or not exists (
            select 1 from public.fnb_supply_catalog c
             where c.tenant_id = v_tenant_id
               and c.branch_id = p_to_branch_id
               and c.product_id = (i->>'productId')::uuid
          )
    ) then
      raise exception using errcode = '23514', message = 'FNB_SUPPLY_CATALOG_REQUIRED';
    end if;
  end if;

  v_result := public._create_internal_sale_auth_impl_00243(
    p_tenant_id, p_from_branch_id, p_to_branch_id, p_created_by,
    p_int_customer_id, p_int_customer_name, p_int_supplier_id,
    p_int_supplier_name, p_items, p_payment_method, p_paid_full, p_note
  );

  v_invoice_id := (v_result->>'invoice_id')::uuid;
  v_input_invoice_id := (v_result->>'input_invoice_id')::uuid;
  select s.tenant_id into v_tenant_id
    from public.internal_sales s
   where s.id = (v_result->>'internal_sale_id')::uuid;

  for v_pair in
    select distinct sm.branch_id, sm.product_id, sm.reference_id
      from public.stock_movements sm
     where sm.tenant_id = v_tenant_id
       and sm.reference_id in (v_invoice_id, v_input_invoice_id)
  loop
    perform public._reconcile_product_lots_to_branch_00284(
      v_tenant_id, v_pair.branch_id, v_pair.product_id,
      'internal_sale', v_pair.reference_id, v_actor,
      'Can lo giao dich ban hang noi bo'
    );
  end loop;

  return v_result;
end;
$$;

alter function public.create_internal_sale_atomic(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, boolean, text
) owner to postgres;
revoke all on function public.create_internal_sale_atomic(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, boolean, text
) from public, anon;
grant execute on function public.create_internal_sale_atomic(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, boolean, text
) to authenticated, service_role;

comment on table public.fnb_supply_branch_scopes is
  '00387: Explicit per-store opt-in for F&B supply catalog validation. Defaults off.';
comment on function public.set_fnb_supply_branch_enforcement(uuid, boolean, text) is
  '00387: Admin-only toggle. Enables only a store with at least one catalog SKU.';
comment on function public.create_internal_sale_atomic(
  uuid, uuid, uuid, uuid, uuid, text, uuid, text, jsonb, text, boolean, text
) is
  '00387: Preserves atomic internal sale; optionally validates destination F&B catalog before writes.';

commit;

