-- New external customers receive codes atomically. Existing customer history is untouched.
alter table public.customer_groups add column if not exists code text;
update public.customer_groups set code = upper(btrim(note))
where code is null and upper(btrim(note)) ~ '^[A-Z][A-Z0-9]{1,7}$';
alter table public.customer_groups add constraint customer_group_code_format
  check (code is null or code ~ '^[A-Z][A-Z0-9]{1,7}$');
create unique index customer_groups_tenant_code_unique on public.customer_groups(tenant_id,code) where code is not null;

create table public.customer_group_code_counters (
  tenant_id uuid not null references public.tenants(id),
  prefix text not null,
  next_value bigint not null default 1 check(next_value > 0),
  primary key(tenant_id,prefix)
);
alter table public.customer_group_code_counters enable row level security;
revoke all on public.customer_group_code_counters from public,anon,authenticated;

create function public.assign_group_customer_code()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_prefix text; v_next bigint; v_code text; v_attempt integer;
begin
  -- Internal branch entities and the singleton walk-in record retain their existing protocol.
  if coalesce(new.is_internal,false) then
    if not exists(select 1 from public.branches b where b.id=new.branch_id and b.tenant_id=new.tenant_id
      and new.code='KH-NB-'||coalesce(b.code,left(b.id::text,4))) then
      raise exception using errcode='22023',message='CUSTOMER_INTERNAL_CODE_INVALID';
    end if;
    return new;
  end if;
  if new.code='KL-VL' and new.group_id is null and new.name in ('Khách lẻ','Khách lẻ vãng lai') then return new; end if;
  if auth.uid() is null or not exists(select 1 from public.profiles p where p.id=auth.uid()
    and p.tenant_id=new.tenant_id and p.is_active) then
    raise exception using errcode='42501',message='CUSTOMER_CODE_TENANT_DENIED';
  end if;
  if new.group_id is null then raise exception using errcode='22023',message='Vui lòng chọn nhóm khách hàng'; end if;
  select g.code into v_prefix from public.customer_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id;
  if v_prefix is null then raise exception using errcode='22023',message='Nhóm khách hàng chưa có mã hợp lệ'; end if;
  insert into public.customer_group_code_counters(tenant_id,prefix,next_value)
  select new.tenant_id,v_prefix,coalesce(max(substring(c.code from length('KHA-'||v_prefix||'-')+1)::numeric),0)::bigint+1
  from public.customers c
  where c.tenant_id=new.tenant_id and c.code ~ ('^KHA-'||v_prefix||'-[0-9]{1,18}$')
  on conflict do nothing;
  select next_value into v_next from public.customer_group_code_counters where tenant_id=new.tenant_id and prefix=v_prefix for update;
  for v_attempt in 1..1000 loop
    v_code := 'KHA-'||v_prefix||'-'||lpad(v_next::text,greatest(3,length(v_next::text)),'0');
    if not exists(select 1 from public.customers c where c.tenant_id=new.tenant_id and c.code=v_code) then
      update public.customer_group_code_counters set next_value=v_next+1 where tenant_id=new.tenant_id and prefix=v_prefix;
      new.code:=v_code;
      return new;
    end if;
    v_next:=v_next+1;
  end loop;
  raise exception using errcode='54000',message='CUSTOMER_CODE_COLLISION_LIMIT';
end; $$;
revoke all on function public.assign_group_customer_code() from public,anon,authenticated;
create trigger customers_assign_group_code before insert on public.customers for each row execute function public.assign_group_customer_code();
notify pgrst,'reload schema';
