// Reuse the complete payment fixture; add the migration at its real posting boundary.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const setup = String.raw`
 await db.exec("alter table product_lots add column if not exists expiry_at timestamptz");
 await db.exec("create or replace function public._lot_expiry_moment_00527(p_date date,p_at timestamptz) returns timestamptz language sql immutable as $$ select coalesce(p_at,(p_date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh') $$");
 await db.exec("create or replace function public._allow_negative_sale_00473(uuid,uuid) returns boolean language sql as $$ select false $$");
 await db.exec("create table if not exists modifier_groups(id uuid primary key,tenant_id uuid); create table if not exists modifier_options(id uuid primary key,group_id uuid,scale_factor numeric); create table if not exists bom_modifier_option_quantities(bom_id uuid,material_id uuid,modifier_option_id uuid,quantity numeric)");
 await db.exec("alter table audit_log add column old_data jsonb; alter table audit_log add column created_at timestamptz default now()");
 await db.exec("alter table modifier_groups add column if not exists name text; alter table modifier_groups add column if not exists is_active boolean default true; alter table modifier_options add column if not exists is_active boolean default true");
 await db.exec(fs.readFileSync('supabase/migrations/00544_fnb_explicit_sweetness_only.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/00545_fnb_sweetness_note_topping_guard.sql','utf8'));
 const beforeMigration=JSON.stringify((await db.query("select (select jsonb_agg(b order by product_id) from branch_stock b) stock,(select count(*) from stock_movements) movements,(select count(*) from invoices) invoices")).rows);
 await db.exec(fs.readFileSync('supabase/migrations/00562_fnb_stock_boundary_and_lot_allocation.sql','utf8'));
 const afterMigration=JSON.stringify((await db.query("select (select jsonb_agg(b order by product_id) from branch_stock b) stock,(select count(*) from stock_movements) movements,(select count(*) from invoices) invoices")).rows);
 assert.equal(afterMigration,beforeMigration,'migration never rewrites historical quantities or documents');
 await db.exec("grant usage on schema public,auth to authenticated; grant execute on function test_pay(uuid) to authenticated");
 for(const call of ["increment_product_stock('00000000-0000-0000-0000-000000000011',1)","upsert_branch_stock('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000011',1)"]){
  await db.exec("set role authenticated");
  await assert.rejects(()=>db.query('select '+call),/permission denied/);
  await db.exec("reset role");
 }
 const tenant='00000000-0000-0000-0000-000000000002',branch='00000000-0000-0000-0000-000000000003',material='00000000-0000-0000-0000-000000000011';
 await db.exec("delete from lot_allocations; delete from product_lots");
 await db.exec("insert into product_lots(id,tenant_id,product_id,branch_id,lot_number,current_qty,expiry_date,expiry_at,status,received_date,created_at) values "+
 "('00000000-0000-0000-0000-000000000081','"+tenant+"','"+material+"','"+branch+"','EXPIRED-HOUR',1,current_date,now()-interval '1 hour','active',current_date,now()),"+
 "('00000000-0000-0000-0000-000000000082','"+tenant+"','"+material+"','"+branch+"','ELIGIBLE',1,current_date+1,now()+interval '2 hours','active',current_date,now())");
 const allocation=(await db.query("select _allocate_fnb_sale_lots_00562('"+tenant+"','"+material+"','"+branch+"',1.5,'invoice','00000000-0000-0000-0000-000000000005') result")).rows[0].result;
 assert.equal(Number(allocation.remaining),.5,'missing eligible lots remain explicit');
 assert.equal(Number((await db.query("select current_qty from product_lots where lot_number='EXPIRED-HOUR'")).rows[0].current_qty),1,'never allocate a same-day expired lot');
 assert.equal(Number((await db.query("select (new_data->>'unallocated_quantity')::numeric q from audit_log where action='fnb_sale_lot_allocation_shortfall' order by created_at desc limit 1")).rows[0].q),.5,'exact allocation exception is auditable');
 await db.exec("delete from lot_allocations; delete from product_lots");
 await db.exec("insert into product_lots(id,tenant_id,product_id,branch_id,lot_number,current_qty,status,received_date,created_at) values('00000000-0000-0000-0000-000000000083','"+tenant+"','"+material+"','"+branch+"','PAYMENT',10,'active',current_date,now())");
 await db.exec("create function fail_lot_00562() returns trigger language plpgsql as $$ begin if current_setting('test.fail_lot',true)='true' then raise exception 'TEST_ALLOCATOR_FAILURE';end if;return new;end $$; create trigger fail_lot before insert on lot_allocations for each row execute function fail_lot_00562()");
 const beforeFailure=JSON.stringify((await db.query("select (select count(*) from invoices) invoices,(select jsonb_agg(b order by product_id) from branch_stock b) stock,(select count(*) from cash_transactions) cash,(select count(*) from stock_movements) movements")).rows);
 await db.exec("select set_config('test.fail_lot','true',false)");
 await assert.rejects(()=>db.query('select test_pay()'),/TEST_ALLOCATOR_FAILURE/);
 const afterFailure=JSON.stringify((await db.query("select (select count(*) from invoices) invoices,(select jsonb_agg(b order by product_id) from branch_stock b) stock,(select count(*) from cash_transactions) cash,(select count(*) from stock_movements) movements")).rows);
 assert.equal(afterFailure,beforeFailure,'allocator database failure rolls back invoice, money and stock together');
 await db.exec("select set_config('test.fail_lot','false',false)");
 await db.exec("set role authenticated");
`;
const original=fs.readFileSync('scripts/fnb-db-test/run-fnb-stock-posting-local.mjs','utf8');
let generated=original.replace(" const first=",()=>setup+"\n const first=");
generated=generated.replace(" const snapshot=async", " await db.exec('reset role');\n const snapshot=async");
generated=generated.replace(" console.log('PASS: actual", " console.log('PASS: 00562 migration preserves history; private helpers; exact-hour lots; explicit gap audit; allocator failure rollback; authorized payment and replay');\n console.log('PASS: actual");
generated=generated.replace('console.error(error.message,error.where??', 'console.error(error.message,error.position,error.query?.slice(Math.max(0,Number(error.position)-150),Number(error.position)+150),error.where??');
if(generated===original)throw Error('Payment fixture boundary changed');
fs.mkdirSync('.tmp',{recursive:true});
const target=path.resolve('.tmp/stock-hardening-00562.generated.mjs');
fs.writeFileSync(target,generated);
execFileSync(process.execPath,[target,path.resolve(process.argv[2])],{stdio:'inherit'});






