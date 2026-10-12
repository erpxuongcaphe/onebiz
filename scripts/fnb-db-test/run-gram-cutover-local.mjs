// Disposable PostgreSQL engine. Runs real UOM/BOM/return/consumption functions;
// legacy invoice creation and FIFO are bounded fixtures, never a live database.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db=new PGlite();
const read=file=>fs.readFileSync('supabase/migrations/'+file,'utf8');
function fn(file,name){const s=read(file);const match=new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(`,'i').exec(s);if(!match)throw Error(name);const tag=/as\s+(\$[a-zA-Z_]*\$)/i.exec(s.slice(match.index))?.[1];const end=tag ? s.indexOf('\n'+tag+';',match.index+tag.length) : -1;if(end<0)throw Error('boundary '+name);return s.slice(match.index,end+tag.length+2);}
const tenant='10000000-0000-0000-0000-000000000001',branch='20000000-0000-0000-0000-000000000001',actor='40000000-0000-0000-0000-000000000001';
const first='30000000-0000-0000-0000-000000000001',second='30000000-0000-0000-0000-000000000002',drink='30000000-0000-0000-0000-000000000003';
try {
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function user_has_permission(uuid,text) returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'true')='true'$$;
create function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql stable as $$select $3='${branch}'::uuid and $2='${tenant}'::uuid$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $2='${branch}'::uuid$$;
create table profiles(id uuid primary key,tenant_id uuid,role text,is_active boolean default true,created_at timestamptz default now());
insert into profiles values('${actor}','${tenant}','owner',true,now());select set_config('request.jwt.claim.sub','${actor}',false);
create table products(id uuid primary key,tenant_id uuid,unit text,stock_unit text,purchase_unit text,sell_unit text,
 stock numeric(18,4),min_stock numeric(18,4) default 0,max_stock numeric(18,4) default 0,
 cost_price numeric(18,2),sell_price numeric(18,2) default 0,is_fnb_stock_item boolean,is_active boolean default true,
 code text,name text,bom_code text,updated_at timestamptz);
create table branch_stock(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid references products,
 variant_id uuid,quantity numeric(18,4),reserved numeric(18,4) default 0);
create table stock_movements(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid references products,
 type text,quantity numeric(18,4),unit_cost numeric(18,4),unit_price numeric(18,4),reference_type text,reference_id uuid,note text,created_by uuid);
create table product_lots(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid references products,
 initial_qty numeric(18,4),current_qty numeric(18,4),status text);
create table lot_allocations(id uuid primary key default gen_random_uuid(),lot_id uuid references product_lots,quantity numeric(18,4));
create table fnb_branch_product_cost_balances(tenant_id uuid,branch_id uuid,product_id uuid references products,
 costed_quantity numeric(18,4),deficit_quantity numeric(18,4) default 0,unit_cost numeric(18,6),total_cost numeric(18,4));
create table fnb_branch_product_cost_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid references products,
 quantity numeric(18,4),unit_cost numeric(18,6),total_cost numeric(18,4));
create table fnb_sale_cost_shortfalls_00473(id uuid primary key default gen_random_uuid(),product_id uuid references products,
 quantity numeric(18,4),pending_quantity numeric(18,4),estimated_unit_cost numeric(18,6),settled_actual_cost numeric(18,4));
create table production_orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid references products,
 planned_qty numeric(18,2),completed_qty numeric(18,2),status text,code text);
create table purchase_order_items(id uuid primary key,product_id uuid references products);
create table production_order_materials(id uuid primary key,product_id uuid references products);
create table bom(id uuid primary key,tenant_id uuid,product_id uuid references products,yield_qty numeric(18,2),yield_unit text,
 cached_cost numeric(18,2),note text,batch_size numeric default 1,is_active boolean default true,name text,code text);
create table bom_items(id uuid primary key default gen_random_uuid(),bom_id uuid,material_id uuid references products,
 quantity numeric(18,4),unit text,input_quantity numeric(18,8),input_unit text,conversion_factor numeric(20,8),
 modifier_scale_target uuid,waste_percent numeric default 0,sort_order int default 0);
create table bom_modifier_option_quantities(id uuid primary key,tenant_id uuid,bom_id uuid,material_id uuid references products,
 modifier_option_id uuid,quantity numeric(18,4),input_quantity numeric(18,8),input_unit text);
create table modifier_options(id uuid,group_id uuid);
create table uom_conversions(id uuid primary key default gen_random_uuid(),tenant_id uuid,product_id uuid references products,
 from_unit text,to_unit text,factor numeric,is_active boolean);
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
create table bom_uom_sync_history_00465(tenant_id uuid,actor_id uuid,bom_id uuid,material_id uuid,old_data jsonb,new_data jsonb);
create table invoices(id uuid primary key,source text);
create table invoice_items(id uuid primary key,invoice_id uuid,product_id uuid references products,quantity numeric,returned_qty numeric);
create table sales_returns(id uuid primary key,invoice_id uuid,tenant_id uuid,branch_id uuid,status text);
create table return_items(return_id uuid,invoice_item_id uuid,product_id uuid,quantity numeric);
create table fnb_invoice_item_bom_snapshots_00410(invoice_item_id uuid,invoice_id uuid,tenant_id uuid,branch_id uuid);
create table fnb_invoice_item_bom_snapshot_components_00410(id bigserial primary key,invoice_item_id uuid,
 material_id uuid references products,unit text,quantity numeric(18,4));
create function create_production_order_atomic(jsonb) returns jsonb language sql as $$select jsonb_build_object('accepted',true)$$;
create function fnb_void_invoice_atomic(p_invoice_id uuid,p_tenant_id uuid,p_reason text,p_branch_id uuid,p_actor uuid,p_shift uuid,p_pin_actor uuid,p_otp uuid)
returns jsonb language plpgsql as $$
begin
return '{}'::jsonb;
end;
$$;
create function restore_bom_for_return(uuid,uuid,uuid,numeric,uuid,uuid,text,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
create function increment_product_stock(uuid,numeric) returns void language sql as $$update products set stock=stock+$2 where id=$1$$;
create function upsert_branch_stock(uuid,uuid,uuid,numeric) returns void language sql as $$update branch_stock set quantity=quantity+$4 where tenant_id=$1 and branch_id=$2 and product_id=$3$$;
create function allocate_lots_fifo(uuid,uuid,uuid,numeric,text,uuid) returns jsonb language plpgsql as $$begin update product_lots set current_qty=current_qty-$4 where product_id=$2;return '{}';end;$$;
create function get_tenant_setting(uuid,text,jsonb) returns jsonb language sql as $$select 'false'::jsonb$$;
create function get_active_bom_for_branch(uuid,uuid,uuid) returns uuid language sql as $$select id from bom where product_id=$1 and is_active limit 1$$;
create view products_scoped with(security_barrier=true) as select id,tenant_id,unit,stock,cost_price,sell_price from products where tenant_id='${tenant}';
create view production_orders_scoped with(security_barrier=true) as select * from production_orders where branch_id='${branch}';
create view production_order_materials_scoped with(security_barrier=true) as select * from production_order_materials;
create view stock_movements_scoped with(security_barrier=true) as select * from stock_movements where branch_id='${branch}';
grant select on products_scoped,production_orders_scoped,production_order_materials_scoped,stock_movements_scoped to authenticated;
create function test_cost_trigger() returns trigger language plpgsql as $$begin return new;end;$$;
create trigger test_cost_precision after update of cost_price on products for each row when(new.cost_price is distinct from old.cost_price) execute function test_cost_trigger();
`);
await db.exec(fn('00320_uom_accounting_snapshots.sql','resolve_product_uom_factor')+fn('00320_uom_accounting_snapshots.sql','normalize_bom_item_uom_00320')+
 fn('00465_bom_product_uom_synchronization.sql','sync_product_bom_uom_00465')+fn('00236_link_bom_cost_to_product.sql','sync_product_cost_from_bom')+
 fn('00236_link_bom_cost_to_product.sql','bom_unit_cost')+fn('00410_fnb_invoice_item_bom_return_snapshot.sql','_restore_fnb_invoice_item_bom_00410')+
 fn('00350_fnb_exact_modifier_bom_quantities.sql','consume_bom_for_sale'));
await db.exec(`create trigger normalize before insert or update of material_id,quantity,unit,input_quantity,input_unit on bom_items for each row execute function normalize_bom_item_uom_00320();`);
const views=async()=> (await db.query(`select relname,pg_get_viewdef(oid,true) definition,reloptions,relacl::text acl from pg_class where relname like '%_scoped' order by relname`)).rows;
const beforeViews=await views();await db.exec(read('00517_prepared_stock_gram_cutover.sql'));
await db.exec(read('00518_gram_unit_price_capacity.sql'));await db.exec(read('00519_gram_cutover_fifo_quantities.sql'));
await db.exec(read('00520_gram_cutover_return_serialization.sql'));
assert.deepEqual(await views(),beforeViews,'view scope/options/ACL unchanged');
assert.equal(Number((await db.query("select count(*) n from pg_trigger where tgname='test_cost_precision' and tgenabled='O'")).rows[0].n),1,'column-dependent trigger restored');
await db.exec(`create trigger unit_guard before update of unit on products for each row execute function guard_product_stock_unit_00468();`);
for(const [id,unit,factor] of [[first,'Mẻ',1100],[second,'Mẻ/100g',750]]) {
 await db.exec(`insert into products(id,tenant_id,unit,stock_unit,purchase_unit,sell_unit,stock,cost_price,is_fnb_stock_item,code,name)
 values('${id}','${tenant}','${unit}','${unit}','${unit}','${unit}',1.4237,17517.71,true,'BTP','Prepared');
 insert into branch_stock(tenant_id,branch_id,product_id,quantity,reserved) values('${tenant}','${branch}','${id}',1.4237,.1);
 insert into product_lots(tenant_id,branch_id,product_id,initial_qty,current_qty,status) values('${tenant}','${branch}','${id}',2,1.4237,'active');
 insert into lot_allocations(lot_id,quantity) select id,.1234 from product_lots where product_id='${id}';
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,unit_cost,unit_price) values('${tenant}','${branch}','${id}','in',1.4237,17517.71,17517.71);
 insert into fnb_branch_product_cost_balances values('${tenant}','${branch}','${id}',1.4237,0,17615.080003,25078.5894);
 insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,quantity,unit_cost,total_cost) values('${tenant}','${branch}','${id}',1.4237,17615.080003,25078.5894);
 insert into uom_conversions(tenant_id,product_id,from_unit,to_unit,factor,is_active) values('${tenant}','${id}','${unit}','G',${factor},true);
 insert into bom(id,tenant_id,product_id,yield_qty,yield_unit,cached_cost) values('${id}','${tenant}','${id}',1,'cái',17517.71);
 insert into production_orders(tenant_id,branch_id,product_id,planned_qty,completed_qty,status) values('${tenant}','${branch}','${id}',1,1,'completed');`);
}
await db.exec(`insert into products(id,tenant_id,unit,stock_unit,stock,cost_price,is_fnb_stock_item,code,name) values('${drink}','${tenant}','Cái','Cái',0,0,false,'DRINK','Drink');
insert into bom(id,tenant_id,product_id,yield_qty,yield_unit,cached_cost) values('${drink}','${tenant}','${drink}',1,'Cái',100);
insert into bom_items(bom_id,material_id,quantity,unit,input_quantity,input_unit) values('${drink}','${first}',80,'G',80,'G'),('${drink}','${second}',80,'G',80,'G');`);
const stock=async id=>Number((await db.query(`select stock from products where id='${id}'`)).rows[0].stock);
await db.exec(`alter table fnb_branch_product_cost_balances add column updated_by uuid,add column updated_at timestamptz;
create unique index cost_balance_key on fnb_branch_product_cost_balances(tenant_id,branch_id,product_id);
alter table fnb_branch_product_cost_events add column direction text,add column source_type text,add column source_reference_type text,
add column source_reference_id uuid,add column source_stock_movement_id uuid,add column note text,add column created_by uuid;
create unique index cost_movement_key on fnb_branch_product_cost_events(source_stock_movement_id) where source_stock_movement_id is not null;
alter table invoices add column tenant_id uuid,add column branch_id uuid,add column status text;
create function _fnb_branch_cost_tracking_enabled_00390(uuid,uuid) returns boolean language sql as $$select true$$;`);
await db.exec(fn('00390_fnb_branch_cost_ledger.sql','_post_fnb_branch_cost_in_00390')+fn('00390_fnb_branch_cost_ledger.sql','_post_fnb_branch_cost_out_00390')+fn('00397_fnb_return_bom_cost_restore.sql','_capture_fnb_return_bom_cost_00397'));
await db.exec(`create trigger return_cost after insert on stock_movements for each row when(new.type='in' and new.reference_type='return_bom_restore') execute function _capture_fnb_return_bom_cost_00397();`);
const invoice=crypto.randomUUID(),line=crypto.randomUUID();
await db.exec(`insert into invoices(id,source,tenant_id,branch_id,status) values('${invoice}','fnb','${tenant}','${branch}','completed');
insert into invoice_items values('${line}','${invoice}','${drink}',2,0);
insert into fnb_invoice_item_bom_snapshots_00410 values('${line}','${invoice}','${tenant}','${branch}');
insert into fnb_invoice_item_bom_snapshot_components_00410(invoice_item_id,material_id,unit,quantity) values('${line}','${first}','Mẻ',.1454);
insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,quantity,unit_cost,total_cost,direction,source_type,source_reference_type,source_reference_id)
values('${tenant}','${branch}','${first}',.1454,100000,14540,'out','bom_consume','bom_consume','${invoice}');`);
// Unknown financial documents and active production must block atomically.
const open=crypto.randomUUID();await db.exec(`insert into invoice_items values('${open}',null,'${first}',1,0)`);
await assert.rejects(db.query(`select rebase_prepared_stock_to_grams_00517('${first}','Mẻ',1100)`),/DEPENDENCY_REVIEW/);
assert.equal(await stock(first),1.4237);await db.exec(`delete from invoice_items where id='${open}'`);
await assert.rejects(db.query(`select rebase_prepared_stock_to_grams_00517('${first}','Mẻ',1000)`),/DECLARED_FACTOR/);
await assert.rejects(db.exec(`update products set unit='G' where id='${first}'`),/LOCKED_BY_HISTORY/);
for(const [id,unit,factor] of [[first,'Mẻ',1100],[second,'Mẻ/100g',750]]) {
 const snapshots=(await db.query(`select * from fnb_invoice_item_bom_snapshot_components_00410`)).rows;
 const changed=(await db.query(`select rebase_prepared_stock_to_grams_00517('${id}','${unit}',${factor}) result`)).rows[0].result;
 assert.equal(Number(changed.stock),Number((1.4237*factor).toFixed(4)));
 assert.equal(Number((await db.query(`select a.quantity from lot_allocations a join product_lots l on l.id=a.lot_id where l.product_id='${id}'`)).rows[0].quantity),Number((.1234*factor).toFixed(4)),'FIFO allocations normalized with lots');
 const balance=(await db.query(`select * from fnb_branch_product_cost_balances where product_id='${id}'`)).rows[0];
 assert.equal(Number(balance.total_cost),25078.5894);assert.equal(Number(balance.costed_quantity),Number(changed.stock));
 assert.equal(Number((await db.query(`select yield_qty from bom where product_id='${id}'`)).rows[0].yield_qty),factor);
 assert.equal(Number((await db.query(`select quantity from bom_items where material_id='${id}'`)).rows[0].quantity),80);
 assert.deepEqual((await db.query(`select * from fnb_invoice_item_bom_snapshot_components_00410`)).rows,snapshots);
 const after=await stock(id);assert.equal((await db.query(`select rebase_prepared_stock_to_grams_00517('${id}','${unit}',${factor}) r`)).rows[0].r.replayed,true);
 assert.equal(await stock(id),after,'replay cannot multiply stock twice');
 await assert.rejects(db.query(`select create_production_order_atomic('${JSON.stringify({product_id:id,stock_unit:unit,materials:[]})}')`),/FORM_REFRESH/);
 assert.equal((await db.query(`select create_production_order_atomic('${JSON.stringify({product_id:id,stock_unit:'G',materials:[]})}') r`)).rows[0].r.accepted,true);
}
// Old invoice consumption stays in old units; full/partial returns normalize
// that historical amount, not today's corrected 80 G recipe.
const before=await stock(first);for(let part=0;part<2;part++){
 const ret=crypto.randomUUID();await db.exec(`insert into sales_returns values('${ret}','${invoice}','${tenant}','${branch}','completed');insert into return_items values('${ret}','${line}','${drink}',1);`);
 const r=(await db.query(`select _restore_fnb_invoice_item_bom_00410('${line}','${tenant}','${branch}','${drink}',1,'${ret}','${actor}','RETURN',null) r`)).rows[0].r;
 assert.equal(r.restored[0].unit,'G');assert.equal(Number(r.restored[0].quantity),79.97);
 await db.exec(`update invoice_items set returned_qty=returned_qty+1 where id='${line}'`);
}
assert.equal(await stock(first),Number((before+159.94).toFixed(4)));
assert.equal(Number((await db.query(`select total_cost from fnb_branch_product_cost_balances where product_id='${first}'`)).rows[0].total_cost),39618.5894,'old return restores the original 14,540 cost, not current recipe price');
assert.equal(Number((await db.query(`select quantity from fnb_invoice_item_bom_snapshot_components_00410 where invoice_item_id='${line}'`)).rows[0].quantity),.1454,'original snapshot unchanged');
// Repeated real consumption uses exact corrected gram recipes.
await db.exec(`create function test_post_sale_cost() returns trigger language plpgsql as $$begin
perform _post_fnb_branch_cost_out_00390(new.tenant_id,new.branch_id,new.product_id,new.quantity,'bom_consume',new.reference_type,new.reference_id,new.id,new.note,new.created_by);return new;end;$$;
create trigger test_sale_cost after insert on stock_movements for each row when(new.type='out' and new.reference_type='bom_consume') execute function test_post_sale_cost();`);
await db.exec(`update bom_items set input_quantity=1 where bom_id='${drink}'`);
const starts=[await stock(first),await stock(second)];for(let i=0;i<100;i++)await db.query(`select consume_bom_for_sale('${tenant}','${branch}','${drink}',1,'${invoice}','${actor}','BILL',null,false,null)`);
assert.equal(await stock(first),Number((starts[0]-100).toFixed(4)));assert.equal(await stock(second),Number((starts[1]-100).toFixed(4)));
for(const id of [first,second])assert.equal(Number((await db.query(`select costed_quantity from fnb_branch_product_cost_balances where product_id='${id}'`)).rows[0].costed_quantity),await stock(id),'gram physical and cost quantity remain equal after 100 sales');
const po=(await db.query(`select id from production_orders where product_id='${first}'`)).rows[0].id;
const h=(await db.query(`select get_prepared_stock_unit_history_00517('production','${po}') r`)).rows[0].r;
assert.equal(h[0].inputUnit,'Mẻ');assert.equal(h[0].inputQuantity,1);assert.equal(h[0].stockQuantity,1100);
await db.exec(`set role authenticated;`);await assert.rejects(db.query(`select * from prepared_stock_unit_rows_00517`),/permission denied/);
await assert.rejects(db.query(`select rebase_prepared_stock_to_grams_00517('${first}','Mẻ',1100)`),/permission denied/);await db.exec('reset role');
await db.exec(`select set_config('test.allowed','false',false);`);await assert.rejects(db.query(`select get_prepared_stock_unit_history_00517('production','${po}')`),/HISTORY_DENIED/);
console.log('PASS gram cutover: both factors; original recipes; quantities/lots/reserved; unchanged monetary totals; immutable old return snapshots; 2 partial returns; 100 one-gram sales; replay once; stale form refusal; private backup; scopes/ACL; six-figure source values.');
}catch(error){console.error(error);process.exitCode=1;}finally{await db.close();}
