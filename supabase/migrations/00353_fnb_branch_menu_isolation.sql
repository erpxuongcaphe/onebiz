-- ============================================================================
-- 00353 — Menu FnB theo chi nhánh, cô lập SKU thử nghiệm an toàn
--
-- QUY ƯỚC TƯƠNG THÍCH DỮ LIỆU CŨ
--   * SKU KHÔNG có dòng trong bảng mới: tiếp tục hiện ở mọi chi nhánh FnB.
--   * SKU có một hoặc nhiều dòng: chỉ hiện và chỉ được gửi bếp ở các chi
--     nhánh được liệt kê. Đây là whitelist, không phải bản sao menu.
--
-- Nhờ vậy việc bật phạm vi cho một SKU thử nghiệm không làm mất menu của các
-- quán đang vận hành. Lớp gửi bếp được bọc để tab/cache cũ cũng không thể
-- gửi món scoped sang nhánh ngoài danh sách.
--
-- KHÔNG ĐỤNG: đơn, hóa đơn, phiếu bếp, BOM, tồn kho, giá và lịch sử cũ.
-- ============================================================================

begin;

-- ── 1. Whitelist SKU FnB × chi nhánh ─────────────────────────────────────
create table if not exists public.fnb_product_branch_menu_scopes (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint fnb_product_branch_menu_scopes_unique unique (product_id, branch_id)
);

create index if not exists idx_fnb_product_branch_menu_scopes_tenant_branch
  on public.fnb_product_branch_menu_scopes(tenant_id, branch_id, product_id);

comment on table public.fnb_product_branch_menu_scopes is
  '00353: Whitelist menu FnB theo chi nhánh. SKU không có dòng vẫn bán ở mọi quán để tương thích dữ liệu cũ; SKU có dòng chỉ bán ở các chi nhánh được ghi.';

-- Even though direct browser writes are revoked, retain a server guard for
-- future jobs/RPCs. A scope row must always join one tenant, one active FnB
-- SKU and one active outlet of that same tenant.
create or replace function public.enforce_fnb_product_branch_menu_scope_00353()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_product_tenant uuid;
  v_product_is_fnb boolean := false;
  v_branch_tenant uuid;
  v_branch_is_fnb boolean := false;
begin
  select
    p.tenant_id,
    (p.product_type = 'sku' and p.channel = 'fnb')
    into v_product_tenant, v_product_is_fnb
    from public.products p
   where p.id = new.product_id;

  if v_product_tenant is null or not v_product_is_fnb then
    raise exception using errcode = '23514', message = 'FNB_MENU_SCOPE_PRODUCT_NOT_FNB_SKU';
  end if;
  if new.tenant_id is distinct from v_product_tenant then
    raise exception using errcode = '23514', message = 'FNB_MENU_SCOPE_PRODUCT_TENANT_MISMATCH';
  end if;

  select
    b.tenant_id,
    (b.is_active and (b.cascade_mode = 'outlet' or b.branch_type = 'store'))
    into v_branch_tenant, v_branch_is_fnb
    from public.branches b
   where b.id = new.branch_id;

  if v_branch_tenant is null or not v_branch_is_fnb then
    raise exception using errcode = '23514', message = 'FNB_MENU_SCOPE_BRANCH_NOT_FNB_OUTLET';
  end if;
  if new.tenant_id is distinct from v_branch_tenant then
    raise exception using errcode = '23514', message = 'FNB_MENU_SCOPE_BRANCH_TENANT_MISMATCH';
  end if;

  return new;
end;
$function$;

alter function public.enforce_fnb_product_branch_menu_scope_00353() owner to postgres;
revoke all on function public.enforce_fnb_product_branch_menu_scope_00353()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enforce_fnb_product_branch_menu_scope_00353
  on public.fnb_product_branch_menu_scopes;
create trigger trg_enforce_fnb_product_branch_menu_scope_00353
before insert or update of tenant_id, product_id, branch_id
on public.fnb_product_branch_menu_scopes
for each row execute function public.enforce_fnb_product_branch_menu_scope_00353();

alter table public.fnb_product_branch_menu_scopes enable row level security;
drop policy if exists fnb_product_branch_menu_scopes_tenant_select
  on public.fnb_product_branch_menu_scopes;
create policy fnb_product_branch_menu_scopes_tenant_select
  on public.fnb_product_branch_menu_scopes
  for select to authenticated
  using (tenant_id = (select public.get_user_tenant_id()));

revoke all on table public.fnb_product_branch_menu_scopes
  from public, anon, authenticated, service_role;
grant select on table public.fnb_product_branch_menu_scopes to authenticated;

-- ── 2. Atomic administration of one product's scope ──────────────────────
create or replace function public.save_fnb_product_branch_menu_scope(
  p_product_id uuid,
  p_branch_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_branch_ids uuid[] := coalesce(p_branch_ids, '{}'::uuid[]);
  v_valid_branch_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant
    from public.profiles p
   where p.id = v_actor and p.is_active;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.edit') then
    raise exception using errcode = '42501', message = 'FNB_MENU_SCOPE_PERMISSION_DENIED';
  end if;

  if not exists (
    select 1
      from public.products p
     where p.id = p_product_id
       and p.tenant_id = v_tenant
       and p.product_type = 'sku'
       and p.channel = 'fnb'
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_MENU_SCOPE_PRODUCT_NOT_FNB_SKU';
  end if;

  if array_position(v_branch_ids, null) is not null then
    raise exception using errcode = 'P0001', message = 'FNB_MENU_SCOPE_BRANCH_REQUIRED';
  end if;

  if cardinality(v_branch_ids) > 0 then
    select count(*) into v_valid_branch_count
      from public.branches b
     where b.id = any(v_branch_ids)
       and b.tenant_id = v_tenant
       and b.is_active
       and (b.cascade_mode = 'outlet' or b.branch_type = 'store');
    if v_valid_branch_count <> cardinality(v_branch_ids) then
      raise exception using errcode = 'P0001', message = 'FNB_MENU_SCOPE_BRANCH_INVALID';
    end if;
  end if;

  -- Empty array means restore the legacy all-FnB-branches behavior. The
  -- delete + insert run in this one transaction, so no half-saved whitelist
  -- can be observed by POS.
  delete from public.fnb_product_branch_menu_scopes
   where tenant_id = v_tenant and product_id = p_product_id;

  insert into public.fnb_product_branch_menu_scopes (tenant_id, product_id, branch_id)
  select v_tenant, p_product_id, branch_id
    from unnest(v_branch_ids) as selected(branch_id);

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'mode', case when cardinality(v_branch_ids) = 0 then 'all' else 'selected' end,
    'branch_count', cardinality(v_branch_ids)
  );
end;
$function$;

alter function public.save_fnb_product_branch_menu_scope(uuid, uuid[]) owner to postgres;
revoke all on function public.save_fnb_product_branch_menu_scope(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_product_branch_menu_scope(uuid, uuid[])
  to authenticated;

comment on function public.save_fnb_product_branch_menu_scope(uuid, uuid[]) is
  '00353: Saves a full FnB SKU branch whitelist atomically. Empty list restores legacy availability at all FnB branches.';

-- ── 3. Server-side menu boundary before any kitchen write ────────────────
-- 00350 already wrapped the Size/exact-recipe guard. Wrap that public entry
-- once more instead of copying its implementation, preserving every prior
-- guard and all existing business behavior.
do $rename_send$
begin
  if to_regprocedure('public._fnb_send_to_kitchen_impl_00350(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null then
    return;
  end if;
  if to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00353_SEND_KITCHEN_RPC_MISSING';
  end if;
  if position('_fnb_send_to_kitchen_impl_00330' in pg_get_functiondef(
    to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)')
  )) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00353_SEND_KITCHEN_PREREQUISITE_CHANGED';
  end if;
  alter function public.fnb_send_to_kitchen_atomic_v2(
    uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
  ) rename to _fnb_send_to_kitchen_impl_00350;
end;
$rename_send$;

create or replace function public.fnb_send_to_kitchen_atomic_v2(
  p_branch_id uuid,
  p_table_id uuid default null,
  p_order_type text default 'dine_in',
  p_note text default null,
  p_idempotency_key text default null,
  p_items jsonb default '[]'::jsonb,
  p_delivery_platform text default null,
  p_delivery_fee numeric default 0,
  p_platform_commission_percent numeric default null,
  p_delivery_staff_id uuid default null,
  p_delivery_distance_tier text default null,
  p_existing_order_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_item jsonb;
  v_candidate jsonb;
  v_product_id uuid;
  v_product_name text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;
  select p.tenant_id into v_tenant
    from public.profiles p
   where p.id = v_actor and p.is_active;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;

  -- Check both regular menu lines and topping SKU lines before the 00350
  -- wrapper can create or update any kitchen order/item. A malformed payload
  -- is left to the existing wrapper so this layer preserves its validation.
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) = 'array' then
    for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    for v_candidate in
      select v_item
      union all
      select topping.value
        from jsonb_array_elements(
          case when jsonb_typeof(v_item->'toppings') = 'array'
            then v_item->'toppings'
            else '[]'::jsonb
          end
        ) as topping(value)
    loop
      begin
        v_product_id := nullif(v_candidate->>'productId', '')::uuid;
        if v_product_id is null then
          v_product_id := nullif(v_candidate->>'product_id', '')::uuid;
        end if;
      exception when invalid_text_representation then
        -- The wrapped implementation reports its existing friendly payload
        -- error. Do not replace it with a scope error for malformed input.
        continue;
      end;
      continue when v_product_id is null;

      select p.name into v_product_name
        from public.products p
       where p.id = v_product_id
         and p.tenant_id = v_tenant
         and p.product_type = 'sku'
         and p.channel = 'fnb';
      continue when v_product_name is null;

      if exists (
        select 1 from public.fnb_product_branch_menu_scopes s
         where s.tenant_id = v_tenant and s.product_id = v_product_id
      ) and not exists (
        select 1 from public.fnb_product_branch_menu_scopes s
         where s.tenant_id = v_tenant
           and s.product_id = v_product_id
           and s.branch_id = p_branch_id
      ) then
        raise exception using
          errcode = 'P0001',
          message = 'FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE',
          detail = format('Mon "%s" chua duoc mo menu tai chi nhanh nay.', v_product_name);
      end if;
    end loop;
    end loop;
  end if;

  return public._fnb_send_to_kitchen_impl_00350(
    p_branch_id, p_table_id, p_order_type, p_note, p_idempotency_key, p_items,
    p_delivery_platform, p_delivery_fee, p_platform_commission_percent,
    p_delivery_staff_id, p_delivery_distance_tier, p_existing_order_id
  );
end;
$function$;

alter function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) owner to postgres;
revoke all on function public._fnb_send_to_kitchen_impl_00350(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) from public, anon, authenticated, service_role;
revoke all on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) from public, anon, authenticated, service_role;
grant execute on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) to authenticated;

comment on function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) is
  '00353: FnB menu branch whitelist guard before 00350 exact-recipe/size guard. Scoped SKUs may only be sent to kitchen at their enabled branch.';

-- ── 4. Hậu kiểm trong transaction ─────────────────────────────────────────
do $verify$
declare
  v_definition text;
begin
  if to_regclass('public.fnb_product_branch_menu_scopes') is null
     or to_regprocedure('public.enforce_fnb_product_branch_menu_scope_00353()') is null
     or to_regprocedure('public.save_fnb_product_branch_menu_scope(uuid,uuid[])') is null
     or to_regprocedure('public._fnb_send_to_kitchen_impl_00350(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00353_INSTALL_INCOMPLETE';
  end if;

  select pg_get_functiondef(
    'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in v_definition) = 0
     or position('_fnb_send_to_kitchen_impl_00350' in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00353_SEND_WRAPPER_NOT_ACTIVE';
  end if;
end;
$verify$;

commit;

notify pgrst, 'reload schema';
