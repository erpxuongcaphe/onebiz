begin;
-- Additive: no existing fee, printer, bill or branch setting is changed.
create table public.fnb_delivery_price_policies (
  branch_id uuid primary key references public.branches(id),
  tenant_id uuid not null references public.tenants(id),
  revision bigint not null check (revision > 0),
  policy jsonb not null,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
alter table public.fnb_delivery_price_policies enable row level security;
revoke all on public.fnb_delivery_price_policies from public, anon, authenticated;

create function public.get_fnb_delivery_price_policy(p_branch_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; result jsonb;
begin
  select tenant_id into tenant from public.profiles where id=actor and is_active;
  if tenant is null or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=tenant)
    or not coalesce(public.user_has_branch_access(actor,p_branch_id),false)
    or not (coalesce(public.user_has_permission(actor,'pos_fnb.send_kitchen'),false)
      or coalesce(public.user_has_permission(actor,'pos_fnb.checkout'),false)
      or coalesce(public.user_has_permission(actor,'system.manage_branches'),false))
  then raise exception 'DELIVERY_POLICY_PERMISSION_DENIED' using errcode='42501'; end if;
  select policy || jsonb_build_object('revision',revision) into result
  from public.fnb_delivery_price_policies where branch_id=p_branch_id and tenant_id=tenant;
  return coalesce(result,jsonb_build_object('revision',0,'enabled',false,'amountBasis','after_discount','rules','[]'::jsonb));
end $$;

create function public.save_fnb_delivery_price_policy(p_branch_id uuid,p_revision bigint,p_policy jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; current_revision bigint; rule jsonb; n numeric; field text;
begin
  select tenant_id into tenant from public.profiles where id=actor and is_active;
  if tenant is null or not coalesce(public.user_has_permission(actor,'system.manage_branches'),false)
    or not coalesce(public.user_has_branch_access(actor,p_branch_id),false)
    or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=tenant)
  then raise exception 'DELIVERY_POLICY_PERMISSION_DENIED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_branch_id::text||':delivery-price-policy',0));
  select revision into current_revision from public.fnb_delivery_price_policies where branch_id=p_branch_id and tenant_id=tenant for update;
  if p_revision is distinct from coalesce(current_revision,0) then raise exception 'DELIVERY_POLICY_CONFLICT'; end if;
  if jsonb_typeof(p_policy) is distinct from 'object'
    or jsonb_typeof(p_policy->'enabled') is distinct from 'boolean'
    or coalesce(p_policy->>'amountBasis','') not in ('before_discount','after_discount')
    or jsonb_typeof(p_policy->'rules') is distinct from 'array'
  then raise exception 'DELIVERY_POLICY_INVALID'; end if;
  if jsonb_array_length(p_policy->'rules')>100 then raise exception 'DELIVERY_POLICY_INVALID'; end if;
  for rule in select value from jsonb_array_elements(p_policy->'rules') loop
    if jsonb_typeof(rule) is distinct from 'object' or coalesce(length(trim(rule->>'id')),0)=0
      or coalesce(length(trim(rule->>'name')),0) not between 1 and 120
      or jsonb_typeof(rule->'enabled') is distinct from 'boolean'
    then raise exception 'DELIVERY_POLICY_INVALID'; end if;
    foreach field in array array['fromMeters','toMeters','fromAmount','toAmount','fee'] loop
      if field in ('toMeters','toAmount') and rule->field='null'::jsonb then continue; end if;
      if jsonb_typeof(rule->field) is distinct from 'number' then raise exception 'DELIVERY_POLICY_INVALID'; end if;
      n:=(rule->>field)::numeric;
      if n<0 or n>9007199254740991 or n<>trunc(n) then raise exception 'DELIVERY_POLICY_INVALID'; end if;
    end loop;
    if (rule->>'toMeters')::numeric <= (rule->>'fromMeters')::numeric
      or (rule->>'toAmount')::numeric <= (rule->>'fromAmount')::numeric
    then raise exception 'DELIVERY_POLICY_INVALID'; end if;
  end loop;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(p_policy->'rules'))
    or ((p_policy->>'enabled')::boolean and not exists(select 1 from jsonb_array_elements(p_policy->'rules') where (value->>'enabled')::boolean))
    or exists(select 1 from jsonb_array_elements(p_policy->'rules') with ordinality a(r,i)
      join jsonb_array_elements(p_policy->'rules') with ordinality b(r,i) on a.i<b.i
      where (a.r->>'enabled')::boolean and (b.r->>'enabled')::boolean
        and (a.r->>'fromMeters')::numeric < coalesce((b.r->>'toMeters')::numeric,'Infinity'::numeric)
        and (b.r->>'fromMeters')::numeric < coalesce((a.r->>'toMeters')::numeric,'Infinity'::numeric)
        and (a.r->>'fromAmount')::numeric < coalesce((b.r->>'toAmount')::numeric,'Infinity'::numeric)
        and (b.r->>'fromAmount')::numeric < coalesce((a.r->>'toAmount')::numeric,'Infinity'::numeric))
  then raise exception 'DELIVERY_POLICY_INVALID'; end if;
  insert into public.fnb_delivery_price_policies(branch_id,tenant_id,revision,policy,updated_by)
  values(p_branch_id,tenant,coalesce(current_revision,0)+1,p_policy-'revision',actor)
  on conflict(branch_id) do update set revision=excluded.revision,policy=excluded.policy,updated_by=actor,updated_at=clock_timestamp();
  return public.get_fnb_delivery_price_policy(p_branch_id);
end $$;
revoke all on function public.get_fnb_delivery_price_policy(uuid), public.save_fnb_delivery_price_policy(uuid,bigint,jsonb) from public, anon;
grant execute on function public.get_fnb_delivery_price_policy(uuid), public.save_fnb_delivery_price_policy(uuid,bigint,jsonb) to authenticated;
commit;
