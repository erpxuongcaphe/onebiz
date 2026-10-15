begin;

alter table public.customers add column is_walk_in boolean not null default false;
create unique index customers_one_walk_in_per_tenant
  on public.customers(tenant_id) where is_walk_in;

-- Legacy clients must not recreate KL-VL after its display code has changed.
create function public.guard_walk_in_customer_identity()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' and (new.code='KL-VL' or new.is_walk_in) then
    perform pg_advisory_xact_lock(hashtextextended('walk-in:'||new.tenant_id::text,0));
    if exists(select 1 from public.customers c where c.tenant_id=new.tenant_id and c.is_walk_in) then
      raise exception using errcode='PT409',message='WALK_IN_CUSTOMER_REFRESH_REQUIRED';
    end if;
  end if;
  if current_user not in ('postgres','supabase_admin') then
    if tg_op='INSERT' and new.is_walk_in then
      raise exception using errcode='42501',message='WALK_IN_IDENTITY_MANAGED';
    end if;
    if tg_op='UPDATE' and (new.is_walk_in is distinct from old.is_walk_in
      or ((old.is_walk_in or old.code='KL-VL') and
        (new.code is distinct from old.code or new.tenant_id is distinct from old.tenant_id))) then
      raise exception using errcode='42501',message='WALK_IN_IDENTITY_MANAGED';
    end if;
  end if;
  return new;
end; $$;
create trigger customers_walk_in_identity_guard before insert or update on public.customers
  for each row execute function public.guard_walk_in_customer_identity();

create function public.get_or_create_walk_in_customer()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_profile record; v_customer public.customers%rowtype; v_group uuid;
begin
  select p.tenant_id,p.role into v_profile from public.profiles p
    where p.id=auth.uid() and coalesce(p.is_active,true);
  if not found then raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED'; end if;
  if v_profile.role<>'owner' and not public.user_has_permission(auth.uid(),'pos_retail.checkout') then
    raise exception using errcode='42501',message='POS_CHECKOUT_PERMISSION_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('walk-in:'||v_profile.tenant_id::text,0));
  select * into v_customer from public.customers c where c.tenant_id=v_profile.tenant_id
    and (c.is_walk_in or c.code='KL-VL') order by c.is_walk_in desc limit 1 for update;
  if found then
    if not v_customer.is_active then raise exception using errcode='PT409',message='WALK_IN_CUSTOMER_INACTIVE'; end if;
    if not v_customer.is_walk_in then
      update public.customers set is_walk_in=true where id=v_customer.id returning * into v_customer;
    end if;
    return to_jsonb(v_customer);
  end if;
  select g.id into v_group from public.customer_groups g
    where g.tenant_id=v_profile.tenant_id and g.code='KLE';
  if v_group is null then raise exception using errcode='22023',message='WALK_IN_CUSTOMER_GROUP_REQUIRED'; end if;
  insert into public.customers(tenant_id,code,name,group_id,is_walk_in,customer_type,is_active)
    values(v_profile.tenant_id,'','Khách lẻ',v_group,true,'individual',true)
    returning * into v_customer;
  return to_jsonb(v_customer);
end; $$;

-- Explicit maintenance action: preserves customer UUID and every document FK.
create function public.standardize_walk_in_customer_code(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_profile record; v_customer public.customers%rowtype; v_group uuid;
  v_next bigint; v_new text; v_old jsonb; v_attempt integer;
begin
  select p.tenant_id,p.role into v_profile from public.profiles p
    where p.id=auth.uid() and coalesce(p.is_active,true);
  if not found then raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED'; end if;
  if v_profile.role<>'owner' and not public.user_has_permission(auth.uid(),'customers.edit') then
    raise exception using errcode='42501',message='CUSTOMER_EDIT_PERMISSION_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('walk-in:'||v_profile.tenant_id::text,0));
  select * into v_customer from public.customers c
    where c.id=p_customer_id and c.tenant_id=v_profile.tenant_id for update;
  if not found then raise exception using errcode='22023',message='CUSTOMER_NOT_FOUND'; end if;
  if coalesce(v_customer.is_internal,false) or not (v_customer.is_walk_in or v_customer.code='KL-VL') then
    raise exception using errcode='22023',message='WALK_IN_CUSTOMER_REQUIRED';
  end if;
  select g.id into v_group from public.customer_groups g
    where g.tenant_id=v_profile.tenant_id and g.code='KLE';
  if v_group is null then raise exception using errcode='22023',message='WALK_IN_CUSTOMER_GROUP_REQUIRED'; end if;
  if v_customer.is_walk_in and v_customer.group_id=v_group and v_customer.code ~ '^KHA-KLE-[0-9]+$' then
    return jsonb_build_object('customer_id',v_customer.id,'old_code',v_customer.code,'new_code',v_customer.code,'changed',false);
  end if;
  v_old:=jsonb_build_object('code',v_customer.code,'group_id',v_customer.group_id,'is_walk_in',v_customer.is_walk_in);
  insert into public.customer_group_code_counters(tenant_id,prefix,next_value)
    select v_profile.tenant_id,'KLE',coalesce(max(substring(c.code from 9)::numeric),0)::bigint+1
      from public.customers c where c.tenant_id=v_profile.tenant_id and c.code ~ '^KHA-KLE-[0-9]{1,18}$'
    on conflict do nothing;
  select next_value into v_next from public.customer_group_code_counters
    where tenant_id=v_profile.tenant_id and prefix='KLE' for update;
  for v_attempt in 1..1000 loop
    v_new:='KHA-KLE-'||lpad(v_next::text,greatest(3,length(v_next::text)),'0');
    exit when not exists(select 1 from public.customers c where c.tenant_id=v_profile.tenant_id and c.code=v_new);
    v_next:=v_next+1;
    if v_attempt=1000 then raise exception using errcode='54000',message='CUSTOMER_CODE_COLLISION_LIMIT'; end if;
  end loop;
  update public.customer_group_code_counters set next_value=v_next+1
    where tenant_id=v_profile.tenant_id and prefix='KLE';
  update public.customers set code=v_new,group_id=v_group,is_walk_in=true,updated_at=now()
    where id=v_customer.id and tenant_id=v_profile.tenant_id;
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
    values(v_profile.tenant_id,auth.uid(),'customer_code_changed','customer',v_customer.id,v_old,
      jsonb_build_object('code',v_new,'group_id',v_group,'is_walk_in',true,'atomic',true));
  return jsonb_build_object('customer_id',v_customer.id,'old_code',v_customer.code,'new_code',v_new,'changed',true);
end; $$;

-- Keep the existing arbitrary-code endpoint locked for this system identity.
do $$
declare v_def text:=pg_get_functiondef('public.change_customer_code_atomic(uuid,text)'::regprocedure);
begin
  if strpos(v_def,'v_customer.code = ''KL-VL''')=0 or strpos(v_def,'c.name, c.is_internal')=0 then
    raise exception 'Unexpected change_customer_code_atomic definition';
  end if;
  v_def:=replace(v_def,'c.name, c.is_internal','c.name, c.is_internal, c.is_walk_in');
  v_def:=replace(v_def,'v_customer.code = ''KL-VL''','(v_customer.code = ''KL-VL'' or v_customer.is_walk_in)');
  execute v_def;
end; $$;

revoke all on function public.guard_walk_in_customer_identity() from public,anon,authenticated;
revoke all on function public.get_or_create_walk_in_customer() from public,anon;
revoke all on function public.standardize_walk_in_customer_code(uuid) from public,anon;
grant execute on function public.get_or_create_walk_in_customer() to authenticated;
grant execute on function public.standardize_walk_in_customer_code(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
