import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fnb-hardening-fixture-'));
const map=new Map();
for(const [script,name,args] of [
 ['extract-payment-posting-chain','fnb-payment-posting-chain',[]],
 ['extract-payment-replay-chain','fnb-payment-replay-chain',[]],
 ['extract-supply-cost-flow','fnb-checkout-cost-ledger',['--replace','--ledger-only']],
 ['extract-cost-trigger','fnb-original-cost-trigger',[]]
]){
 const file=path.join(dir,name+'.sql');
 execFileSync(process.execPath,['scripts/fnb-db-test/'+script+'.mjs',file,...args]);
 map.set('/tmp/'+name+'.sql',file);
}
function expand(file){return fs.readFileSync(file,'utf8').replaceAll('\r\n','\n').replace(/^\\i(r?)\s+(.+)$/gm,(_,r,p)=>expand(map.get(p.trim())??path.resolve(path.dirname(file),p.trim()))).replace(/^\\set.*$/gm,'').replaceAll('current_database()',"'fnb_payment_cost_test'").replace(/select 'create role (?:anon|authenticated|service_role) nologin'\s+where not exists \(select 1 from pg_roles where rolname = '(?:anon|authenticated|service_role)'\) \\gexec/g,'');}
const fixture=expand('supabase/tests/00423_fnb_checkout_cost_ledger.integration.sql');
const support=String.raw`
alter table product_lots add column if not exists expiry_at timestamptz;
create or replace function _lot_expiry_moment_00527(p_date date,p_at timestamptz) returns timestamptz language sql immutable as $$ select coalesce(p_at,(p_date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh') $$;
create or replace function _allow_negative_sale_00473(uuid,uuid) returns boolean language sql as $$ select false $$;
create table if not exists modifier_groups(id uuid primary key,tenant_id uuid,name text,is_active boolean default true);
create table if not exists modifier_options(id uuid primary key,group_id uuid,scale_factor numeric,is_active boolean default true);
create table if not exists bom_modifier_option_quantities(bom_id uuid,material_id uuid,modifier_option_id uuid,quantity numeric);
alter table audit_log add column if not exists old_data jsonb;
alter table audit_log add column if not exists created_at timestamptz default now();
`;
const explicit=fs.readFileSync('supabase/migrations/00544_fnb_explicit_sweetness_only.sql','utf8');
const start=explicit.indexOf('CREATE OR REPLACE FUNCTION public.consume_bom_for_sale');
const end=explicit.indexOf('$function$;',start)+'$function$;'.length;
if(start<0||end<20)throw Error('consume boundary changed');

const receiptSource=fs.readFileSync('supabase/migrations/00245_harden_purchase_order_rpcs.sql','utf8').replaceAll('\r\n','\n');
const receiptStart=receiptSource.indexOf('create or replace function public.receive_purchase_items_atomic(');
const receiptEnd=receiptSource.indexOf('\n$$;',receiptStart)+4;
if(receiptStart<0||receiptEnd<10)throw Error('Receipt guard boundary changed');
const receiptFixture=String.raw`
create table purchase_orders(id uuid primary key,tenant_id uuid,branch_id uuid,code text,supplier_name text,status text,paid numeric default 0);
alter table purchase_order_items add column id uuid default gen_random_uuid(),add column quantity numeric default 0;
alter table cash_transactions add column status text default 'completed';
create function _receive_purchase_items_atomic_impl_00102(p_order uuid,p_lines jsonb,p_actor uuid)
returns jsonb language plpgsql as $$
declare item record;
begin
 for item in select product_id,quantity,unit_price from purchase_order_items where purchase_order_id=p_order and quantity>0 order by product_id desc loop
  perform test_receipt(p_order,item.product_id,item.quantity,item.unit_price);
 end loop;
 update purchase_orders set status='completed' where id=p_order;
 return jsonb_build_object('success',true);
end $$;
`;

const roles="do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;\n";
let sql=roles+fixture+'\n'+support+'\n'+receiptFixture+'\n'+receiptSource.slice(receiptStart,receiptEnd)+'\n'+explicit.slice(start,end)+'\n'+fs.readFileSync('supabase/migrations/00545_fnb_sweetness_note_topping_guard.sql','utf8');
if(!process.argv.includes('--before'))sql+='\n'+fs.readFileSync('supabase/migrations/00563_fnb_stock_boundary_and_lot_allocation.sql','utf8');
sql+=String.raw`
create function test_new_order(p_order uuid) returns void language plpgsql as $$
begin
 insert into kitchen_orders(id,tenant_id,branch_id,invoice_id,status,table_id,discount_amount,delivery_fee,platform_commission_percent) select p_order,tenant_id,branch_id,null,'pending',null,0,0,0 from kitchen_orders where id='00000000-0000-0000-0000-000000000005';
 insert into kitchen_order_items(kitchen_order_id,product_id,product_name,variant_label,quantity,unit_price)
 select p_order,product_id,product_name,variant_label,quantity,unit_price from kitchen_order_items where kitchen_order_id='00000000-0000-0000-0000-000000000005';
end $$;
`;
fs.writeFileSync(process.argv[2],sql);
fs.rmSync(dir,{recursive:true,force:true});
