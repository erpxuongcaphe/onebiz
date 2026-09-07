-- READ ONLY. No receipt, stock, payment, permission or schema changes.
select p.proname as function_name,
       position('ceil(v_quantity * v_unit_price)' in pg_get_functiondef(p.oid)) > 0 as rounds_line_up,
       position('PAID_AMOUNT_EXCEEDS_TOTAL' in pg_get_functiondef(p.oid)) > 0 as keeps_overpayment_guard
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='save_purchase_order_atomic';
