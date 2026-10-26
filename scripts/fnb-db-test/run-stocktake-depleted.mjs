import fs from 'node:fs';
import { createRequire } from 'node:module';
let source=fs.readFileSync('scripts/fnb-db-test/run-negative-stock.cjs','utf8');
const cases=fs.readFileSync('scripts/fnb-db-test/stocktake-depleted-cases.sql','utf8');
const install=`
await db.exec(\`create table inventory_checks(id uuid primary key,tenant_id uuid,branch_id uuid);\`);
let trigger=fn('00400_fnb_inventory_adjustment_transfer_cost.sql','_capture_fnb_inventory_cost_event_00400');
const opening=fs.readFileSync(root+'/supabase/migrations/00444_zero_stock_opening_cost_quotes.sql','utf8');
const oldGuard=opening.match(/old_text:=\\$old\\$(    if not found or v_costed_quantity <= 0[\\s\\S]*?)\\$old\\$;/)[1];
const newGuard=opening.match(/new_text:=\\$new\\$(    if not found or \\(v_costed_quantity[\\s\\S]*?)\\$new\\$;/)[1];
trigger=trigger.replace(oldGuard,newGuard);await db.exec(trigger);
await db.exec(fs.readFileSync(root+'/supabase/migrations/202610260004_inventory_check_depleted_branch_cost.sql','utf8'));
await db.exec(\`create trigger stocktake_cost after insert on stock_movements for each row when(new.reference_type in ('inventory_check','stock_adjustment')) execute function _capture_fnb_inventory_cost_event_00400();\`);
await db.exec(${JSON.stringify(cases)});
console.log('PASS: negative stocktake settles deficits FIFO; depleted stock uses recorded branch receipt; unknown and cross-branch costs rejected; zero opening quote preserved; other operations unchanged.');
`;
source=source.replace("console.log('PASS: branch policy, real BOM movements, cost deficits, receipts, returns, idempotency, unknown invoice cost');",install);
const run = new Function('require', source);
run(createRequire(new URL('./run-negative-stock.cjs', import.meta.url)));
