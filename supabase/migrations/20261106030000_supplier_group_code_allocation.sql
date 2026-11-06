begin;

create table public.supplier_group_code_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_code text not null,
  next_value bigint not null check (next_value > 0),
  primary key (tenant_id, group_code)
);
alter table public.supplier_group_code_counters enable row level security;
revoke all on public.supplier_group_code_counters from public, anon, authenticated;

create function public.assign_supplier_group_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_code text;
  v_prefix text;
  v_next bigint;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and tenant_id = new.tenant_id and is_active
  ) then
    raise exception 'Không có quyền cấp mã nhà cung cấp' using errcode = '42501';
  end if;

  select code into v_group_code
  from public.categories
  where id = new.group_id and tenant_id = new.tenant_id and scope = 'supplier'
    and code ~ '^[A-Z][A-Z0-9]{1,7}$' and code <> 'NB';
  if v_group_code is null then
    raise exception 'Vui lòng chọn nhóm nhà cung cấp hợp lệ' using errcode = '22023';
  end if;
  v_prefix := 'NCC-' || v_group_code || '-';

  -- Serialize number allocation per tenant and group. The counter rolls back
  -- with the supplier insert if the insert fails.
  insert into public.supplier_group_code_counters (tenant_id, group_code, next_value)
  values (new.tenant_id, v_group_code, 1)
  on conflict do nothing;
  select next_value into v_next
  from public.supplier_group_code_counters
  where tenant_id = new.tenant_id and group_code = v_group_code
  for update;

  -- Include explicit/imported codes and legacy leading whitespace.
  select greatest(v_next, coalesce(max(substring(normalized from length(v_prefix) + 1)::bigint), 0) + 1)
  into v_next
  from (
    select regexp_replace(upper(code), '^[[:space:]]+|[[:space:]]+$', '', 'g') normalized
    from public.suppliers where tenant_id = new.tenant_id
  ) existing
  where normalized ~ ('^' || v_prefix || '[0-9]{1,18}$');

  new.code := v_prefix || lpad(v_next::text, greatest(3, length(v_next::text)), '0');
  new.group_code := v_group_code;
  update public.supplier_group_code_counters set next_value = v_next + 1
  where tenant_id = new.tenant_id and group_code = v_group_code;
  return new;
end;
$$;

revoke all on function public.assign_supplier_group_code() from public, anon, authenticated;
create trigger suppliers_assign_group_code
before insert on public.suppliers for each row
when (new.code = '' and new.group_id is not null)
execute function public.assign_supplier_group_code();

commit;
