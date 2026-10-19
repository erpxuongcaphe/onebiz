-- Additive branch restrictions; existing module permissions and business rows stay unchanged.
begin;
set local lock_timeout = '2s';

create function public.can_read_branch_document_00567(p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid()
  and p.tenant_id=p_tenant and p.is_active
  and (p_branch is null or exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant))
  and (public.user_has_permission(p.id,'reports.view_all_branches')
   or (p_branch is not null and public.user_has_branch_access(p.id,p_branch))));
$$;
create function public.can_write_branch_document_00567(p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid()
  and p.tenant_id=p_tenant and p.is_active and p_branch is not null
  and exists(select 1 from public.branches b where b.id=p_branch and b.tenant_id=p_tenant)
  and public.user_has_branch_access(p.id,p_branch));
$$;
revoke all on function public.can_read_branch_document_00567(uuid,uuid),public.can_write_branch_document_00567(uuid,uuid) from public,anon;
grant execute on function public.can_read_branch_document_00567(uuid,uuid),public.can_write_branch_document_00567(uuid,uuid) to authenticated;

do $scope$
declare t text; s record; read_scope text; write_scope text;
begin
 foreach t in array array[
  'invoices','purchase_orders','cash_transactions','sales_returns','sales_orders',
  'input_invoices','supplier_returns','disposal_exports','internal_exports',
  'branch_stock','stock_movements','product_lots','production_orders','inventory_checks',
  'customer_debt_adjustments','debt_opening_balances'
 ] loop
  if to_regclass('public.'||t) is null then raise exception '00567 missing table: %',t; end if;
  if not exists(select 1 from pg_policy where polrelid=('public.'||t)::regclass and polpermissive and polcmd in ('r','*')) then
   raise exception '00567 missing base read policy: %',t;end if;
  -- Restrictive policies AND with every existing permissive policy.
  execute format('create policy transaction_branch_read_00567 on public.%I as restrictive for select to authenticated using(public.can_read_branch_document_00567(tenant_id,branch_id))',t);
  execute format('create policy transaction_branch_insert_00567 on public.%I as restrictive for insert to authenticated with check(public.can_write_branch_document_00567(tenant_id,branch_id))',t);
  execute format('create policy transaction_branch_update_00567 on public.%I as restrictive for update to authenticated using(public.can_write_branch_document_00567(tenant_id,branch_id)) with check(public.can_write_branch_document_00567(tenant_id,branch_id))',t);
  execute format('create policy transaction_branch_delete_00567 on public.%I as restrictive for delete to authenticated using(public.can_write_branch_document_00567(tenant_id,branch_id))',t);
  execute format('alter table public.%I enable row level security',t);
 end loop;

 -- A receiving branch may read its transfer, not every document at the source.
 -- These two legacy tables were RLS-disabled with no policies in production.
 if not exists(select 1 from pg_policy where polrelid='public.stock_transfers'::regclass and polpermissive and polcmd in ('r','*')) then
  create policy transaction_branch_base_read_00567 on public.stock_transfers for select to authenticated using(tenant_id=public.get_user_tenant_id());
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.stock_transfer_items'::regclass and polpermissive and polcmd in ('r','*')) then
  create policy transaction_branch_base_read_00567 on public.stock_transfer_items for select to authenticated using(exists(select 1 from public.stock_transfers t where t.id=stock_transfer_items.transfer_id));
 end if;
 read_scope:='public.can_read_branch_document_00567(tenant_id,from_branch_id) or public.can_read_branch_document_00567(tenant_id,to_branch_id)';
 write_scope:='public.can_write_branch_document_00567(tenant_id,from_branch_id) and public.can_write_branch_document_00567(tenant_id,to_branch_id)';
 execute format('create policy transaction_branch_read_00567 on public.stock_transfers as restrictive for select to authenticated using(%s)',read_scope);
 execute format('create policy transaction_branch_insert_00567 on public.stock_transfers as restrictive for insert to authenticated with check(%s)',write_scope);
 execute format('create policy transaction_branch_update_00567 on public.stock_transfers as restrictive for update to authenticated using(%s) with check(%s)',write_scope,write_scope);
 execute format('create policy transaction_branch_delete_00567 on public.stock_transfers as restrictive for delete to authenticated using(%s)',write_scope);
 alter table public.stock_transfers enable row level security;
 create policy transaction_branch_read_00567 on public.stock_transfer_items as restrictive for select to authenticated using(exists(select 1 from public.stock_transfers t where t.id=stock_transfer_items.transfer_id));
 create policy transaction_branch_update_00567 on public.stock_transfer_items as restrictive for update to authenticated
 using(exists(select 1 from public.stock_transfers t where t.id=stock_transfer_items.transfer_id and public.can_write_branch_document_00567(t.tenant_id,t.from_branch_id) and public.can_write_branch_document_00567(t.tenant_id,t.to_branch_id)))
 with check(exists(select 1 from public.stock_transfers t where t.id=stock_transfer_items.transfer_id and public.can_write_branch_document_00567(t.tenant_id,t.from_branch_id) and public.can_write_branch_document_00567(t.tenant_id,t.to_branch_id)));
 create policy transaction_branch_insert_00567 on public.stock_transfer_items as restrictive for insert to authenticated
 with check(exists(select 1 from public.stock_transfers t where t.id=stock_transfer_items.transfer_id and public.can_write_branch_document_00567(t.tenant_id,t.from_branch_id) and public.can_write_branch_document_00567(t.tenant_id,t.to_branch_id)));
 create policy transaction_branch_delete_00567 on public.stock_transfer_items as restrictive for delete to authenticated
 using(exists(select 1 from public.stock_transfers t where t.id=stock_transfer_items.transfer_id and public.can_write_branch_document_00567(t.tenant_id,t.from_branch_id) and public.can_write_branch_document_00567(t.tenant_id,t.to_branch_id)));
 alter table public.stock_transfer_items enable row level security;

 for s in select * from (values
  ('invoice_items','invoice_id','invoices'),
  ('purchase_order_items','purchase_order_id','purchase_orders'),
  ('return_items','return_id','sales_returns'),
  ('sales_order_items','order_id','sales_orders'),
  ('supplier_return_items','return_id','supplier_returns'),
  ('disposal_export_items','disposal_id','disposal_exports'),
  ('internal_export_items','export_id','internal_exports'),
  ('production_order_materials','production_order_id','production_orders'),
  ('inventory_check_items','check_id','inventory_checks'),
  ('shipping_orders','invoice_id','invoices')
 ) spec(child,fk,parent) loop
  if not exists(select 1 from pg_policy where polrelid=('public.'||s.child)::regclass and polpermissive and polcmd in ('r','*')) then
   raise exception '00567 missing base read policy: %',s.child;end if;
  read_scope:=format('exists(select 1 from public.%I p where p.id=%I.%I and public.can_read_branch_document_00567(p.tenant_id,p.branch_id))',s.parent,s.child,s.fk);
  write_scope:=format('exists(select 1 from public.%I p where p.id=%I.%I and public.can_write_branch_document_00567(p.tenant_id,p.branch_id))',s.parent,s.child,s.fk);
  execute format('create policy transaction_branch_read_00567 on public.%I as restrictive for select to authenticated using(%s)',s.child,read_scope);
  execute format('create policy transaction_branch_insert_00567 on public.%I as restrictive for insert to authenticated with check(%s)',s.child,write_scope);
  execute format('create policy transaction_branch_update_00567 on public.%I as restrictive for update to authenticated using(%s) with check(%s)',s.child,write_scope,write_scope);
  execute format('create policy transaction_branch_delete_00567 on public.%I as restrictive for delete to authenticated using(%s)',s.child,write_scope);
  execute format('alter table public.%I enable row level security',s.child);
 end loop;
end; $scope$;

-- The original checkout predates authorization and is not called by current clients.
-- Keep its definition for audit, but never expose it as an alternate checkout path.
do $$begin
 if to_regprocedure('public.pos_checkout(uuid,uuid,uuid,text,jsonb,text,numeric,numeric,text)') is not null then
  revoke all on function public.pos_checkout(uuid,uuid,uuid,text,jsonb,text,numeric,numeric,text) from public,anon,authenticated;
 end if;
end;$$;

create or replace function public.cleanup_expired_auto_drafts(p_tenant_id uuid,p_days integer default 30)
returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.tenant_id=p_tenant_id and p.is_active)
  or not public.user_has_permission(auth.uid(),'pos_retail.checkout') then
  raise exception 'DRAFT_CLEANUP_SCOPE_DENIED' using errcode='42501';
 end if;
 if p_days is null or p_days<30 then raise exception 'DRAFT_CLEANUP_MINIMUM_30_DAYS' using errcode='22023';end if;
 update public.invoices i set deleted_at=now()
 where i.tenant_id=p_tenant_id and i.status='draft' and i.auto_saved=true
  and i.deleted_at is null and i.source is distinct from 'order'
  and i.updated_at<now()-make_interval(days=>p_days)
  and public.can_write_branch_document_00567(i.tenant_id,i.branch_id);
 get diagnostics n=row_count;return n;
end;$$;
revoke all on function public.cleanup_expired_auto_drafts(uuid,integer) from public,anon;
grant execute on function public.cleanup_expired_auto_drafts(uuid,integer) to authenticated;

-- No table grants, permissive policies or stored business rows changed.
notify pgrst,'reload schema';
commit;
