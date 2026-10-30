import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
// Isolated, in-memory PostgreSQL only. No production connection or credentials.
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
 await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.profiles(id uuid primary key,tenant_id uuid,inventory_access boolean,cost_access boolean);
 create table public.branches(id uuid primary key,tenant_id uuid,code text,name text,is_active boolean);
 create table public.branch_access(user_id uuid,branch_id uuid);
 create table public.products(id uuid primary key,tenant_id uuid,code text,name text,product_type text,unit text,min_stock numeric,max_stock numeric,is_active boolean,inventory_role text,allow_sale boolean);
 create table public.product_variants(id uuid primary key,tenant_id uuid,name text);
 create table public.branch_stock(id uuid primary key,tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric,reserved numeric,updated_at timestamptz);
 create function public.get_user_tenant_id() returns uuid language sql stable security definer as $$select tenant_id from public.profiles where id=auth.uid()$$;
 create function public.user_has_permission(actor uuid,permission text) returns boolean language sql stable security definer as $$select coalesce((select case permission when 'inventory.view' then inventory_access when 'products.view_cost' then cost_access else false end from public.profiles where id=actor),false)$$;
 create function public._can_read_branch_inventory_00476(actor uuid,tenant uuid,branch uuid) returns boolean language sql stable security definer as $$select exists(select 1 from public.profiles p join public.branch_access a on a.user_id=p.id join public.branches b on b.id=a.branch_id and b.tenant_id=p.tenant_id where p.id=actor and p.tenant_id=tenant and b.id=branch)$$;
 create view public.products_scoped as select * from public.products where tenant_id=public.get_user_tenant_id();
 create view public.product_variants_scoped as select * from public.product_variants where tenant_id=public.get_user_tenant_id();
 alter table public.branch_stock enable row level security;
 create policy stock_scope on public.branch_stock for select to authenticated using (tenant_id=public.get_user_tenant_id() and public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id));
 grant usage on schema public,auth to authenticated;
 grant select on public.branches,public.products_scoped,public.product_variants_scoped,public.branch_stock to authenticated;
 create function public.get_branch_stock_values_00540(p_product_ids uuid[],p_branch_ids uuid[] default null)
 returns table(branch_id uuid,product_id uuid,quantity numeric,unit_cost numeric,stock_value numeric,valuation_complete boolean)
 language sql stable security definer as $$select s.branch_id,s.product_id,sum(s.quantity),10::numeric,sum(s.quantity)*10,true from public.branch_stock s where s.tenant_id=public.get_user_tenant_id() and s.product_id=any(p_product_ids) and s.branch_id=any(p_branch_ids) and public.user_has_permission(auth.uid(),'products.view_cost') and public._can_read_branch_inventory_00476(auth.uid(),s.tenant_id,s.branch_id) group by s.branch_id,s.product_id$$;
 `);
 await db.query('insert into profiles values($1,$2,true,true)',[uuid(1),uuid(10)]);
 await db.query('insert into profiles values($1,$2,true,false)',[uuid(2),uuid(10)]);
 await db.query('insert into profiles values($1,$2,false,false)',[uuid(3),uuid(10)]);
 for(const [id,tenant,code] of [[100,10,'WAREHOUSE'],[101,10,'OTHER'],[102,20,'FOREIGN']])
  await db.query('insert into branches values($1,$2,$3,$3,true)',[uuid(id),uuid(tenant),code]);
 for(const actor of [1,2,3]) await db.query('insert into branch_access values($1,$2)',[uuid(actor),uuid(100)]);
 const products = [
  [201,'NVL-COLD','Túi ủ Coldbrew 20x14','nvl',5,true,'raw_material',true],
  [202,'SKU-COLD','Túi ủ Coldbrew 20x14','sku',0,true,'retail_stock_item',true],
  [203,'POSITIVE','Existing stock','sku',10,true,'retail_stock_item',true],
  [204,'NEGATIVE','Negative balance','nvl',0,true,'raw_material',true],
  [205,'INACTIVE-ZERO','Inactive zero','sku',0,false,'retail_stock_item',true],
  [206,'INACTIVE-STOCK','Inactive physical balance','sku',0,false,'retail_stock_item',true],
  [207,'MENU','FNB menu','sku',0,true,'fnb_menu_item',true],
  [208,'VARIANT','Variant product','sku',2,true,'retail_stock_item',true],
  [210,'EXPLICIT-ZERO','Explicit zero','nvl',3,true,'raw_material',true],
  [211,'NULL-ROLE','Active legacy role','sku',0,true,null,true],
  [212,'NOT-FOR-SALE','Active but not sellable','nvl',0,true,'raw_material',false],
  [213,'LITERAL','100% Mẫu_A (v2), X','sku',0,true,'retail_stock_item',true],
 ];
 for(const [id,code,name,type,min,active,role,sale] of products)
  await db.query('insert into products values($1,$2,$3,$4,$5,\'unit\',$6,100,$7,$8,$9)',[uuid(id),uuid(10),code,name,type,min,active,role,sale]);
 await db.query('insert into products values($1,$2,\'FOREIGN-SKU\',\'Foreign\',\'sku\',\'unit\',0,0,true,\'retail_stock_item\',true)',[uuid(209),uuid(20)]);
 for(const [id,name] of [[301,'Small'],[302,'Large']]) await db.query('insert into product_variants values($1,$2,$3)',[uuid(id),uuid(10),name]);
 const stocks=[[401,100,203,null,5,1],[402,100,203,null,2,0],[403,100,204,null,-2,0],[404,100,205,null,0,0],[405,100,206,null,2,0],[406,100,207,null,50,0],[407,100,208,301,2,0],[408,100,208,302,3,0],[409,100,210,null,0,0],[410,101,203,null,900,0]];
 for(const [id,branch,product,variant,qty,reserved] of stocks)
  await db.query('insert into branch_stock values($1,$2,$3,$4,$5,$6,$7,\'2026-10-19T08:00:00Z\')',[uuid(id),uuid(10),uuid(branch),uuid(product),variant?uuid(variant):null,qty,reserved]);
 const before = (await db.query('select jsonb_agg(to_jsonb(s) order by id) state from branch_stock s')).rows[0].state;
 const helperSource=readFileSync('supabase/migrations/202610240200_warehouse_catalog_search.sql','utf8');
 await db.exec(helperSource.slice(helperSource.indexOf('create or replace function public.catalog_search_normalize'),helperSource.indexOf('revoke all on function public.catalog_search_normalize')));
 await db.exec(readFileSync('supabase/migrations/20261029171144_inventory_active_catalog_read.sql','utf8'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uuid(1)]);
 await db.exec('set role authenticated');
 async function catalog({branch=null,type=null,search=null,filter='all',low=false,offset=0,limit=1000}={}) {
  return (await db.query('select public.get_inventory_catalog_00573($1::uuid,$2,$3,$4,$5,$6,$7) result',[branch,type,search,filter,low,offset,limit])).rows[0].result;
 }
 const all=await catalog();
 check(all.rows.some(r=>r.product_code==='NVL-COLD'&&r.quantity===0&&!r.has_stock_record),'active NVL with no stock must appear');
 check(all.rows.some(r=>r.product_code==='SKU-COLD'&&r.quantity===0&&!r.has_stock_record),'active SKU with no stock must appear');
 check(all.rows.filter(r=>r.product_code==='NVL-COLD').length===1,'no duplicate synthetic row');
 check(all.rows.find(r=>r.product_code==='POSITIVE').quantity===7,'duplicate balance records merge before pagination');
 check(all.rows.find(r=>r.product_code==='POSITIVE').available===6,'reservation unchanged');
 check(all.rows.some(r=>r.product_code==='INACTIVE-STOCK'),'retain inactive nonzero balances');
 check(!all.rows.some(r=>r.product_code==='INACTIVE-ZERO'),'hide inactive zero');
 check(!all.rows.some(r=>r.product_code==='MENU'),'FNB menu excluded');
 check(!all.rows.some(r=>r.product_code==='FOREIGN-SKU'||r.branch_id!==uuid(100)),'tenant/branch scope');
 check(all.rows.filter(r=>r.product_code==='VARIANT').length===2,'variants preserved without phantom base row');
 check(all.rows.some(r=>r.product_code==='NOT-FOR-SALE'),'active not-sellable product stays manageable');
 check(all.rows.find(r=>r.product_code==='NVL-COLD').updated_at===null,'no fake update date for absent balance');
 check(all.total===all.rows.length,'total describes logical rows');
 check(all.total_value===120,'existing stock value unchanged by zero catalog rows');
 for(const [filter,predicate] of [['positive',r=>r.quantity>0],['zero',r=>r.quantity===0],['negative',r=>r.quantity<0]]) {
  const result=await catalog({filter});
  check(result.rows.every(predicate),`${filter} filter`);
  check(result.total===all.rows.filter(predicate).length,`${filter} total before pagination`);
 }
 const cold=await catalog({search:'coldbrew'});
 check(cold.total===2&&cold.rows.every(r=>r.quantity===0),'search finds cold products without balances');
 check((await catalog({search:'Túi ủ Coldbrew 20×14'})).total===2,'x and multiplication sign both match');
 check((await catalog({search:'tui u coldbrew'})).total===2,'Vietnamese unaccented search across active zero balances');
 check((await catalog({search:'coldberw'})).total===2,'minor name transposition matches without changing any product identity');
 check((await catalog({search:'SKU-COLX'})).total===0,'product codes are not fuzzy corrected');
 check((await catalog({search:'%'})).total===1,'percent is literal');
 check((await catalog({search:'_'})).total===1,'underscore is literal');
 check((await catalog({search:'absent'})).total===0,'no match stays empty');
 check((await catalog({type:'nvl'})).rows.every(r=>r.product_type==='nvl'),'type filter');
 const low=await catalog({low:true});
 check(low.rows.every(r=>r.min_stock>0&&r.quantity<=r.min_stock),'low-stock filter before pagination');
 check(low.total===all.low_stock_count,'low-stock summary uses same data');
 const pages=[];
 for(let offset=0;offset<all.total;offset+=2) {
  const page=await catalog({offset,limit:2});pages.push(...page.rows);
  check(page.total===all.total&&page.total_value===all.total_value,'page summary stable');
 }
 check(JSON.stringify(pages.map(r=>r.id))===JSON.stringify(all.rows.map(r=>r.id)),'pagination no missing/duplicate rows');
 check((await catalog({offset:1000})).total===all.total,'out-of-range page retains summary');
 await assert.rejects(catalog({branch:uuid(101)}),/INVENTORY_CATALOG_BRANCH_DENIED/);checks++;
 await assert.rejects(catalog({branch:uuid(102)}),/INVENTORY_CATALOG_BRANCH_DENIED/);checks++;
 await assert.rejects(catalog({filter:'invalid'}),/INVENTORY_CATALOG_FILTER_INVALID/);checks++;
 await assert.rejects(catalog({offset:-1}),/INVENTORY_CATALOG_FILTER_INVALID/);checks++;
 await assert.rejects(catalog({limit:1001}),/INVENTORY_CATALOG_FILTER_INVALID/);checks++;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uuid(2)]);
 const hidden=await catalog();
 check(hidden.rows.filter(r=>r.quantity!==0).every(r=>r.stock_value===null&&r.unit_cost===null),'cost permission retained');
 check(!hidden.valuation_complete,'unknown cost not fabricated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uuid(3)]);
 await assert.rejects(catalog(),/INVENTORY_CATALOG_ACCESS_DENIED/);checks++;
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub','',false)");
 await assert.rejects(catalog(),/INVENTORY_CATALOG_ACCESS_DENIED/);checks++;
 const after=(await db.query('select jsonb_agg(to_jsonb(s) order by id) state from branch_stock s')).rows[0].state;
 check(JSON.stringify(after)===JSON.stringify(before),'every stock record byte-for-byte unchanged');
 check((await db.query("select not prosecdef and provolatile='s' readonly from pg_proc where proname='get_inventory_catalog_00573'")).rows[0].readonly,'STABLE SECURITY INVOKER');
 console.log(`PASS ${checks} inventory catalog checks: active zero stock visible; filters/counts/export pagination; tenant/branch/cost permissions; FNB menu exclusion; stock records unchanged.`);
} finally { await db.close(); }
