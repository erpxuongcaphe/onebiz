-- Rollback 00358: khoi phuc than ham 00337, giu nguyen du lieu va audit da ghi.
begin;

create or replace function public.mark_order_processed(
  p_order_id uuid,
  p_invoice_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_tenant uuid;
  v_don    record;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;

  select p.tenant_id into v_tenant from public.profiles p
  where p.id = v_actor and p.is_active limit 1;
  if v_tenant is null then
    raise exception using errcode = '42501',
      message = 'Tai khoan chua gan cong ty hoac da bi khoa';
  end if;

  if not public.user_has_permission(v_actor, 'orders.create') then
    raise exception using errcode = '42501',
      message = 'Ban khong co quyen xu ly don dat hang.';
  end if;

  select i.id, i.source, i.deleted_at, i.branch_id into v_don
  from public.invoices i
  where i.id = p_order_id and i.tenant_id = v_tenant
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Khong tim thay don dat hang.';
  end if;
  if v_don.source <> 'order' then
    raise exception using errcode = '22023',
      message = 'Chi ap dung cho DON DAT HANG (source=order).';
  end if;
  if v_don.deleted_at is not null then
    raise exception using errcode = '22023', message = 'Don da bi xoa.';
  end if;
  if not public.user_has_branch_access(v_actor, v_don.branch_id) then
    raise exception using errcode = '42501',
      message = 'Ban khong co quyen thao tac tai chi nhanh cua don nay.';
  end if;

  if p_invoice_id is not null and not exists (
    select 1 from public.invoices c
    where c.id = p_invoice_id
      and c.tenant_id = v_tenant
      and c.source_order_id = p_order_id
      and c.branch_id = v_don.branch_id
      and c.deleted_at is null
      and c.status = 'completed'
      and c.voided_at is null
      and c.cancelled_at is null
  ) then
    raise exception using errcode = '22023',
      message = 'Hoa don gan vao phai la don ban con DA THANH TOAN va con hieu luc cua chinh don nay.';
  end if;

  update public.invoices
  set fulfilled_by_id = p_invoice_id
  where id = p_order_id and tenant_id = v_tenant;

  return jsonb_build_object(
    'order_id', p_order_id,
    'fulfilled_by_id', p_invoice_id,
    'trang_thai', case when p_invoice_id is null then 'da_mo_lai' else 'da_hoan_tat' end
  );
end $$;

revoke all on function public.mark_order_processed(uuid, uuid) from public, anon;
grant execute on function public.mark_order_processed(uuid, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
