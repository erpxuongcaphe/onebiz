// Isolated PostgreSQL: actual FIFO reconciliation, stock helpers, cost ledger
// and new RPCs. Does not connect to a Supabase project.
import fs from 'node:fs';
import {createRequire} from 'node:module';
let source=fs.readFileSync('scripts/fnb-db-test/run-negative-stock.cjs','utf8');
const install=`
await db.exec(\`create role service_role;create table inventory_checks(id uuid primary key,tenant_id uuid,branch_id uuid,code text,status text,note text,created_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
create table inventory_check_items(id uuid primary key default gen_random_uuid(),check_id uuid,product_id uuid,product_name text,system_stock numeric,actual_stock numeric,unit_cost numeric,difference numeric generated always as(actual_stock-system_stock) stored);
alter table products add column unit text default 'G';alter table products add column cost_price numeric default 100;
alter table product_lots add column initial_qty numeric;alter table product_lots add column source_type text;alter table product_lots add column note text;
alter function user_has_permission(uuid,text) set search_path=public;
alter function user_has_branch_access(uuid,uuid) set search_path=public;
create function cancel_inventory_check_atomic(uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not public.user_has_permission(auth.uid(),'inventory.check') then raise exception 'INSUFFICIENT_PERMISSION';end if;return '{}'::jsonb;end$$;\`);
let trigger=fn('00400_fnb_inventory_adjustment_transfer_cost.sql','_capture_fnb_inventory_cost_event_00400').replaceAll('\\r\\n','\\n');
const opening=fs.readFileSync(root+'/supabase/migrations/00444_zero_stock_opening_cost_quotes.sql','utf8').replaceAll('\\r\\n','\\n');
const oldGuard=opening.match(/old_text:=\\$old\\$(    if not found or v_costed_quantity <= 0[\\s\\S]*?)\\$old\\$;/)[1];
const newGuard=opening.match(/new_text:=\\$new\\$(    if not found or \\(v_costed_quantity[\\s\\S]*?)\\$new\\$;/)[1];
await db.exec(trigger.replace(oldGuard,newGuard));
await db.exec(fs.readFileSync(root+'/supabase/migrations/202610260004_inventory_check_depleted_branch_cost.sql','utf8').replaceAll('\\r\\n','\\n'));
await db.exec(\`create trigger stocktake_cost after insert on stock_movements for each row when(new.reference_type in ('inventory_check','stock_adjustment')) execute function _capture_fnb_inventory_cost_event_00400();\`);
await db.exec(fn('00284_fifo_ledger_transaction_alignment.sql','_reconcile_product_lots_to_branch_00284'));
await db.exec(fs.readFileSync(root+'/supabase/migrations/20261026115757_inventory_check_amendment.sql','utf8'));
await db.exec(fs.readFileSync(root+'/scripts/fnb-db-test/inventory-check-amendment-cases.sql','utf8'));
console.log('PASS: inventory check correction/cancellation, sales after count, cost/FIFO, explicit permissions, stale preview, retry, rollback, source isolation and masked costs.');
`;
source=source.replace("console.log('PASS: branch policy, real BOM movements, cost deficits, receipts, returns, idempotency, unknown invoice cost');",()=>install);
new Function('require',source)(createRequire(new URL('./run-negative-stock.cjs',import.meta.url)));
