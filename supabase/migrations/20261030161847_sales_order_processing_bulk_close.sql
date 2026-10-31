-- One validated transaction for a selected set; preview is the safe default.
create function public.close_sales_orders_processing(
  p_order_ids uuid[], p_reason text default null, p_apply boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_tenant uuid; v_id uuid; v_row record;
  v_closed boolean; v_orders jsonb:='[]'::jsonb; v_already int:=0; v_count int:=0;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
  if v_actor is null or v_tenant is null or not public.user_has_permission(v_actor,'orders.create') then
    raise exception using errcode='42501',message='Bạn không có quyền xử lý đơn đặt hàng.';
  end if;
  if coalesce(cardinality(p_order_ids),0) not between 1 and 100 or array_position(p_order_ids,null) is not null then
    raise exception using errcode='22023',message='Chọn từ 1 đến 100 đơn mỗi lần.';
  end if;
  if p_apply is null then
    raise exception using errcode='22023',message='Chưa xác nhận thao tác xử lý.';
  end if;
  if p_apply and length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
    raise exception using errcode='22023',message='Nhập lý do từ 3 đến 500 ký tự.';
  end if;
  -- Canonical lock order across batches, consistent with single-order closure.
  for v_id in select distinct x from unnest(p_order_ids) x order by x loop
    select id,code,branch_id,status into v_row from public.invoices
      where id=v_id and tenant_id=v_tenant and source='order' and deleted_at is null
      for update;
    if not found then
      raise exception using errcode='P0002',message='Có đơn không còn khả dụng. Tải lại danh sách và chọn lại.';
    end if;
    if not public.user_has_branch_access(v_actor,v_row.branch_id) then
      raise exception using errcode='42501',message='Có đơn ngoài chi nhánh bạn được phép xử lý.';
    end if;
    if v_row.status='cancelled' then
      raise exception using errcode='22023',message='Đơn '||v_row.code||' đã hủy. Bỏ chọn đơn này để tiếp tục.';
    end if;
    select exists(select 1 from public.sales_order_processing_closures where order_id=v_id and closed_at is not null)
      or exists(select 1 from public.invoices where id=v_id and fulfilled_by_id is not null)
      into v_closed;
    v_count:=v_count+1;
    if v_closed then v_already:=v_already+1; end if;
    v_orders:=v_orders||jsonb_build_array(jsonb_build_object('id',v_id,'code',v_row.code,'already_closed',v_closed));
  end loop;
  if p_apply then
    for v_id in select (value->>'id')::uuid from jsonb_array_elements(v_orders)
      where not (value->>'already_closed')::boolean loop
      perform public.close_sales_order_processing(v_id,p_reason);
    end loop;
  end if;
  return jsonb_build_object('orders',v_orders,'selected_count',v_count,
    'already_closed_count',v_already,'to_close_count',v_count-v_already,
    'applied',p_apply);
end $$;
revoke all on function public.close_sales_orders_processing(uuid[],text,boolean) from public,anon;
grant execute on function public.close_sales_orders_processing(uuid[],text,boolean) to authenticated;
notify pgrst,'reload schema';
