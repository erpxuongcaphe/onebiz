-- Run only in a dedicated CI database, never against a live branch.
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
create table public.profiles(id uuid primary key, tenant_id uuid, is_active boolean);
create table public.customers(id uuid primary key, tenant_id uuid, name text, is_active boolean default true);
create table public.kitchen_orders(id uuid primary key, tenant_id uuid, branch_id uuid, invoice_id uuid, merged_into_id uuid, parent_order_id uuid, status text, updated_at timestamptz default now());
create function public.user_has_permission(uuid,text) returns boolean language sql as $$ select coalesce(current_setting('test.permission',true),'yes')='yes' $$;
create function public.user_has_branch_access(uuid,uuid) returns boolean language sql as $$ select coalesce(current_setting('test.branch_access',true),'yes')='yes' $$;
-- Delegate stub lets this fixture exercise wrapper transaction/replay behavior.
create function public.fnb_send_to_kitchen_atomic_v2(p_branch_id uuid,p_table_id uuid default null,p_order_type text default 'dine_in',p_note text default null,p_idempotency_key text default null,p_items jsonb default '[]',p_delivery_platform text default null,p_delivery_fee numeric default 0,p_platform_commission_percent numeric default null,p_delivery_staff_id uuid default null,p_delivery_distance_tier text default null,p_existing_order_id uuid default null)
returns jsonb language sql as $$ select jsonb_build_object('kitchen_order_id',p_idempotency_key,'order_number','TEST') $$;
\ir ../migrations/00447_fnb_order_customer_context.sql
insert into profiles values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',true);
insert into customers values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Lan',true),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','Other tenant',true);
insert into kitchen_orders(id,tenant_id,branch_id,status) values ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','pending');
select set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
do $$ begin
  perform fnb_select_order_customer_v1('40000000-0000-0000-0000-000000000001',null);
  if not exists(select 1 from kitchen_orders where customer_selected and customer_id is null and customer_name='Khách lẻ') then raise exception 'walk-in not persisted'; end if;
  perform fnb_select_order_customer_v1('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
  begin perform fnb_select_order_customer_v1('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002'); raise exception 'cross tenant accepted'; exception when insufficient_privilege then null; end;
  if (select customer_name from kitchen_orders limit 1)<>'Lan' then raise exception 'failed selection changed customer'; end if;
  perform set_config('test.branch_access','no',false);
  begin perform fnb_select_order_customer_v1('40000000-0000-0000-0000-000000000001',null); raise exception 'branch denied accepted'; exception when insufficient_privilege then null; end;
  perform set_config('test.branch_access','yes',false);
  perform set_config('test.permission','no',false);
  begin perform fnb_select_order_customer_v1('40000000-0000-0000-0000-000000000001',null); raise exception 'permission denied accepted'; exception when insufficient_privilege then null; end;
  perform set_config('test.permission','yes',false);
  -- Retrying the original send must retain a later selected customer.
  perform fnb_send_to_kitchen_with_customer_v1(jsonb_build_object('customer_selected',true,'p_idempotency_key','40000000-0000-0000-0000-000000000001'));
  if (select customer_name from kitchen_orders limit 1)<>'Lan' then raise exception 'replay changed customer'; end if;
  begin perform fnb_send_to_kitchen_with_customer_v1('{}'); raise exception 'unselected accepted' using errcode='XX000'; exception when raise_exception then null; end;
end $$;
insert into kitchen_orders(id,tenant_id,branch_id,status,parent_order_id) values ('40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','pending','40000000-0000-0000-0000-000000000001');
do $$ begin
  if not exists(select 1 from kitchen_orders where id='40000000-0000-0000-0000-000000000002' and customer_name='Lan' and customer_selected) then raise exception 'split lost customer'; end if;
  perform fnb_select_order_customer_v1('40000000-0000-0000-0000-000000000002',null);
  update kitchen_orders set merged_into_id='40000000-0000-0000-0000-000000000001' where id='40000000-0000-0000-0000-000000000002';
  if exists(select 1 from kitchen_orders where id='40000000-0000-0000-0000-000000000001' and customer_selected) then raise exception 'conflicting merge kept customer'; end if;
  update kitchen_orders set invoice_id='60000000-0000-0000-0000-000000000001' where id='40000000-0000-0000-0000-000000000001';
  begin perform fnb_select_order_customer_v1('40000000-0000-0000-0000-000000000001',null); raise exception 'paid accepted' using errcode='XX000'; exception when raise_exception then null; end;
end $$;
