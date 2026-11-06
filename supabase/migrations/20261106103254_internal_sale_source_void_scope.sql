-- A source-scoped grant authorizes only the paired cancellation operation.
create table public.internal_sale_source_void_grants (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, source_branch_id)
);
alter table public.internal_sale_source_void_grants enable row level security;
revoke all on table public.internal_sale_source_void_grants from public, anon, authenticated;
comment on table public.internal_sale_source_void_grants is
  'Explicit per-user authorization to void completed internal invoices from one source branch. Does not grant access to destination branches.';

do $migration$
declare
  definition text := pg_get_functiondef('public.cancel_internal_sale_atomic(uuid,text)'::regprocedure);
  old_guard text := 'if not user_has_branch_access(v_actor,v_sale.from_branch_id) or not user_has_branch_access(v_actor,v_sale.to_branch_id) then raise exception ''INTERNAL_SALE_BRANCH_DENIED''; end if;';
  old_delegate text := 'if v_sale.status<>''completed'' then return _cancel_internal_sale_draft_00471(p_internal_sale_id,p_reason); end if;';
  new_guard text := $guard$
 if not user_has_branch_access(v_actor,v_sale.from_branch_id) then
   raise exception 'INTERNAL_SALE_BRANCH_DENIED';
 end if;
 if not user_has_branch_access(v_actor,v_sale.to_branch_id) then
   if v_sale.status not in ('completed','cancelled')
     or not user_has_permission(v_actor,'pos_retail.void')
     or not exists (
       select 1 from public.internal_sale_source_void_grants g
       where g.tenant_id=v_tenant and g.user_id=v_actor and g.source_branch_id=v_sale.from_branch_id
     ) then
     raise exception 'INTERNAL_SALE_BRANCH_DENIED';
   end if;
   if v_sale.status='cancelled' then
     if length(trim(coalesce(p_reason,'')))<5 then raise exception 'INTERNAL_SALE_CANCEL_REASON_REQUIRED'; end if;
     return jsonb_build_object('id',v_sale.id,'code',v_sale.code,'status','cancelled','idempotent',true);
   end if;
 end if;
 $guard$;
begin
  if length(definition)-length(replace(definition,old_guard,'')) <> length(old_guard)
     or strpos(definition,old_delegate)=0 then
    raise exception 'INTERNAL_SALE_VOID_SCOPE_SOURCE_CHANGED';
  end if;
  execute replace(definition,old_guard,new_guard);
end;
$migration$;
