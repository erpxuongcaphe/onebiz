-- Processing is operational metadata, never an invoice/payment/stock posting.
create table public.sales_order_processing_closures (
  order_id uuid primary key references public.invoices(id),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  closed_at timestamptz default now(),
  reopened_at timestamptz,
  closed_by uuid,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  origin text not null check (origin in ('manual','invoice'))
);
create index sales_order_processing_closures_scope_idx
  on public.sales_order_processing_closures(tenant_id,branch_id);
alter table public.sales_order_processing_closures enable row level security;
revoke all on public.sales_order_processing_closures from public,anon,authenticated;
grant select on public.sales_order_processing_closures to authenticated;
grant all on public.sales_order_processing_closures to service_role;
create policy order_processing_closures_read on public.sales_order_processing_closures
for select to authenticated using (
  tenant_id = public.get_user_tenant_id()
  and public.user_has_branch_access(auth.uid(),branch_id)
  and exists (select 1 from public.invoices visible_order
    where visible_order.id=order_id and visible_order.source='order')
);

create function public.close_sales_order_processing(p_order_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_order record;
  v_closed record;
begin
  select p.tenant_id into v_tenant from public.profiles p
  where p.id=v_actor and p.is_active;
  if v_actor is null or v_tenant is null
     or not public.user_has_permission(v_actor,'orders.create') then
    raise exception using errcode='42501',message='Bạn không có quyền xử lý đơn đặt hàng.';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
    raise exception using errcode='22023',message='Nhập lý do từ 3 đến 500 ký tự.';
  end if;
  select i.id,i.code,i.branch_id,i.status into v_order from public.invoices i
  where i.id=p_order_id and i.tenant_id=v_tenant and i.source='order'
    and i.deleted_at is null for update;
  if not found then
    raise exception using errcode='P0002',message='Không tìm thấy đơn đặt hàng.';
  end if;
  if not public.user_has_branch_access(v_actor,v_order.branch_id) then
    raise exception using errcode='42501',message='Bạn không có quyền tại chi nhánh của đơn.';
  end if;
  if v_order.status='cancelled' then
    raise exception using errcode='22023',message='Đơn đặt hàng đã hủy.';
  end if;
  insert into public.sales_order_processing_closures(order_id,tenant_id,branch_id,closed_by,reason,origin)
  values(p_order_id,v_tenant,v_order.branch_id,v_actor,btrim(p_reason),'manual')
  on conflict(order_id) do update set closed_at=now(),closed_by=v_actor,
    reason=excluded.reason,origin='manual'
    where sales_order_processing_closures.closed_at is null
  returning * into v_closed;
  if found then
    insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
    values(v_tenant,v_actor,'sales_order_processing_closed','sales_order',p_order_id,null,
      jsonb_build_object('order_code',v_order.code,'reason',v_closed.reason,
        'closed_at',v_closed.closed_at,'origin','manual'));
  end if;
  return jsonb_build_object('order_id',p_order_id,'closed',true);
end $$;
revoke all on function public.close_sales_order_processing(uuid,text) from public,anon;
grant execute on function public.close_sales_order_processing(uuid,text) to authenticated;

create function public.reopen_sales_order_processing(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_order record;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
  if v_actor is null or v_tenant is null or not public.user_has_permission(v_actor,'orders.create') then
    raise exception using errcode='42501',message='Bạn không có quyền xử lý đơn đặt hàng.';
  end if;
  select id,branch_id,code into v_order from public.invoices
    where id=p_order_id and tenant_id=v_tenant and source='order' and deleted_at is null
    and status<>'cancelled' for update;
  if not found then raise exception using errcode='P0002',message='Không tìm thấy đơn đặt hàng.'; end if;
  if not public.user_has_branch_access(v_actor,v_order.branch_id) then
    raise exception using errcode='42501',message='Bạn không có quyền tại chi nhánh của đơn.';
  end if;
  -- Existing API clears the legacy anchor with its existing authorization/audit.
  perform public.mark_order_processed(p_order_id,null);
  insert into public.sales_order_processing_closures(order_id,tenant_id,branch_id,closed_at,closed_by,reason,origin,reopened_at)
    values(p_order_id,v_tenant,v_order.branch_id,null,v_actor,'Chủ động mở lại xử lý','manual',now())
    on conflict(order_id) do update set closed_at=null,reopened_at=now();
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
    values(v_tenant,v_actor,'sales_order_processing_reopened','sales_order',p_order_id,
      jsonb_build_object('order_code',v_order.code,'reopened_at',now()));
  return jsonb_build_object('order_id',p_order_id,'closed',false);
end $$;
revoke all on function public.reopen_sales_order_processing(uuid) from public,anon;
grant execute on function public.reopen_sales_order_processing(uuid) to authenticated;

-- Remember successful issuance even if the child is subsequently cancelled.
-- No backfill and no updates to existing financial documents.
create function public.remember_sales_order_processing_closed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_parent record; v_closed uuid;
begin
  if tg_op='UPDATE' and old.status='completed' and old.source_order_id is not distinct from new.source_order_id then
    return new;
  end if;
  if new.source_order_id is null or new.source='order' or new.status<>'completed'
     or new.deleted_at is not null or new.voided_at is not null or new.cancelled_at is not null then
    return new;
  end if;
  select id,tenant_id,branch_id into v_parent from public.invoices
  where id=new.source_order_id and tenant_id=new.tenant_id and branch_id=new.branch_id
    and source='order' and deleted_at is null;
  if not found then return new; end if;
  insert into public.sales_order_processing_closures(order_id,tenant_id,branch_id,closed_by,reason,origin)
  values(v_parent.id,v_parent.tenant_id,v_parent.branch_id,coalesce(auth.uid(),new.created_by),
    'Đã xuất hóa đơn '||new.code,'invoice')
  on conflict(order_id) do update set closed_at=now(),closed_by=excluded.closed_by,
    reason=excluded.reason,origin='invoice'
    where sales_order_processing_closures.closed_at is null
  returning order_id into v_closed;
  -- Automated audit uses the same actor as issuance; no audit on replay.
  if v_closed is not null and coalesce(auth.uid(),new.created_by) is not null then
    insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
    values(v_parent.tenant_id,coalesce(auth.uid(),new.created_by),
      'sales_order_processing_closed','sales_order',v_parent.id,null,
      jsonb_build_object('invoice_id',new.id,'invoice_code',new.code,'origin','invoice'));
  end if;
  return new;
end $$;
revoke all on function public.remember_sales_order_processing_closed() from public,anon,authenticated;
create trigger remember_sales_order_processing_closed
after insert or update of status,source_order_id on public.invoices
for each row execute function public.remember_sales_order_processing_closed();
notify pgrst,'reload schema';
