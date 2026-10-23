// Disposable PostgreSQL regression. This runner never connects to production.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : '@electric-sql/pglite');
const db = new PGlite();
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12,'0');
let checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
function fn(file,name) {
 const text=fs.readFileSync(file,'utf8');
 const re=new RegExp('create or replace function public\\.'+name+'\\s*\\(','i');
 const start=text.search(re);assert(start>=0,name);
 const body=text.slice(start);const tag=body.match(/\bas\s+(\$[a-z_]*\$)/i)[1];
 const begin=body.indexOf(tag);return body.slice(0,body.indexOf(tag,begin+tag.length)+tag.length)+';';
}
try {
 await db.exec(`create schema auth; create schema extensions;
 create role anon; create role authenticated;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
 create table branches(id uuid primary key,tenant_id uuid,name text,is_active boolean default true);
 create table products(id uuid primary key,tenant_id uuid,code text,name text,unit text,bom_code text,stock_quantity numeric default 0);
 create table product_variants(id uuid primary key,tenant_id uuid,product_id uuid,bom_code text);
 create table bom(id uuid primary key default gen_random_uuid(),tenant_id uuid,product_id uuid,variant_id uuid,branch_id uuid,code text,name text,version int default 1,is_active boolean default true,batch_size numeric default 1,yield_qty numeric default 1,yield_unit text default 'ly',note text,created_at timestamptz default now(),updated_at timestamptz default now(),cached_cost numeric,cached_cost_updated_at timestamptz);
 create unique index code_branch on bom(tenant_id,code,coalesce(branch_id,'${id(0)}')) where is_active and code is not null;
 create unique index product_branch_size on bom(tenant_id,product_id,coalesce(branch_id,'${id(0)}'),coalesce(variant_id,'${id(0)}')) where is_active and product_id is not null;
 create table bom_items(id uuid primary key default gen_random_uuid(),bom_id uuid references bom(id),material_id uuid,quantity numeric,unit text,waste_percent numeric default 0,sort_order int default 0,note text,modifier_scale_target uuid,input_quantity numeric,input_unit text,conversion_factor numeric);
 create table modifier_groups(id uuid primary key,tenant_id uuid,rule text,is_active boolean);
 create table modifier_options(id uuid primary key,group_id uuid,scale_factor numeric,is_active boolean);
 create table bom_modifier_option_quantities(id uuid primary key default gen_random_uuid(),tenant_id uuid,bom_id uuid references bom(id),material_id uuid,modifier_option_id uuid,quantity numeric,input_quantity numeric,input_unit text,created_at timestamptz default now(),updated_at timestamptz default now(),unique(bom_id,material_id,modifier_option_id));
 create table branch_stock(tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
 create table stock_movements(tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid);
 create function user_has_permission(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.permission',true),'yes')<>'no'$$;
 create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2::text<>coalesce(current_setting('test.denied_branch',true),'')$$;
 create function resolve_product_uom_factor(uuid,uuid,text) returns numeric language sql as $$select case when p.unit=$3 then 1 when p.unit='Chai' and $3='G' then coalesce(nullif(current_setting('test.factor',true),''),'0.000333333333333333')::numeric else null end from products p where id=$2 and tenant_id=$1$$;
 create function _allow_negative_sale_00473(uuid,uuid) returns boolean language sql as $$select false$$;
 create function upsert_branch_stock(uuid,uuid,uuid,numeric) returns void language sql as $$update branch_stock set quantity=quantity+$4 where tenant_id=$1 and branch_id=$2 and product_id=$3$$;
 create function increment_product_stock(uuid,numeric) returns void language sql as $$update products set stock_quantity=stock_quantity+$2 where id=$1$$;
 select set_config('test.actor','${id(2)}',false);
 insert into profiles values('${id(2)}','${id(1)}',true),('${id(3)}','${id(99)}',true);
 insert into branches(id,tenant_id,name) values('${id(4)}','${id(1)}','Tu Bua'),('${id(5)}','${id(1)}','Premium'),('${id(6)}','${id(1)}','Dong Xoai'),('${id(7)}','${id(99)}','Foreign');
 insert into products(id,tenant_id,code,name,unit,bom_code) values('${id(10)}','${id(1)}','DRINK','Drink','Ly','M'),('${id(11)}','${id(1)}','SUGAR','Sugar','G',null),('${id(12)}','${id(1)}','MILK','Milk','G',null),('${id(13)}','${id(1)}','HONEY','Honey','Chai',null);
 insert into product_variants values('${id(20)}','${id(1)}','${id(10)}','M'),('${id(21)}','${id(1)}','${id(10)}','L');
 insert into modifier_groups values('${id(30)}','${id(1)}','single_required',true);
 insert into modifier_options values('${id(31)}','${id(30)}',.8,true),('${id(32)}','${id(30)}',1,true),('${id(33)}','${id(30)}',1.2,true),('${id(34)}','${id(30)}',0,true);
 insert into bom(id,tenant_id,product_id,variant_id,code,name) values('${id(40)}','${id(1)}','${id(10)}','${id(20)}','M','Drink M'),('${id(41)}','${id(1)}','${id(10)}','${id(21)}','L','Drink L');
 `);
 await db.exec(fn('supabase/migrations/00320_uom_accounting_snapshots.sql','normalize_bom_item_uom_00320'));
 await db.exec(fn('supabase/migrations/00350_fnb_exact_modifier_bom_quantities.sql','enforce_bom_modifier_option_quantity_00350'));
 await db.exec(`create trigger normalize before insert or update of quantity,unit,input_quantity,input_unit on bom_items for each row execute function normalize_bom_item_uom_00320();
 create trigger exact_guard before insert or update on bom_modifier_option_quantities for each row execute function enforce_bom_modifier_option_quantity_00350();
 insert into bom_items(bom_id,material_id,quantity,unit,modifier_scale_target,sort_order,note) values('${id(40)}','${id(11)}',20,'G','${id(30)}',0,'Sugar'),('${id(40)}','${id(12)}',28,'G',null,1,'Fixed milk'),('${id(40)}','${id(13)}',30,'G',null,2,'Weighed honey'),('${id(41)}','${id(11)}',40,'G',null,0,'L');
 insert into bom_modifier_option_quantities(tenant_id,bom_id,material_id,modifier_option_id,quantity,input_quantity,input_unit) values('${id(1)}','${id(40)}','${id(11)}','${id(31)}',10,10,'G'),('${id(1)}','${id(40)}','${id(11)}','${id(32)}',20,20,'G'),('${id(1)}','${id(40)}','${id(11)}','${id(33)}',30,30,'G'),('${id(1)}','${id(40)}','${id(11)}','${id(34)}',0,0,'G');
 insert into branch_stock select '${id(1)}',b.id,p.id,null,1000 from branches b cross join products p where b.tenant_id='${id(1)}' and p.id<>'${id(10)}';`);
 await db.exec(fn('supabase/migrations/00147_variant_aware_bom_lookup.sql','get_active_bom_for_branch'));
 await db.exec(fn('supabase/migrations/00541_fnb_authoritative_modifier_scale.sql','consume_bom_for_sale'));
 const snapshot=async table=>(await db.query(`select to_jsonb(t) r from ${table} t order by to_jsonb(t)::text`)).rows;
 const before={bom:await snapshot('bom'),items:await snapshot('bom_items'),exact:await snapshot('bom_modifier_option_quantities'),products:await snapshot('products'),variants:await snapshot('product_variants'),stock:await snapshot('branch_stock')};
 const migration=fs.readFileSync('supabase/migrations/202610230001_atomic_branch_bom_clone.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 check(await snapshot('bom'),before.bom,'install/reinstall never changes existing formulas');
 check((await db.query("select has_function_privilege('anon','clone_bom_for_branch_atomic(uuid,uuid)','execute') allowed")).rows[0].allowed,false,'anonymous cannot execute');
 const clone=async(source,branch)=>(await db.query('select clone_bom_for_branch_atomic($1,$2) result',[source,branch])).rows[0].result;
 const resolve=async(branch,variant=id(20))=>(await db.query('select get_active_bom_for_branch($1,$2,$3) id',[id(10),branch,variant])).rows[0].id;
 const premium=await clone(id(40),id(5)), dx=await clone(id(40),id(6));
 check(premium.code,'M','lookup code retained');check(premium.variant_id,id(20),'size retained');
 check(await resolve(id(4)),id(40),'Tu Bua still uses global');check(await resolve(id(5)),premium.id,'Premium uses own copy');check(await resolve(id(6)),dx.id,'Dong Xoai uses own copy');
 check(await resolve(id(5),id(21)),id(41),'other size still uses its original global formula');
 const premiumL=await clone(id(41),id(5));
 check(await resolve(id(5),id(21)),premiumL.id,'L can have an independent branch copy');
 check(await resolve(id(5)),premium.id,'copying L does not replace M');
 check(await resolve(id(4),id(21)),id(41),'Tu Bua L unchanged after branch L copy');
 await db.exec(`insert into products(id,tenant_id,code,name,unit,bom_code) values('${id(14)}','${id(1)}','SHARED','Shared','Ly','SHARED'),('${id(15)}','${id(1)}','LEGACY','Legacy','Ly',null);
 insert into bom(id,tenant_id,product_id,code,name) values('${id(50)}','${id(1)}',null,'SHARED','Shared code recipe'),('${id(51)}','${id(1)}','${id(15)}',null,'Legacy recipe');
 insert into bom_items(bom_id,material_id,quantity,unit) values('${id(50)}','${id(12)}',15,'G'),('${id(51)}','${id(12)}',12,'G');`);
 const shared=await clone(id(50),id(6)),legacy=await clone(id(51),id(6));
 check((await db.query('select get_active_bom_for_branch($1,$2,null) id',[id(14),id(6)])).rows[0].id,shared.id,'shared-code formula without product_id remains reachable');
 check((await db.query('select get_active_bom_for_branch($1,$2,null) id',[id(15),id(6)])).rows[0].id,legacy.id,'code-less legacy formula remains reachable');

 for(const target of [premium,dx]) {
  const rows=(await db.query('select material_id,quantity,unit,modifier_scale_target,input_quantity,input_unit,conversion_factor,note from bom_items where bom_id=$1 order by sort_order',[target.id])).rows;
  const original=(await db.query('select material_id,quantity,unit,modifier_scale_target,input_quantity,input_unit,conversion_factor,note from bom_items where bom_id=$1 order by sort_order',[id(40)])).rows;
  check(rows,original,'every line including scale target, conversion and original weighed quantity copied');
  check((await db.query('select modifier_option_id,quantity,input_quantity,input_unit from bom_modifier_option_quantities where bom_id=$1 order by modifier_option_id',[target.id])).rows,(await db.query('select modifier_option_id,quantity,input_quantity,input_unit from bom_modifier_option_quantities where bom_id=$1 order by modifier_option_id',[id(40)])).rows,'all exact options copied');
 }
 check((await snapshot('products')).filter(x=>![id(14),id(15)].includes(x.r.id)),before.products,'shared product links untouched');check(await snapshot('product_variants'),before.variants,'shared size links untouched');check(await snapshot('branch_stock'),before.stock,'cloning does not post stock');check((await snapshot('stock_movements')).length,0,'cloning does not post movements');
 const global=await db.query('select to_jsonb(b) r from bom b where id=$1',[id(40)]);check(global.rows[0].r,before.bom.find(x=>x.r.id===id(40)).r,'source header unchanged');
 await db.query('update bom_modifier_option_quantities set quantity=55,input_quantity=55 where bom_id=$1 and modifier_option_id=$2',[premium.id,id(32)]);
 await db.query('update bom_modifier_option_quantities set quantity=45,input_quantity=45 where bom_id=$1 and modifier_option_id=$2',[dx.id,id(32)]);
 for(const [branch,expected] of [[id(4),[0,10,20,30]],[id(5),[0,10,55,30]],[id(6),[0,10,45,30]]]) {
  for(const [i,option] of [34,31,32,33].entries()) {
   await db.exec('begin');
   const result=(await db.query('select consume_bom_for_sale($1,$2,$3,1,$4,$5,null,$6,false,$7) r',[id(1),branch,id(10),id(90),id(2),JSON.stringify([{groupId:id(30),options:[{optionId:id(option),scaleFactor:99}]}]),id(20)])).rows[0].r;
   check(Number(result.consumed.find(x=>x.material_id===id(11))?.qty??0),expected[i],'actual consume uses branch exact option instead of forged cart factor');
   check(Number(result.consumed.find(x=>x.material_id===id(12)).qty),28,'fixed milk does not scale');
   check(Number(result.consumed.find(x=>x.material_id===id(13)).qty),.01,'weighed grams are not converted twice');
   const stocks=(await db.query('select branch_id,quantity from branch_stock where product_id=$1 order by branch_id',[id(11)])).rows;
   for(const row of stocks)check(Number(row.quantity),row.branch_id===branch?1000-expected[i]:1000,'sale only consumes the selected branch');
   await db.exec('rollback');
  }
 }
 const expectFail=async(label,action,pattern)=>{const headers=await snapshot('bom');const items=await snapshot('bom_items');const exact=await snapshot('bom_modifier_option_quantities');await assert.rejects(action,pattern,label);check(await snapshot('bom'),headers,label+' leaves no header');check(await snapshot('bom_items'),items,label+' leaves no lines');check(await snapshot('bom_modifier_option_quantities'),exact,label+' leaves no options');};
 await expectFail('duplicate click',()=>clone(id(40),id(5)),/TARGET_EXISTS/);
 await expectFail('cannot use branch recipe as global',()=>clone(premium.id,id(4)),/GLOBAL_ACTIVE_REQUIRED/);
 await expectFail('foreign branch',()=>clone(id(40),id(7)),/BRANCH_DENIED/);
 await db.exec("select set_config('test.permission','no',false)");await expectFail('permission denied',()=>clone(id(40),id(4)),/PERMISSION_DENIED/);await db.exec("select set_config('test.permission','yes',false)");
 await db.exec(`select set_config('test.denied_branch','${id(4)}',false)`);await expectFail('unassigned branch',()=>clone(id(40),id(4)),/BRANCH_DENIED/);await db.exec("select set_config('test.denied_branch','',false)");
 await db.exec("select set_config('test.actor','',false)");await expectFail('unauthenticated',()=>clone(id(40),id(4)),/AUTH_REQUIRED/);await db.exec(`select set_config('test.actor','${id(3)}',false)`);await expectFail('foreign source',()=>clone(id(40),id(7)),/SOURCE_NOT_FOUND/);await db.exec(`select set_config('test.actor','${id(2)}',false)`);
 await db.exec(`update modifier_options set is_active=false where id='${id(33)}'`);await expectFail('failure on exact option rolls back full copy',()=>clone(id(40),id(4)),/OPTION_TENANT_MISMATCH/);await db.exec(`update modifier_options set is_active=true where id='${id(33)}'`);
 await db.exec("select set_config('test.factor','0.002',false)");await expectFail('changed conversion',()=>clone(id(40),id(4)),/UOM_CHANGED/);await db.exec("select set_config('test.factor','',false)");
 await db.exec(`update bom set code='UNLINKED' where id='${id(40)}'`);await expectFail('orphan source code',()=>clone(id(40),id(4)),/LINK_MISMATCH/);await db.exec(`update bom set code='M' where id='${id(40)}'`);
 check(await snapshot('branch_stock'),before.stock,'all transactional tests restore original stock');
 const originalLineIds=new Set(before.items.map(x=>x.r.id));
 check((await snapshot('bom_items')).filter(x=>originalLineIds.has(x.r.id)),before.items,'global source lines and original input metadata unchanged');
 const originalExactIds=new Set(before.exact.map(x=>x.r.id));
 check((await snapshot('bom_modifier_option_quantities')).filter(x=>originalExactIds.has(x.r.id)),before.exact,'global exact option rows and timestamps unchanged');

 console.log(`PASS ${checks} branch BOM clone checks: actual resolver, actual consume for all options at three outlets, size isolation, UOM, permissions, duplicates and complete rollback.`);
} finally {await db.close();}
