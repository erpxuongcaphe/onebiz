-- Trading status is reversible and independent of inventory/document deletion.
create or replace function public.set_product_trading_status_00559(
  p_ids uuid[], p_active boolean
) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid(); v_tenant uuid; v_ids uuid[]; v_product record; v_count integer := 0;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
  if v_tenant is null or not coalesce(public.user_has_permission(v_actor,'products.edit'),false) then
    raise exception using errcode='42501', message='Cần quyền sửa hàng hóa để bật/ngừng kinh doanh.';
  end if;
  if p_active is null then raise exception 'Thiếu trạng thái kinh doanh.'; end if;
  select array_agg(distinct id order by id) into v_ids from unnest(p_ids) id where id is not null;
  if coalesce(cardinality(v_ids),0)=0 or cardinality(v_ids)>5000 then
    raise exception 'Chọn từ 1 đến 5,000 mã hàng.';
  end if;
  -- Stable lock order; validate the whole selection before any write.
  perform id from public.products where tenant_id=v_tenant and id=any(v_ids) order by id for update;
  if (select count(*) from public.products where tenant_id=v_tenant and id=any(v_ids))<>cardinality(v_ids) then
    raise exception using errcode='42501', message='Có mã hàng không còn tồn tại hoặc ngoài doanh nghiệp.';
  end if;
  for v_product in select id,code,name,is_active from public.products
    where tenant_id=v_tenant and id=any(v_ids) and is_active is distinct from p_active order by id
  loop
    update public.products set is_active=p_active, updated_at=now() where id=v_product.id;
    insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
    values(v_tenant,v_actor,case when p_active then 'reactivate' else 'deactivate' end,'product',v_product.id,
      jsonb_build_object('code',v_product.code,'is_active',v_product.is_active),
      jsonb_build_object('is_active',p_active,'source','trading_status','scope','tenant'));
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.set_product_trading_status_00559(uuid[],boolean) from public, anon;
grant execute on function public.set_product_trading_status_00559(uuid[],boolean) to authenticated;
