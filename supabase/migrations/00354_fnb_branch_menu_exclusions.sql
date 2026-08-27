-- ============================================================================
-- 00354 — Chính sách menu FnB theo chi nhánh: chỉ bán hoặc ẩn tại quán chọn
--
-- Mở rộng 00353 nhưng không sao chép SKU:
--   * Không có chính sách: giữ cách cũ, bán ở mọi quán FnB.
--   * only: chỉ bán tại các quán được chọn.
--   * except: vẫn bán ở các quán khác, chỉ ẩn tại các quán được chọn.
--
-- `except` dùng cho quán đang chuẩn bị dữ liệu (như XTB), để các SKU nháp
-- giá 0/BOM chưa chốt không hiện trên POS tại quán đó mà không ảnh hưởng menu
-- đang vận hành ở chi nhánh khác.
--
-- KHÔNG ĐỤNG: sản phẩm, giá, BOM, tồn kho, đơn, hóa đơn, phiếu bếp hay lịch sử.
-- ============================================================================

begin;

-- 00354 only extends the hardened 00353 boundary. Do not replace a changed
-- kitchen function with a guessed copy.
do $prerequisite$
declare
  v_definition text;
begin
  if to_regclass('public.fnb_product_branch_menu_scopes') is null
     or to_regprocedure('public.save_fnb_product_branch_menu_scope(uuid,uuid[])') is null
     or to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00354_PREREQUISITE_00353_MISSING';
  end if;

  select pg_get_functiondef(
    'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in coalesce(v_definition, '')) = 0
     or position('_fnb_send_to_kitchen_impl_00350' in coalesce(v_definition, '')) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00354_PREREQUISITE_00353_CHANGED';
  end if;
end;
$prerequisite$;

-- ── 1. One policy per FnB SKU, with the existing scope rows as its branch list
create table if not exists public.fnb_product_branch_menu_policies (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  mode text not null check (mode in ('only', 'except')),
  created_at timestamptz not null default now(),
  constraint fnb_product_branch_menu_policies_product_unique unique (product_id)
);

create index if not exists idx_fnb_product_branch_menu_policies_tenant_product
  on public.fnb_product_branch_menu_policies(tenant_id, product_id);

comment on table public.fnb_product_branch_menu_policies is
  '00354: Chính sách menu FnB theo SKU. only = chỉ bán tại scope; except = ẩn tại scope. Không có dòng = bán mọi quán FnB để tương thích dữ liệu cũ.';

create or replace function public.enforce_fnb_product_branch_menu_policy_00354()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_product_tenant uuid;
  v_product_is_fnb boolean := false;
begin
  select
    p.tenant_id,
    (p.product_type = 'sku' and p.channel = 'fnb')
    into v_product_tenant, v_product_is_fnb
    from public.products p
   where p.id = new.product_id;

  if v_product_tenant is null or not v_product_is_fnb then
    raise exception using errcode = '23514', message = 'FNB_MENU_POLICY_PRODUCT_NOT_FNB_SKU';
  end if;
  if new.tenant_id is distinct from v_product_tenant then
    raise exception using errcode = '23514', message = 'FNB_MENU_POLICY_PRODUCT_TENANT_MISMATCH';
  end if;
  if new.mode not in ('only', 'except') then
    raise exception using errcode = '23514', message = 'FNB_MENU_POLICY_MODE_INVALID';
  end if;

  return new;
end;
$function$;

alter function public.enforce_fnb_product_branch_menu_policy_00354() owner to postgres;
revoke all on function public.enforce_fnb_product_branch_menu_policy_00354()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_enforce_fnb_product_branch_menu_policy_00354
  on public.fnb_product_branch_menu_policies;
create trigger trg_enforce_fnb_product_branch_menu_policy_00354
before insert or update of tenant_id, product_id, mode
on public.fnb_product_branch_menu_policies
for each row execute function public.enforce_fnb_product_branch_menu_policy_00354();

alter table public.fnb_product_branch_menu_policies enable row level security;
drop policy if exists fnb_product_branch_menu_policies_tenant_select
  on public.fnb_product_branch_menu_policies;
create policy fnb_product_branch_menu_policies_tenant_select
  on public.fnb_product_branch_menu_policies
  for select to authenticated
  using (tenant_id = (select public.get_user_tenant_id()));

revoke all on table public.fnb_product_branch_menu_policies
  from public, anon, authenticated, service_role;
grant select on table public.fnb_product_branch_menu_policies to authenticated;

-- Existing 00353 scope rows were all whitelists. Record that explicit meaning
-- before the POS is taught how to read the new `except` policy.
insert into public.fnb_product_branch_menu_policies (tenant_id, product_id, mode)
select s.tenant_id, s.product_id, 'only'
  from public.fnb_product_branch_menu_scopes s
 group by s.tenant_id, s.product_id
on conflict (product_id) do nothing;

-- ── 2. Atomic save of all / only / except for exactly one FnB SKU ─────────
create or replace function public.save_fnb_product_branch_menu_policy(
  p_product_id uuid,
  p_mode text,
  p_branch_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_mode text := lower(trim(coalesce(p_mode, '')));
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
    raise exception using errcode = '42501', message = 'FNB_MENU_POLICY_PERMISSION_DENIED';
  end if;

  if v_mode not in ('all', 'only', 'except') then
    raise exception using errcode = 'P0001', message = 'FNB_MENU_POLICY_MODE_INVALID';
  end if;
  if not exists (
    select 1
      from public.products p
     where p.id = p_product_id
       and p.tenant_id = v_tenant
       and p.product_type = 'sku'
       and p.channel = 'fnb'
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_MENU_POLICY_PRODUCT_NOT_FNB_SKU';
  end if;
  if array_position(v_branch_ids, null) is not null then
    raise exception using errcode = 'P0001', message = 'FNB_MENU_POLICY_BRANCH_REQUIRED';
  end if;
  if v_mode = 'all' and cardinality(v_branch_ids) <> 0 then
    raise exception using errcode = 'P0001', message = 'FNB_MENU_POLICY_ALL_BRANCHES_MUST_BE_EMPTY';
  end if;
  if v_mode in ('only', 'except') and cardinality(v_branch_ids) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_MENU_POLICY_BRANCH_REQUIRED';
  end if;

  if cardinality(v_branch_ids) > 0 then
    select count(*) into v_valid_branch_count
      from public.branches b
     where b.id = any(v_branch_ids)
       and b.tenant_id = v_tenant
       and b.is_active
       and (b.cascade_mode = 'outlet' or b.branch_type = 'store');
    if v_valid_branch_count <> cardinality(v_branch_ids) then
      raise exception using errcode = 'P0001', message = 'FNB_MENU_POLICY_BRANCH_INVALID';
    end if;
  end if;

  -- A SKU has exactly one interpretation. Deleting both the old branch list
  -- and its policy inside this transaction prevents an intermediate POS view.
  delete from public.fnb_product_branch_menu_scopes
   where tenant_id = v_tenant and product_id = p_product_id;
  delete from public.fnb_product_branch_menu_policies
   where tenant_id = v_tenant and product_id = p_product_id;

  if v_mode <> 'all' then
    insert into public.fnb_product_branch_menu_policies (tenant_id, product_id, mode)
    values (v_tenant, p_product_id, v_mode);

    insert into public.fnb_product_branch_menu_scopes (tenant_id, product_id, branch_id)
    select v_tenant, p_product_id, branch_id
      from unnest(v_branch_ids) as selected(branch_id);
  end if;

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'mode', v_mode,
    'branch_count', cardinality(v_branch_ids)
  );
end;
$function$;

alter function public.save_fnb_product_branch_menu_policy(uuid, text, uuid[]) owner to postgres;
revoke all on function public.save_fnb_product_branch_menu_policy(uuid, text, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_product_branch_menu_policy(uuid, text, uuid[])
  to authenticated;

comment on function public.save_fnb_product_branch_menu_policy(uuid, text, uuid[]) is
  '00354: Lưu nguyên tử chính sách menu FnB all/only/except cho một SKU. Chi nhánh chỉ là phạm vi menu, không đổi SKU, giá, BOM, tồn hay chứng từ.';

-- Preserve the 00353 RPC contract for existing browser tabs. An old caller
-- can still save only/all; it can never create an `except` rule by accident.
create or replace function public.save_fnb_product_branch_menu_scope(
  p_product_id uuid,
  p_branch_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
begin
  return public.save_fnb_product_branch_menu_policy(
    p_product_id,
    case when cardinality(coalesce(p_branch_ids, '{}'::uuid[])) = 0 then 'all' else 'only' end,
    coalesce(p_branch_ids, '{}'::uuid[])
  );
end;
$function$;

alter function public.save_fnb_product_branch_menu_scope(uuid, uuid[]) owner to postgres;
revoke all on function public.save_fnb_product_branch_menu_scope(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_product_branch_menu_scope(uuid, uuid[])
  to authenticated;

-- ── 3. Server-side boundary before the existing 00353/00350 kitchen guards
do $rename_send$
begin
  if to_regprocedure('public._fnb_send_to_kitchen_impl_00353(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null then
    return;
  end if;
  if to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00354_SEND_KITCHEN_RPC_MISSING';
  end if;
  if position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in pg_get_functiondef(
    to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)')
  )) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00354_SEND_KITCHEN_PREREQUISITE_CHANGED';
  end if;
  alter function public.fnb_send_to_kitchen_atomic_v2(
    uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
  ) rename to _fnb_send_to_kitchen_impl_00353;
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
  v_policy_mode text;
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

  -- Inspect regular lines and topping SKU lines before the older wrappers can
  -- create or update a kitchen order. Malformed payloads remain the concern
  -- of the established implementation, so this guard does not replace it.
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

        select policy.mode into v_policy_mode
          from public.fnb_product_branch_menu_policies policy
         where policy.tenant_id = v_tenant
           and policy.product_id = v_product_id;

        if v_policy_mode = 'only' and not exists (
          select 1
            from public.fnb_product_branch_menu_scopes scope
           where scope.tenant_id = v_tenant
             and scope.product_id = v_product_id
             and scope.branch_id = p_branch_id
        ) then
          raise exception using
            errcode = 'P0001',
            message = 'FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE',
            detail = format('Mon "%s" chua duoc mo menu tai chi nhanh nay.', v_product_name);
        end if;

        if v_policy_mode = 'except' and exists (
          select 1
            from public.fnb_product_branch_menu_scopes scope
           where scope.tenant_id = v_tenant
             and scope.product_id = v_product_id
             and scope.branch_id = p_branch_id
        ) then
          raise exception using
            errcode = 'P0001',
            message = 'FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE',
            detail = format('Mon "%s" dang an tai chi nhanh nay.', v_product_name);
        end if;
      end loop;
    end loop;
  end if;

  return public._fnb_send_to_kitchen_impl_00353(
    p_branch_id, p_table_id, p_order_type, p_note, p_idempotency_key, p_items,
    p_delivery_platform, p_delivery_fee, p_platform_commission_percent,
    p_delivery_staff_id, p_delivery_distance_tier, p_existing_order_id
  );
end;
$function$;

alter function public.fnb_send_to_kitchen_atomic_v2(
  uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
) owner to postgres;
revoke all on function public._fnb_send_to_kitchen_impl_00353(
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
  '00354: Chặn menu FnB theo chính sách all/only/except trước lớp 00353 whitelist và 00350 định lượng chính xác.';

-- ── 4. Fail closed before committing schema work ──────────────────────────
do $verify$
declare
  v_definition text;
begin
  if to_regclass('public.fnb_product_branch_menu_policies') is null
     or to_regprocedure('public.enforce_fnb_product_branch_menu_policy_00354()') is null
     or to_regprocedure('public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])') is null
     or to_regprocedure('public._fnb_send_to_kitchen_impl_00353(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00354_INSTALL_INCOMPLETE';
  end if;

  if exists (
    select 1
      from public.fnb_product_branch_menu_scopes scope
     left join public.fnb_product_branch_menu_policies policy
        on policy.product_id = scope.product_id
       and policy.tenant_id = scope.tenant_id
     where policy.product_id is null
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_00354_LEGACY_SCOPE_BACKFILL_INCOMPLETE';
  end if;

  select pg_get_functiondef(
    'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure
  ) into v_definition;
  if position('FNB_MENU_POLICY_PRODUCT_NOT_AVAILABLE' in v_definition) = 0
     or position('_fnb_send_to_kitchen_impl_00353' in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00354_SEND_WRAPPER_NOT_ACTIVE';
  end if;
end;
$verify$;

commit;

notify pgrst, 'reload schema';
