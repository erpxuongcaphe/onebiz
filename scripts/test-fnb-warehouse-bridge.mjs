// Isolated PostgreSQL execution. No connection to ONEBIZ or a remote database.
import { createRequire } from 'node:module';
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [tenant,actor,store,warehouse,supplier,customer,product,substitute] = [1,2,3,4,5,6,7,8].map(id);
await db.exec(`
create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create table tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
create table branches(id uuid primary key,tenant_id uuid,is_active boolean,branch_type text,cascade_mode text,code text,name text);
create table suppliers(id uuid primary key,tenant_id uuid,branch_id uuid,is_internal boolean,is_active boolean,name text);
create table customers(id uuid primary key,tenant_id uuid,branch_id uuid,is_internal boolean,is_active boolean,name text);
create table products(id uuid primary key,tenant_id uuid,is_active boolean,product_type text,channel text,inventory_role text,allow_free_sale boolean,unit text,code text,name text,sell_price numeric);
create table fnb_supply_branch_scopes(tenant_id uuid,branch_id uuid,enforcement_enabled boolean);
create table fnb_supply_catalog(tenant_id uuid,branch_id uuid,product_id uuid);
create table purchase_orders(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,code text,total numeric,status text,note text);
create table purchase_order_items(id uuid primary key default gen_random_uuid(),purchase_order_id uuid,product_id uuid,quantity numeric);
create table invoices(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,code text,customer_id uuid,customer_name text,status text,source text,subtotal numeric,discount_amount numeric,tax_amount numeric,delivery_fee numeric,total numeric,paid numeric,debt numeric,payment_method text,note text,created_by uuid,auto_saved boolean,source_order_id uuid,client_session_id uuid,fulfilled_by_id uuid);
create table invoice_items(id uuid primary key default gen_random_uuid(),invoice_id uuid,product_id uuid,product_name text,unit text,quantity numeric,unit_price numeric,discount numeric,total numeric);
create table input_invoices(id uuid primary key default gen_random_uuid(),purchase_order_id uuid);
create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
create table codes(entity text primary key,n integer not null);
create table effects(kind text);
create function get_user_tenant_id() returns uuid language sql stable as $$select tenant_id from profiles where id=auth.uid() and is_active$$;
create function user_has_permission(uuid,text) returns boolean language sql stable as $$select current_setting('test.denied',true) is distinct from 'yes'$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $2::text=current_setting('test.branch',true)$$;
create function next_code(uuid,text) returns text language plpgsql as $$declare v integer;begin insert into codes values($2,1) on conflict(entity) do update set n=codes.n+1 returning n into v;return $2||v;end$$;
create function resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz) returns jsonb language sql stable as $$select jsonb_build_object('unit_price',sell_price) from products where id=$1$$;
create function save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb) returns jsonb language plpgsql as $$
declare result uuid; c text;begin
 if $12 then raise exception 'test: receipt must never be requested';end if;
 c:=next_code(get_user_tenant_id(),'PO');
 insert into purchase_orders(tenant_id,branch_id,code,total,status,note) values(get_user_tenant_id(),$3,c,(select sum(ceil((x->>'quantity')::numeric*(x->>'unit_price')::numeric)) from jsonb_array_elements($13)x),'ordered',$5) returning id into result;
 insert into purchase_order_items(purchase_order_id,product_id,quantity) select result,(x->>'product_id')::uuid,(x->>'quantity')::numeric from jsonb_array_elements($13)x;
 return jsonb_build_object('purchase_order_id',result,'code',c);end$$;
create function checkout_internal_pos_v2(jsonb) returns jsonb language plpgsql as $$declare result uuid;begin
 if not user_has_permission(auth.uid(),'inventory.internal_export') then raise exception 'base permission denied';end if;
 select id into result from invoices where client_session_id=($1->>'sessionId')::uuid and status='completed';
 if found then return jsonb_build_object('invoice_id',result);end if;
 delete from invoice_items where invoice_id=($1->>'draftId')::uuid;
 delete from invoices where id=($1->>'draftId')::uuid;
 insert into invoices(tenant_id,branch_id,customer_id,status,source,client_session_id) values(get_user_tenant_id(),($1->>'branchId')::uuid,($1->>'customerId')::uuid,'completed','internal',($1->>'sessionId')::uuid) returning id into result;
 insert into effects values('dispatch');return jsonb_build_object('invoice_id',result);end$$;
insert into tenants values('${tenant}');insert into profiles values('${actor}','${tenant}',true);
insert into branches values('${store}','${tenant}',true,'store','outlet','XTB','Chi nhánh'),('${warehouse}','${tenant}',true,'warehouse','production','KT','Kho tổng');
insert into suppliers values('${supplier}','${tenant}','${warehouse}',true,true,'Kho tổng');
insert into customers values('${customer}','${tenant}','${store}',true,true,'Chi nhánh');
insert into products values('${product}','${tenant}',true,'sku','retail',null,false,'Thùng','A','Sữa A',125000),('${substitute}','${tenant}',true,'sku','retail',null,false,'Thùng','B','Sữa B',130000);
set test.actor='${actor}';set test.branch='${store}';
`);
// Execute the actual shared price resolver, including its existing 00395
// free-sale opt-in. A stub previously concealed unassigned optional records.
await db.exec(`
alter table customers add column price_tier_id uuid;
create table price_tiers(id uuid primary key,tenant_id uuid,is_active boolean,scope text);
create table price_tier_items(id uuid,price_tier_id uuid,product_id uuid,variant_id uuid,price numeric,min_qty numeric,created_at timestamptz default now());
create table product_variants(id uuid,tenant_id uuid,product_id uuid,is_active boolean,sell_price numeric);
create table product_platform_prices(id uuid,tenant_id uuid,product_id uuid,variant_id uuid,platform text,override_price numeric,set_at timestamptz default now());
`);
const pricingSource=readFileSync('supabase/migrations/00363_unified_sale_pricing.sql','utf8');
const pricingStart=pricingSource.indexOf('create or replace function public.resolve_sale_price_00363(');
let pricingDefinition=pricingSource.slice(pricingStart,pricingSource.indexOf('$function$;',pricingSource.indexOf('as $function$',pricingStart))+12);
pricingDefinition=pricingDefinition.replace('select p.id, p.sell_price into v_product','select p.id, p.sell_price, p.allow_free_sale into v_product')
 .replace("p_channel = 'fnb' and coalesce(v_unit_price, 0) <= 0","p_channel = 'fnb' and (v_unit_price is null or v_unit_price < 0 or (v_unit_price = 0 and not v_product.allow_free_sale))");
await db.exec(pricingDefinition);
await assert.rejects(db.query('select resolve_sale_price_00363($1,null,null,null,\'retail\',\'direct\',1,now())',[product]),/v_variant.*not assigned/);
await db.exec(readFileSync('supabase/migrations/202610230100_fnb_purchase_sales_order_bridge.sql','utf8'));
let passed=0;
async function test(name,fn){await fn(); passed++;console.log(`PASS ${name}`);}
async function scalar(sql,params=[]){return Object.values((await db.query(sql,params)).rows[0])[0];}
const input=(quantity=10,pid=product)=>[{productId:pid,quantity}];
const submit=(key,items=input(),note='Giao buổi sáng\nCần thêm hàng mới')=>scalar('select submit_fnb_warehouse_order($1,$2,$3,$4::jsonb,$5)',[store,warehouse,key,JSON.stringify(items),note]);
async function rejects(fn,pattern){await assert.rejects(fn,pattern);}
const price=(pid=product,variant=null,channel='retail',platform='direct',quantity=1,cid=null)=>scalar('select resolve_sale_price_00363($1,$2,null,$3,$4,$5,$6,now())',[pid,variant,cid,channel,platform,quantity]);
await test('price initialization is repeatable and rejects an unreviewed resolver shape',async()=>{
 const sql=readFileSync('supabase/migrations/202610230100_fnb_purchase_sales_order_bridge.sql','utf8');
 const patch=sql.match(/do \$warehouse_price_records\$[\s\S]*?end \$warehouse_price_records\$;/)[0];
 const definition=await scalar("select pg_get_functiondef('resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)'::regprocedure)");
 await db.exec(patch);
 assert.equal(await scalar("select pg_get_functiondef('resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)'::regprocedure)"),definition);
 await db.exec(pricingDefinition.replace(/\r?\n/g,'\r\n'));
 await db.exec(patch);
 assert.equal((await price()).unit_price,125000);
 await db.exec(pricingDefinition.replace('v_variant record;','v_variant RECORD;'));
 await rejects(()=>db.exec(patch),/WAREHOUSE_ORDER_PRICE_RESOLVER_DEFINITION_CHANGED/);
 await db.exec(definition);
});
await test('real resolver: plain Retail SKU without variant, tier or platform uses catalogue price',async()=>{
 const r=await price();assert.equal(r.unit_price,125000);assert.equal(r.price_tier_item_id,null);assert.equal(r.platform_price_id,null);
});
await test('real resolver: active Retail customer tier and quantity breaks retain precedence',async()=>{
 await db.query('insert into price_tiers values($1,$2,true,\'retail\')',[id(800),tenant]);
 await db.query('update customers set price_tier_id=$1 where id=$2',[id(800),customer]);
 await db.query('insert into price_tier_items(id,price_tier_id,product_id,price,min_qty) values($1,$2,$3,120000,1),($4,$2,$3,110000,10)',[id(801),id(800),product,id(802)]);
 assert.equal((await price(product,null,'retail','direct',1,customer)).unit_price,120000);
 assert.equal((await price(product,null,'retail','direct',10,customer)).unit_price,110000);
 await db.query('update customers set price_tier_id=null');
});
await test('real resolver: FnB direct catalogue and variant prices are unchanged',async()=>{
 await db.query('insert into product_variants values($1,$2,$3,true,150000)',[id(803),tenant,product]);
 assert.equal((await price(product,null,'fnb')).unit_price,125000);
 assert.equal((await price(product,id(803),'fnb')).unit_price,150000);
});
await test('real resolver: FnB platform-specific price retains priority',async()=>{
 await db.query('insert into product_platform_prices(id,tenant_id,product_id,platform,override_price) values($1,$2,$3,\'grab_food\',160000)',[id(804),tenant,product]);
 assert.equal((await price(product,null,'fnb','grab_food')).unit_price,160000);
 assert.equal((await price(product,null,'fnb','shopee_food')).unit_price,125000);
});
await test('real resolver: FnB zero price still requires the existing free-sale opt-in',async()=>{
 await db.query('update products set sell_price=0 where id=$1',[product]);
 await rejects(()=>price(product,null,'fnb'),/SALE_PRICE_FNB_NOT_POSITIVE/);
 await db.query('update products set allow_free_sale=true where id=$1',[product]);
 assert.equal((await price(product,null,'fnb')).unit_price,0);
 await db.query('update products set sell_price=125000,allow_free_sale=false where id=$1',[product]);
});
await test('opening/searching consumes no code and includes active zero-stock SKU',async()=>{
 const ctx=await scalar('select get_fnb_warehouse_order_context($1,$2)',[store,'Sữa']);assert.equal(ctx.products.length,2);assert.equal(await scalar('select count(*)::int from codes'),0);
});
let saved;const key=id(100);
await test('one submission creates linked PO and warehouse order, exact note, canonical server price',async()=>{
 saved=await submit(key,[{productId:product,quantity:10,unitPrice:1}]);
 const order=(await db.query('select * from invoices where id=$1',[saved.salesOrderId])).rows[0];
 assert.equal(order.branch_id,warehouse);assert.equal(order.customer_id,customer);assert.equal(order.source,'order');assert.equal(order.note,'Giao buổi sáng\nCần thêm hàng mới');assert.equal(Number(order.total),1250000);
 assert.equal(await scalar('select count(*)::int from effects'),0);assert.equal(await scalar('select count(*)::int from input_invoices'),0);
});
await test('retry after lost response returns same documents and consumes no extra numbers',async()=>{
 assert.deepEqual(await submit(key),saved);assert.equal(await scalar('select count(*)::int from purchase_orders'),1);assert.equal(await scalar("select n from codes where entity='PO'"),1);
});
await test('concurrent duplicate submissions converge to one linked pair',async()=>{
 const results=await Promise.all([submit(id(101)),submit(id(101))]);assert.deepEqual(results[0],results[1]);
});
await test('same key cannot silently change original demand',()=>rejects(()=>submit(key,input(11)),/nội dung khác/));
await test('revoked permission blocks even replay',async()=>{await db.exec("set test.denied='yes'");await rejects(()=>submit(key),/quyền/);await db.exec("set test.denied='no'");});
await test('source branch scope is enforced',async()=>{await db.exec(`set test.branch='${warehouse}'`);await rejects(()=>submit(id(102)),/quyền/);await db.exec(`set test.branch='${store}'`);});
for(const quantity of [0,-1,'NaN','Infinity',1.00001])await test(`invalid quantity ${quantity} rolls back`,()=>rejects(()=>submit(id(110),input(quantity)),/Số lượng/));
await test('duplicate products rejected',()=>rejects(()=>submit(id(111),[...input(),...input()]),/trùng/));
await test('inactive product rejected',async()=>{await db.exec(`update products set is_active=false where id='${product}'`);await rejects(()=>submit(id(112)),/Mặt hàng/);await db.exec(`update products set is_active=true where id='${product}'`);});
await test('menu SKU rejected',async()=>{await db.exec(`update products set channel='fnb' where id='${product}'`);await rejects(()=>submit(id(113)),/Mặt hàng/);await db.exec(`update products set channel='retail' where id='${product}'`);});
await test('recipe opt-in does not hide or block physical warehouse supplies',async()=>{
 await db.exec(`insert into fnb_supply_branch_scopes values('${tenant}','${store}',true)`);
 assert.equal((await scalar('select get_fnb_warehouse_order_context($1,$2)',[store,'Sữa'])).products.length,2);
 const requested=await submit(id(114));assert.ok(requested.salesOrderId);
 assert.equal(await scalar('select count(*)::int from fnb_supply_catalog'),0);
 assert.equal(await scalar('select count(*)::int from effects'),0);
 await db.exec('delete from fnb_supply_branch_scopes');
});
await test('missing or ambiguous internal customer rejected',async()=>{await db.exec(`update customers set is_active=false`);await rejects(()=>submit(id(115)),/khách nội bộ/);await db.exec(`update customers set is_active=true;insert into customers(id,tenant_id,branch_id,is_internal,is_active,name) select '${id(116)}',tenant_id,branch_id,is_internal,is_active,name from customers`);await rejects(()=>submit(id(115)),/khách nội bộ/);await db.exec(`delete from customers where id='${id(116)}'`);});
await test('cross-tenant product rejected',async()=>{await db.exec(`update products set tenant_id='${id(999)}' where id='${product}'`);await rejects(()=>submit(id(117)),/Mặt hàng/);await db.exec(`update products set tenant_id='${tenant}' where id='${product}'`);});
await test('failure after PO creation rolls back PO, both codes and order',async()=>{
 const before=await scalar('select count(*)::int from purchase_orders');const counter=await scalar("select n from codes where entity='PO'");
 await db.exec("create function fail_order_test() returns trigger language plpgsql as $$begin raise exception 'simulated failure';end$$;create trigger fail_test before insert on invoices for each row execute function fail_order_test()");
 await rejects(()=>submit(id(118)),/simulated/);assert.equal(await scalar('select count(*)::int from purchase_orders'),before);assert.equal(await scalar("select n from codes where entity='PO'"),counter);await db.exec('drop trigger fail_test on invoices');
});
await test('linked PO cannot receive, pay, edit original lines or duplicate input invoice',async()=>{
 await rejects(()=>db.query("update purchase_orders set status='completed' where id=$1",[saved.purchaseOrderId]),/Đơn đã gửi/);
 await rejects(()=>db.query('update purchase_order_items set quantity=50 where purchase_order_id=$1',[saved.purchaseOrderId]),/Không sửa/);
 await rejects(()=>db.query('insert into input_invoices(purchase_order_id) values($1)',[saved.purchaseOrderId]),/Đơn đã gửi/);
});
await test('warehouse original demand is immutable',()=>rejects(()=>db.query('update invoice_items set quantity=1 where invoice_id=$1',[saved.salesOrderId]),/Không sửa/));
let child;
await test('warehouse child dispatch can replace SKU, quantity and add goods without rewriting original',async()=>{
 child=await scalar("insert into invoices(tenant_id,branch_id,customer_id,status,source,source_order_id) values($1,$2,$3,'draft','pos',$4) returning id",[tenant,warehouse,customer,saved.salesOrderId]);
 await db.query("insert into invoice_items(invoice_id,product_id,quantity) values($1,$2,6),($1,$3,4)",[child,product,substitute]);
 await db.query('update invoice_items set quantity=5 where invoice_id=$1 and product_id=$2',[child,product]);
 assert.equal(Number(await scalar('select quantity from invoice_items where invoice_id=$1',[saved.salesOrderId])),10);
});
const session=id(200);let dispatched;
await test('internal checkout preserves parent link while using actual edited cart',async()=>{
 dispatched=await scalar('select checkout_internal_pos_v2($1::jsonb)',[JSON.stringify({draftId:child,branchId:warehouse,customerId:customer,sessionId:session,items:[{productId:substitute,quantity:4}]})]);
 assert.equal(await scalar('select source_order_id from invoices where id=$1',[dispatched.invoice_id]),saved.salesOrderId);assert.equal(await scalar('select count(*)::int from effects'),1);
});
await test('checkout replay retains link and does not dispatch twice',async()=>{
 await scalar('select checkout_internal_pos_v2($1::jsonb)',[JSON.stringify({draftId:child,branchId:warehouse,customerId:customer,sessionId:session})]);assert.equal(await scalar('select count(*)::int from effects'),1);
});
await test('existing processing closure can finish despite different quantities and reopen',async()=>{
 await db.query('update invoices set fulfilled_by_id=$1 where id=$2',[dispatched.invoice_id,saved.salesOrderId]);
 await db.query('update invoices set fulfilled_by_id=null where id=$1',[saved.salesOrderId]);
});
await test('wrong receiving customer is blocked before dispatch',async()=>{
 const d=await scalar("insert into invoices(tenant_id,source_order_id) values($1,$2) returning id",[tenant,saved.salesOrderId]);
 await rejects(()=>scalar('select checkout_internal_pos_v2($1::jsonb)',[JSON.stringify({draftId:d,branchId:warehouse,customerId:id(999),sessionId:id(201)})]),/đúng bên nhận/);
 assert.equal(await scalar('select count(*)::int from effects'),1);
});
await test('checkout still enforces existing base permission and rolls back',async()=>{
 await db.exec("set test.denied='yes'");
 await rejects(()=>scalar('select checkout_internal_pos_v2($1::jsonb)',[JSON.stringify({branchId:warehouse,customerId:customer,sessionId:id(202)})]),/base permission/);
 await db.exec("set test.denied='no'");assert.equal(await scalar('select count(*)::int from effects'),1);
});
await test('unlinked purchases and POS drafts keep their existing edit behavior',async()=>{
 const normal=await scalar("insert into purchase_orders(status) values('ordered') returning id");await db.query("update purchase_orders set status='completed' where id=$1",[normal]);
 const draft=await scalar("insert into invoices(source) values('pos') returning id");await db.query('update invoices set total=123 where id=$1',[draft]);
});
await test('literal search punctuation cannot broaden results',async()=>assert.equal((await scalar('select get_fnb_warehouse_order_context($1,$2)',[store,"%' OR 1=1 --"])).products.length,0));
await test('PO estimate and paired order use the same rounding for fractional quantities',async()=>{
 await db.exec(`update products set sell_price=1.1 where id='${product}'`);const r=await submit(id(300),input(0.3));
 assert.equal(Number(r.total),1);assert.equal(Number(await scalar('select total from purchase_orders where id=$1',[r.purchaseOrderId])),1);
});
await test('zero price without free-sale permission cannot create demand',async()=>{
 await db.exec(`update products set sell_price=0 where id='${product}'`);await rejects(()=>submit(id(301)),/giá bán/);await db.exec(`update products set sell_price=125000 where id='${product}'`);
});
await test('link progress is visible only to the buying branch with inventory permission',async()=>{
 assert.equal((await scalar('select get_fnb_purchase_order_links($1::uuid[])',[[saved.purchaseOrderId]])).length,1);
 await db.exec(`set test.branch='${id(999)}'`);assert.equal((await scalar('select get_fnb_purchase_order_links($1::uuid[])',[[saved.purchaseOrderId]])).length,0);await db.exec(`set test.branch='${store}'`);
});
await test('anonymous callers cannot invoke bridge and authenticated cannot invoke private checkout',async()=>{
 assert.equal(await scalar("select has_function_privilege('anon','submit_fnb_warehouse_order(uuid,uuid,uuid,jsonb,text)','execute')"),false);
 assert.equal(await scalar("select has_function_privilege('authenticated','_checkout_internal_pos_before_fnb_bridge_20261023(jsonb)','execute')"),false);
 assert.equal(await scalar("select has_table_privilege('authenticated','fnb_purchase_sales_order_links','insert')"),false);
});
console.log(`${passed} isolated PostgreSQL checks passed.`);await db.close();
