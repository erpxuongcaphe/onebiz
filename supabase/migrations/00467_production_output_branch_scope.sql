-- Validate new output selections without changing existing production history.
begin;
create or replace function public.validate_production_output_scope_00467()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_mode text; v_prepared boolean;
begin
 select cascade_mode into v_mode from public.branches
 where id=new.branch_id and tenant_id=new.tenant_id;
 if not found then raise exception 'PRODUCTION_BRANCH_NOT_FOUND'; end if;
 select is_fnb_stock_item into v_prepared from public.products
 where id=new.product_id and tenant_id=new.tenant_id and is_active;
 if not found then raise exception 'PRODUCTION_PRODUCT_NOT_FOUND'; end if;
 if v_mode='outlet' and not coalesce(v_prepared,false) then
   raise exception 'FNB_PRODUCTION_PREPARED_OUTPUT_REQUIRED';
 end if;
 if not exists(select 1 from public.bom where id=new.bom_id
   and tenant_id=new.tenant_id and product_id=new.product_id and is_active
   and (branch_id is null or branch_id=new.branch_id)) then
   raise exception 'PRODUCTION_BOM_BRANCH_MISMATCH';
 end if;
 return new;
end; $$;
revoke all on function public.validate_production_output_scope_00467() from public,anon,authenticated;
create trigger validate_production_output_scope_00467
before insert or update of branch_id,product_id,bom_id on public.production_orders
for each row execute function public.validate_production_output_scope_00467();
commit;
notify pgrst,'reload schema';
