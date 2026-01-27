-- OneBiz ERP - Branch defaults

create or replace function public.current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid();
$$;

grant execute on function public.current_branch_id() to authenticated;

create or replace function public.set_branch_id_from_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.branch_id is null then
    new.branch_id := public.current_branch_id();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_inventory_warehouses_branch_id on public.inventory_warehouses;
create trigger trg_inventory_warehouses_branch_id
before insert on public.inventory_warehouses
for each row execute procedure public.set_branch_id_from_context();
