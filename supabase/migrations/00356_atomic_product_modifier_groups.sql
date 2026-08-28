-- 00356 - FnB: lưu toàn bộ nhóm tuỳ chọn cấp món trong một giao dịch.
--
-- Trước migration này, trình duyệt xóa liên kết cũ rồi chèn liên kết mới bằng
-- hai request. Mất mạng giữa hai request có thể làm món mất Mức đường/Mức đá.
-- Hàm mới khóa đúng một sản phẩm, kiểm tenant/quyền/kênh và thay danh sách
-- trong cùng transaction. Migration không tự sửa dữ liệu cấu hình hiện có.

begin;

do $prerequisite$
begin
  if to_regclass('public.product_modifier_groups') is null
     or to_regclass('public.modifier_groups') is null
     or to_regclass('public.products') is null
     or to_regprocedure('public.user_has_permission(uuid,text)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00356_PREREQUISITE_MISSING';
  end if;
end;
$prerequisite$;

create or replace function public.save_product_modifier_groups_atomic(
  p_product_id uuid,
  p_group_ids uuid[] default '{}'::uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_group_ids uuid[] := coalesce(p_group_ids, '{}'::uuid[]);
  v_valid_group_count integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.tenant_id into v_tenant
    from public.profiles p
   where p.id = v_actor and p.is_active;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.edit') then
    raise exception using errcode = '42501', message = 'FNB_PRODUCT_MODIFIER_PERMISSION_DENIED';
  end if;

  -- Khóa món để hai người không thể ghi đè danh sách của nhau giữa chừng.
  perform 1
    from public.products p
   where p.id = p_product_id
     and p.tenant_id = v_tenant
     and p.product_type = 'sku'
     and p.channel = 'fnb'
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_PRODUCT_MODIFIER_PRODUCT_NOT_FNB_SKU';
  end if;

  if array_position(v_group_ids, null) is not null then
    raise exception using errcode = 'P0001', message = 'FNB_PRODUCT_MODIFIER_GROUP_REQUIRED';
  end if;
  if cardinality(v_group_ids) <> (
    select count(distinct group_id) from unnest(v_group_ids) selected(group_id)
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_PRODUCT_MODIFIER_GROUP_DUPLICATE';
  end if;

  if cardinality(v_group_ids) > 0 then
    select count(*) into v_valid_group_count
      from public.modifier_groups g
     where g.id = any(v_group_ids)
       and g.tenant_id = v_tenant
       and g.is_active
       and g.channel in ('fnb', 'all');
    if v_valid_group_count <> cardinality(v_group_ids) then
      raise exception using errcode = 'P0001', message = 'FNB_PRODUCT_MODIFIER_GROUP_INVALID';
    end if;
  end if;

  delete from public.product_modifier_groups pmg
   where pmg.tenant_id = v_tenant
     and pmg.product_id = p_product_id;

  insert into public.product_modifier_groups (
    tenant_id,
    product_id,
    modifier_group_id,
    sort_order
  )
  select
    v_tenant,
    p_product_id,
    selected.group_id,
    selected.ordinality::integer - 1
  from unnest(v_group_ids) with ordinality as selected(group_id, ordinality);

  return jsonb_build_object(
    'success', true,
    'product_id', p_product_id,
    'group_count', cardinality(v_group_ids)
  );
end;
$function$;

alter function public.save_product_modifier_groups_atomic(uuid, uuid[]) owner to postgres;
revoke all on function public.save_product_modifier_groups_atomic(uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.save_product_modifier_groups_atomic(uuid, uuid[])
  to authenticated;

comment on function public.save_product_modifier_groups_atomic(uuid, uuid[]) is
  '00356: Thay nguyên tử toàn bộ nhóm tuỳ chọn cấp món của một SKU FnB. Mảng rỗng trả món về kế thừa nhóm hàng.';

commit;

notify pgrst, 'reload schema';
