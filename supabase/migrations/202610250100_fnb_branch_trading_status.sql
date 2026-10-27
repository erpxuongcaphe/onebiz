-- No business-data backfill. Only branch menu membership changes on explicit request.
begin;
set local lock_timeout = '2s';

-- Serialize the old full-policy editor and the new per-branch switch together.
alter function public.save_fnb_product_branch_menu_policy(uuid,text,uuid[]) rename to _save_fnb_menu_policy_impl_20261025;
revoke all on function public._save_fnb_menu_policy_impl_20261025(uuid,text,uuid[]) from public,anon,authenticated,service_role;
create function public.save_fnb_product_branch_menu_policy(p_product_id uuid,p_mode text,p_branch_ids uuid[] default '{}'::uuid[])
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
begin
  if not coalesce(public.user_has_permission(auth.uid(),'products.edit'),false) then
    raise exception 'Cần quyền sửa hàng hóa.' using errcode='42501';
  end if;
  perform id from public.products where id=p_product_id and tenant_id=public.get_user_tenant_id() for update;
  return public._save_fnb_menu_policy_impl_20261025(p_product_id,p_mode,p_branch_ids);
end; $$;
revoke all on function public.save_fnb_product_branch_menu_policy(uuid,text,uuid[]) from public,anon;
grant execute on function public.save_fnb_product_branch_menu_policy(uuid,text,uuid[]) to authenticated;

create function public.set_fnb_branch_trading_status_20261025(p_ids uuid[],p_active boolean,p_branch_id uuid)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare
  actor uuid:=auth.uid(); tenant uuid; ids uuid[]; item record; mode text; was_active boolean; changed integer:=0;
begin
  select tenant_id into tenant from public.profiles where id=actor and is_active;
  if tenant is null or not coalesce(public.user_has_permission(actor,'products.edit'),false) then
    raise exception 'Cần quyền sửa hàng hóa.' using errcode='42501';
  end if;
  if p_branch_id is null or not coalesce(public.user_has_branch_access(actor,p_branch_id),false)
     or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=tenant and is_active
        and (cascade_mode='outlet' or branch_type='store')) then
    raise exception 'Không có quyền chỉnh menu tại chi nhánh này.' using errcode='42501';
  end if;
  if p_active is null or array_position(p_ids,null) is not null then raise exception 'Thiếu trạng thái hoặc mã món.';end if;
  select array_agg(distinct x order by x) into ids from unnest(p_ids) x;
  if coalesce(cardinality(ids),0)=0 or cardinality(ids)>5000 then raise exception 'Chọn từ 1 đến 5,000 món.';end if;
  perform id from public.products where tenant_id=tenant and id=any(ids) order by id for update;
  if (select count(*) from public.products where tenant_id=tenant and id=any(ids) and product_type='sku' and channel='fnb')<>cardinality(ids) then
    raise exception 'Chỉ chọn món F&B thuộc doanh nghiệp.' using errcode='42501';
  end if;
  if p_active and exists(select 1 from public.products where id=any(ids) and not is_active) then
    raise exception 'Có mã món đã ngừng toàn hệ thống. Cần kiểm tra và khôi phục mã trước; chưa thay đổi menu nào.';
  end if;
  for item in select id,code from public.products where id=any(ids) order by id loop
    select policy.mode into mode from public.fnb_product_branch_menu_policies policy where policy.product_id=item.id and tenant_id=tenant;
    was_active:=case mode
      when 'only' then exists(select 1 from public.fnb_product_branch_menu_scopes where product_id=item.id and branch_id=p_branch_id)
      when 'except' then not exists(select 1 from public.fnb_product_branch_menu_scopes where product_id=item.id and branch_id=p_branch_id)
      else true end;
    if was_active=p_active then continue;end if;
    if mode is null then
      insert into public.fnb_product_branch_menu_policies(tenant_id,product_id,mode) values(tenant,item.id,'except');
      mode:='except';
    end if;
    if (mode='only' and p_active) or (mode='except' and not p_active) then
      insert into public.fnb_product_branch_menu_scopes(tenant_id,product_id,branch_id) values(tenant,item.id,p_branch_id)
      on conflict(product_id,branch_id) do nothing;
    else
      delete from public.fnb_product_branch_menu_scopes where tenant_id=tenant and product_id=item.id and branch_id=p_branch_id;
    end if;
    -- Empty ONLY remains explicit: all outlets blocked, including future outlets.
    -- Empty EXCEPT equals the legacy all-outlet default.
    if mode='except' and not exists(select 1 from public.fnb_product_branch_menu_scopes where product_id=item.id) then
      delete from public.fnb_product_branch_menu_policies where tenant_id=tenant and product_id=item.id;
    end if;
    insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
    values(tenant,actor,'update','product',item.id,
      jsonb_build_object('is_available',was_active),jsonb_build_object('is_available',p_active,'branch_id',p_branch_id,'code',item.code,'scope','branch','source','fnb_trading_status'));
    changed:=changed+1;
  end loop;
  return changed;
end; $$;
revoke all on function public.set_fnb_branch_trading_status_20261025(uuid[],boolean,uuid) from public,anon;
grant execute on function public.set_fnb_branch_trading_status_20261025(uuid[],boolean,uuid) to authenticated;

-- Old browser tabs cannot accidentally switch a shared F&B SKU globally.
-- Retail/NVL retain the existing implementation unchanged.
alter function public.set_product_trading_status_00559(uuid[],boolean) rename to _set_product_trading_status_impl_20261025;
revoke all on function public._set_product_trading_status_impl_20261025(uuid[],boolean) from public,anon,authenticated,service_role;
create function public.set_product_trading_status_00559(p_ids uuid[],p_active boolean)
returns integer language plpgsql security definer set search_path=public,extensions as $$
begin
  if exists(select 1 from public.products where tenant_id=public.get_user_tenant_id() and id=any(p_ids) and channel='fnb') then
    raise exception 'Món F&B: chọn một chi nhánh và tải lại trang để bật/ngừng riêng cho quán.';
  end if;
  return public._set_product_trading_status_impl_20261025(p_ids,p_active);
end; $$;
revoke all on function public.set_product_trading_status_00559(uuid[],boolean) from public,anon;
grant execute on function public.set_product_trading_status_00559(uuid[],boolean) to authenticated;
notify pgrst,'reload schema';
commit;
