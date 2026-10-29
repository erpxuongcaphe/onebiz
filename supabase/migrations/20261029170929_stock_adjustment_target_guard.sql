-- Additive entry point; keeps existing stock, lot, cost, audit and permission engines.
begin;
set local lock_timeout = '2s';
create or replace function public.adjust_stock_to_value_atomic(
  p_request_id uuid, p_branch_id uuid, p_product_id uuid,
  p_expected_quantity numeric, p_new_quantity numeric, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_tenant uuid; v_quantity numeric; v_delta numeric;
  v_payload jsonb; v_saved_payload jsonb;
  v_prior public.stock_movements%rowtype;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  if v_tenant is null or not coalesce(public.user_has_permission(v_actor,'inventory.adjust'),false)
    or not coalesce(public.user_has_branch_access(v_actor,p_branch_id),false)
    or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant) then
    raise exception 'STOCK_TARGET_DENIED' using errcode='42501';
  end if;
  if p_request_id is null or p_product_id is null or p_expected_quantity is null or p_new_quantity is null
    or p_expected_quantity::text in ('NaN','Infinity','-Infinity') or p_new_quantity::text in ('NaN','Infinity','-Infinity')
    or p_new_quantity<0 or p_new_quantity>999999999999 or round(p_new_quantity,4)<>p_new_quantity
    or length(btrim(coalesce(p_reason,'')))<1 or length(p_reason)>2000 then
    raise exception 'STOCK_TARGET_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||p_request_id::text,573));
  v_delta:=p_new_quantity-p_expected_quantity;
  v_payload:=jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,
    'expected_quantity',p_expected_quantity,'new_quantity',p_new_quantity,'reason',btrim(p_reason));
  select * into v_prior from public.stock_movements
   where tenant_id=v_tenant and reference_type='stock_adjustment' and reference_id=p_request_id limit 1;
  if found then
    select new_data into v_saved_payload from public.audit_log
     where tenant_id=v_tenant and user_id=v_actor and action='stock_target_adjustment'
       and entity_type='stock_adjustment' and entity_id=p_request_id limit 1;
    if v_prior.branch_id<>p_branch_id or v_prior.product_id<>p_product_id or v_prior.created_by<>v_actor
      or v_prior.quantity<>abs(v_delta) or v_prior.type<>(case when v_delta>0 then 'in' else 'out' end)
      or v_prior.note is distinct from btrim(p_reason) or v_saved_payload is distinct from v_payload then
      raise exception 'STOCK_TARGET_REQUEST_REUSED' using errcode='PT409';
    end if;
    return jsonb_build_object('success',true,'idempotent',true,'reference_id',p_request_id);
  end if;
  perform 1 from public.products where id=p_product_id and tenant_id=v_tenant for update;
  if not found then raise exception 'STOCK_TARGET_PRODUCT_DENIED' using errcode='42501'; end if;
  perform 1 from public.branch_stock where tenant_id=v_tenant and branch_id=p_branch_id and product_id=p_product_id for update;
  if exists(select 1 from public.branch_stock where tenant_id=v_tenant and branch_id=p_branch_id
      and product_id=p_product_id and variant_id is not null) then
    raise exception 'STOCK_TARGET_VARIANT_REQUIRES_CHECK' using errcode='22023';
  end if;
  select coalesce(sum(quantity),0) into v_quantity from public.branch_stock
   where tenant_id=v_tenant and branch_id=p_branch_id and product_id=p_product_id;
  if v_quantity<>p_expected_quantity then
    raise exception 'STOCK_TARGET_CHANGED' using errcode='PT409';
  end if;
  if v_delta=0 then return jsonb_build_object('success',true,'unchanged',true); end if;
  perform public.apply_manual_stock_movement_atomic(null,p_branch_id,null,jsonb_build_array(jsonb_build_object(
    'product_id',p_product_id,'type',case when v_delta>0 then 'in' else 'out' end,
    'quantity',abs(v_delta),'reference_type','stock_adjustment','reference_id',p_request_id,'note',btrim(p_reason))));
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
    values(v_tenant,v_actor,'stock_target_adjustment','stock_adjustment',p_request_id,v_payload);
  return jsonb_build_object('success',true,'reference_id',p_request_id,'quantity',p_new_quantity);
end $$;
revoke all on function public.adjust_stock_to_value_atomic(uuid,uuid,uuid,numeric,numeric,text) from public,anon;
grant execute on function public.adjust_stock_to_value_atomic(uuid,uuid,uuid,numeric,numeric,text) to authenticated;
notify pgrst,'reload schema';
commit;
