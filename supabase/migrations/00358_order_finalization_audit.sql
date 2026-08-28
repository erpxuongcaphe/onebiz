-- ============================================================================
-- 00358 - Chot don dat hang co nhat ky, khong suy dien theo so luong
--
-- Bat bien:
--   * Nhan vien chu dong chot/mở lai; chenh lech so luong KHONG chan.
--   * Hoa don neo phai completed, con hieu luc, dung don/tenant/chi nhanh.
--   * Chi cap nhat invoices.fulfilled_by_id; khong sua status, tien, kho, cong no.
--   * Ghi audit_log cung transaction de truy duoc ai chot/mo lai va luc nao.
-- ============================================================================

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
  v_actor         uuid := auth.uid();
  v_tenant        uuid;
  v_don           record;
  v_invoice_codes text[] := array[]::text[];
  v_changed_at    timestamptz := now();
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'UNAUTHENTICATED';
  end if;

  select p.tenant_id into v_tenant
  from public.profiles p
  where p.id = v_actor and p.is_active
  limit 1;
  if v_tenant is null then
    raise exception using errcode = '42501',
      message = 'Tai khoan chua gan cong ty hoac da bi khoa';
  end if;

  if not public.user_has_permission(v_actor, 'orders.create') then
    raise exception using errcode = '42501',
      message = 'Ban khong co quyen xu ly don dat hang.';
  end if;

  select i.id, i.code, i.source, i.deleted_at, i.branch_id, i.fulfilled_by_id
  into v_don
  from public.invoices i
  where i.id = p_order_id and i.tenant_id = v_tenant
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Khong tim thay don dat hang.';
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
    select 1
    from public.invoices c
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
      message = 'Hoa don neo phai la don ban con DA THANH TOAN va con hieu luc cua chinh don nay.';
  end if;

  select coalesce(array_agg(c.code order by c.ngay_chung_tu, c.id), array[]::text[])
  into v_invoice_codes
  from public.invoices c
  where c.tenant_id = v_tenant
    and c.source_order_id = p_order_id
    and c.branch_id = v_don.branch_id
    and c.deleted_at is null
    and c.status = 'completed'
    and c.voided_at is null
    and c.cancelled_at is null;

  -- Duy nhat mot cot nghiep vu duoc cap nhat. Chenh lech so luong khong tham
  -- gia dieu kien chot va khong ghi dong hang, kho, quy hay cong no.
  update public.invoices
  set fulfilled_by_id = p_invoice_id
  where id = p_order_id and tenant_id = v_tenant;

  if v_don.fulfilled_by_id is distinct from p_invoice_id then
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      v_tenant,
      v_actor,
      case
        when p_invoice_id is null then 'sales_order_processing_reopened'
        else 'sales_order_processing_completed'
      end,
      'sales_order',
      p_order_id,
      jsonb_build_object(
        'fulfilled_by_id', v_don.fulfilled_by_id,
        'order_code', v_don.code
      ),
      jsonb_build_object(
        'fulfilled_by_id', p_invoice_id,
        'invoice_codes', to_jsonb(v_invoice_codes),
        'changed_at', v_changed_at,
        'quantity_match_required', false
      )
    );
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'fulfilled_by_id', p_invoice_id,
    'invoice_codes', to_jsonb(v_invoice_codes),
    'actor_id', v_actor,
    'changed_at', v_changed_at,
    'trang_thai', case
      when p_invoice_id is null then 'da_mo_lai'
      else 'da_hoan_tat'
    end
  );
end $$;

revoke all on function public.mark_order_processed(uuid, uuid) from public, anon;
grant execute on function public.mark_order_processed(uuid, uuid) to authenticated;

comment on function public.mark_order_processed(uuid, uuid) is
  '00358: chot/mo lai don dat hang co audit. Chi ghi fulfilled_by_id; khong bat so luong khop. Tra tat ca ma hoa don con con hieu luc.';

commit;

notify pgrst, 'reload schema';
