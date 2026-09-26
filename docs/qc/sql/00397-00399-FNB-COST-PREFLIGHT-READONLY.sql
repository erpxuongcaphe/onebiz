-- Metadata only for 00397-00399. Does not invoke a business RPC or change data.
begin transaction read only;
set local statement_timeout = '5s';
set local lock_timeout = '1s';

select name, to_regclass(name) is not null as prerequisite_ok
from (values
  ('public.fnb_branch_product_cost_events'),
  ('public.fnb_branch_product_cost_balances'),
  ('public.stock_movements'), ('public.sales_returns'),
  ('public.invoices'), ('public.production_orders'), ('public.purchase_orders')
) as required(name);

select name, to_regprocedure(name) is not null as installed
from (values
  ('public._fnb_branch_cost_tracking_enabled_00390(uuid,uuid)'),
  ('public._post_fnb_branch_cost_in_00390(uuid,uuid,uuid,numeric,numeric,text,text,uuid,uuid,text,uuid)'),
  ('public._capture_fnb_branch_cost_stock_movement_00390()'),
  ('public._capture_fnb_return_bom_cost_00397()'),
  ('public._capture_fnb_purchase_revert_cost_00399()'),
  ('public._post_fnb_branch_cost_out_00390(uuid,uuid,uuid,numeric,text,text,uuid,uuid,text,uuid)'),
  ('public.revert_production_materials(uuid,text)')
) as required(name);

select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = to_regclass('public.fnb_branch_product_cost_events')
  and c.conname = 'fnb_branch_product_cost_events_source_type_check';

select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
from pg_trigger t
where t.tgrelid = to_regclass('public.stock_movements')
  and not t.tgisinternal
  and t.tgname in ('capture_fnb_return_bom_cost_00396',
    'capture_fnb_return_bom_cost_00397', 'capture_fnb_branch_cost_stock_movement_00390',
    'capture_fnb_purchase_revert_cost_00399');

select p.oid::regprocedure as function_name,
  md5(p.prosrc) as source_hash,
  position('production_cancel_restore' in p.prosrc) > 0 as production_restore_installed,
  pg_get_functiondef(p.oid) as definition
from pg_proc p
where p.oid in (
  to_regprocedure('public._capture_fnb_branch_cost_stock_movement_00390()'),
  to_regprocedure('public.revert_production_materials(uuid,text)')
);
commit;
